import {
  CHECK_IDS,
  isScoredCheck,
  PIPELINE_NODES,
  type CheckId,
  type CheckResultView,
  type PipelineNode,
  type RunEvent,
  type SpanView,
} from "@ai-director/contract";

/** One line of the description, plus the spans (or partial spans) that fall on it. */
export type SpecimenLineModel = {
  /** 1-based, matching how a script supervisor numbers a page. */
  line: number;
  /** This line's raw text, with no trailing newline. */
  text: string;
  /** Offset of this line's first character in the full description. */
  start: number;
  /** Offset just past this line's last character (before the newline, if any). */
  end: number;
  spans: SpecimenLineSpanModel[];
};

/** A span clipped to the portion of it that falls on one line. */
export type SpecimenLineSpanModel = {
  spanId: string;
  checkId: CheckId;
  /** Offset of the clipped fragment within `line.text`. */
  startInLine: number;
  endInLine: number;
};

/**
 * Splits a description into its source lines and assigns each verified span to every line it
 * touches. A span that straddles a newline (the model quoted across a line break) is clipped and
 * attached to both lines rather than dropped — losing it would hide real coverage from the gutter.
 */
export function splitLines(description: string, spans: SpanView[]): SpecimenLineModel[] {
  const rawLines = description.split("\n");
  const lines: SpecimenLineModel[] = [];
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i] ?? "";
    const start = offset;
    const end = start + text.length;
    lines.push({ line: i + 1, text, start, end, spans: [] });
    offset = end + 1; // skip the newline itself
  }

  for (const span of spans) {
    for (const model of lines) {
      const overlapStart = Math.max(span.start, model.start);
      const overlapEnd = Math.min(span.end, model.end);
      if (overlapStart < overlapEnd) {
        model.spans.push({
          spanId: span.spanId,
          checkId: span.checkId,
          startInLine: overlapStart - model.start,
          endInLine: overlapEnd - model.start,
        });
      }
    }
  }

  return lines;
}

/** A contiguous, non-overlapping run of one line's text, plus every span covering it. */
export type SpecimenSegment = {
  /** Offset within the line's own text (`SpecimenLineModel.text`), not the full description. */
  start: number;
  end: number;
  /** Every span covering this exact run, in ascending start order. Can be empty (plain text), have
   *  one entry (the ordinary case), or have more than one — two checks legitimately quoting
   *  overlapping or nested text (e.g. `hair_spec` quoting "A confident young man" while
   *  `age_build` quotes the nested "young man"). Neither is ever dropped: `verifySpans` already
   *  guarantees both survive the wire, so the rendering layer must not silently lose one either. */
  spans: SpecimenLineSpanModel[];
};

/**
 * Splits one line into segments at every span boundary on it, so each segment is covered by
 * exactly the same, fixed set of spans along its whole length. This is what makes overlapping or
 * nested spans renderable at all: HTML cannot nest two interactive elements around the same text,
 * so the text has to be cut at the point where the set of covering checks changes, not "first span
 * wins and the rest are dropped."
 */
export function segmentLine(line: SpecimenLineModel): SpecimenSegment[] {
  const cuts = new Set<number>([0, line.text.length]);
  for (const span of line.spans) {
    cuts.add(span.startInLine);
    cuts.add(span.endInLine);
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const segments: SpecimenSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === undefined || end === undefined || start >= end) continue;
    const covering = line.spans
      .filter((s) => s.startInLine <= start && s.endInLine >= end)
      .sort((a, b) => a.startInLine - b.startInLine);
    segments.push({ start, end, spans: covering });
  }
  return segments;
}

/** The 1-based source line a span's start offset falls on. UI-only; the server never sends this. */
export function lineOfSpan(description: string, start: number): number {
  let line = 1;
  const limit = Math.min(start, description.length);
  for (let i = 0; i < limit; i++) {
    if (description[i] === "\n") line += 1;
  }
  return line;
}

/** Count of scored checks below band 4 (not passing). `not_evaluated` checks are neither passing
 *  nor counted here — an unknown is not a failure, and this must never read as one. */
export function failingCount(results: CheckResultView[]): number {
  return results.filter(isScoredCheck).filter((r) => !r.passed).length;
}

/** Count of scored checks at band 4 or above, for the "n/9 at ≥80" header. Never an average. */
export function passingCount(results: CheckResultView[]): number {
  return results.filter(isScoredCheck).filter((r) => r.passed).length;
}

/** Mean of the scored checks' `percent` fields. Never recomputed from a band; always the contract's
 *  own percentages, averaged. Used only where an aggregate is explicitly asked for (the terminal
 *  banner, a later task) — never inside a group header (see CheckGroupHeader). */
export function meanPercent(results: CheckResultView[]): number {
  const scored = results.filter(isScoredCheck);
  if (scored.length === 0) return 0;
  return scored.reduce((sum, r) => sum + r.percent, 0) / scored.length;
}

/**
 * One lane per check that has at least one verified span, in rubric order, capped at 9. Lane
 * index is stable for the life of the run: a check that has spans in pass 1 keeps its lane even if
 * a later pass gives it none, because the geometry re-used across passes is what makes the gutter
 * readable as one continuous instrument (design doc §4.1).
 */
export function lanesOf(results: CheckResultView[]): CheckId[] {
  const withSpans = new Set(
    results
      .filter(isScoredCheck)
      .filter((r) => r.spans.length > 0)
      .map((r) => r.checkId),
  );
  return CHECK_IDS.filter((id) => withSpans.has(id)).slice(0, 9);
}

// ---------------------------------------------------------------------------
// Architecture screen: deriving PipelineNode[] from the run's own event log.
// ---------------------------------------------------------------------------

/** Bookkeeping the derivation needs across events but that is not itself node data — never
 *  returned, never rendered. Reset per pass, keyed off each event's own `pass` field rather than
 *  `pass.started` order, so the derivation never depends on event arrival order beyond what the
 *  fixture and the real server both guarantee (a group's own `pass` field is always present). */
type Bookkeeping = {
  /** The node currently `running`, so `run.failed` can find it without guessing. */
  runningNodeId: string | null;
  /** The pass the evaluator's own accumulators below belong to; `null` until its first group. */
  evaluatorPass: number | null;
  groupsCompletedThisPass: number;
  evalTokensIn: number;
  evalTokensOut: number;
  evalCostUsd: number;
  evalLatencyMs: number;
  passResults: CheckResultView[];
};

function emptyBookkeeping(): Bookkeeping {
  return {
    runningNodeId: null,
    evaluatorPass: null,
    groupsCompletedThisPass: 0,
    evalTokensIn: 0,
    evalTokensOut: 0,
    evalCostUsd: 0,
    evalLatencyMs: 0,
    passResults: [],
  };
}

function countSpans(results: CheckResultView[]): { verified: number; unverified: number } {
  const scored = results.filter(isScoredCheck);
  return {
    verified: scored.reduce((n, r) => n + r.spans.length, 0),
    unverified: scored.reduce((n, r) => n + r.unverified.length, 0),
  };
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Derives every pipeline node's current state, purely, by replaying a run's event log from the
 * start. Framework-free and side-effect-free so it is testable without React (task 15 brief).
 *
 * Every node this function ever writes to goes through `patch`, which refuses to move a `planned`
 * node (Interrogator, Director, Identity Meter — the three agents v1 designs but does not build)
 * off `planned`. No case below ever names one of those three ids anyway, so the guard is
 * belt-and-suspenders: structurally unreachable, and refused even if a future event tried.
 *
 * `verify`, `splice` and `gate` have no events of their own on the wire (§6, the contract's
 * `EVENT_NAMES`) — they are enforcement steps inferred from the evaluator/repairer events that
 * bracket them. Their `state`, `progress` and `note` are honestly derived from those bracketing
 * events — a node moving to `done` because the next real step started is a sound inference about
 * *sequence*. Their `latencyMs`, `tokensIn/Out` and `costUsd` are deliberately left unset, not
 * derived from the gap between two timestamps: the backend can run real, invisible-on-the-wire
 * work between those two events (e.g. Verify's bracket can contain a full `retryVerbatim` model
 * call when a quote needs a second pass — see `apps/backend/src/orchestrate/runPass.ts`), so a
 * timestamp gap would silently misattribute that work's cost to the wrong step. Leaving these
 * fields unset is what makes `formatLatency`/`formatCost` render "not measured" for them, same as
 * their already-unset token/cost fields — the bracket can honestly say *what happened* for these
 * three nodes, never honestly say *how long it took*.
 */
export function nodesFromEvents(events: RunEvent[]): PipelineNode[] {
  const nodes = new Map<string, PipelineNode>(PIPELINE_NODES.map((n) => [n.id, { ...n }]));
  const bk = emptyBookkeeping();

  function patch(id: string, changes: Partial<PipelineNode>): void {
    const current = nodes.get(id);
    if (!current || current.state === "planned") return;
    nodes.set(id, { ...current, ...changes });
  }

  for (const event of events) {
    switch (event.name) {
      case "run.started": {
        patch("intake", {
          state: "done",
          cueId: event.id,
          payload: {
            runId: event.runId,
            rubricVersion: event.rubricVersion,
            model: event.model,
            description: event.description,
          },
        });
        break;
      }

      case "evaluator.group.started": {
        // Only the first group call of a pass is a real state transition; the second and third
        // group.started events of the same pass find the evaluator already running and change
        // nothing, so its progress and elapsed-since clock are never reset mid-pass.
        if (bk.evaluatorPass !== event.pass) {
          bk.evaluatorPass = event.pass;
          bk.groupsCompletedThisPass = 0;
          bk.evalTokensIn = 0;
          bk.evalTokensOut = 0;
          bk.evalCostUsd = 0;
          bk.evalLatencyMs = 0;
          bk.passResults = [];
          patch("evaluator", {
            state: "running",
            cueId: event.id,
            startedAt: event.at,
            progress: 0,
            payload: undefined,
            note: undefined,
          });
        }
        bk.runningNodeId = "evaluator";
        break;
      }

      case "evaluator.group.completed": {
        bk.groupsCompletedThisPass += 1;
        bk.evalTokensIn += event.cost.inputTokens;
        bk.evalTokensOut += event.cost.outputTokens;
        bk.evalCostUsd = Math.round((bk.evalCostUsd + event.cost.usd) * 100) / 100;
        bk.evalLatencyMs += event.cost.latencyMs;
        bk.passResults = [...bk.passResults, ...event.results];

        const progress = bk.groupsCompletedThisPass / 3;
        const done = bk.groupsCompletedThisPass >= 3;
        patch("evaluator", {
          state: done ? "done" : "running",
          cueId: event.id,
          progress,
          tokensIn: bk.evalTokensIn,
          tokensOut: bk.evalTokensOut,
          costUsd: bk.evalCostUsd,
          latencyMs: bk.evalLatencyMs,
          payload: bk.passResults,
          note: `${bk.groupsCompletedThisPass}/3 groups`,
        });

        if (done) {
          const { verified, unverified } = countSpans(bk.passResults);
          patch("verify", {
            state: "running",
            cueId: event.id,
            startedAt: event.at,
            progress: 0,
            note: `${pluralize(verified, "verified quote")} · ${pluralize(unverified, "unverified quote")}`,
            payload: { verified, unverified },
            // An unverified quote is a defect inside a step that still completes successfully
            // (design doc §6.3) — flagged as text, never a colour-only signal.
            warning: unverified > 0 ? `${pluralize(unverified, "unverified quote")}` : undefined,
          });
          bk.runningNodeId = "verify";
        } else {
          bk.runningNodeId = "evaluator";
        }
        break;
      }

      case "repairer.started": {
        // Verify's own duration is not honestly attributable — see the function comment above —
        // so only its state and progress move; its `latencyMs` stays unset ("not measured").
        patch("verify", { state: "done", cueId: event.id, progress: 1 });
        patch("repairer", {
          state: "running",
          cueId: event.id,
          startedAt: event.at,
          progress: 0,
          payload: { spanIds: event.spanIds },
          note: pluralize(event.spanIds.length, "fragment to repair"),
        });
        bk.runningNodeId = "repairer";
        break;
      }

      case "repairer.completed": {
        patch("repairer", {
          state: "done",
          cueId: event.id,
          progress: 1,
          latencyMs: event.cost.latencyMs,
          tokensIn: event.cost.inputTokens,
          tokensOut: event.cost.outputTokens,
          costUsd: event.cost.usd,
          payload: event.replacements,
          note: pluralize(event.replacements.length, "replacement"),
        });
        patch("splice", { state: "running", cueId: event.id, startedAt: event.at, progress: 0 });
        bk.runningNodeId = "splice";
        break;
      }

      case "pass.completed": {
        // Splice's own duration is not honestly attributable either — same reasoning as Verify
        // above — so `latencyMs` stays unset here too.
        patch("splice", {
          state: "done",
          cueId: event.id,
          progress: 1,
          payload: { repairedDescription: event.repairedDescription },
          note: event.repairedDescription ? "spliced into description" : "no repair to splice",
        });

        const stillFailing = event.failing.length;
        patch("gate", {
          state: "done",
          cueId: event.id,
          progress: 1,
          payload: { pass: event.pass, failing: event.failing },
          note: stillFailing === 0 ? "0 still failing" : `${pluralize(stillFailing, "check")} still failing`,
        });
        bk.runningNodeId = null;
        break;
      }

      case "run.completed": {
        // The Gate node's terminal state IS the run's terminal state (design doc §6.3): `passed`
        // renders `done`, and BOTH non-passing terminal statuses (`improved_still_failing` and
        // `no_improvement`) take the solid alarm fill this contract only has a `failed` state
        // for — a deliberate exception to the tab badge's outline/fill split elsewhere in the app,
        // spelled out in that section, not a contradiction of it.
        patch("gate", {
          state: event.status === "passed" ? "done" : "failed",
          cueId: event.id,
          progress: 1,
          payload: event.run,
          note: event.status,
        });
        bk.runningNodeId = null;
        break;
      }

      case "run.failed": {
        if (bk.runningNodeId) {
          patch(bk.runningNodeId, { state: "failed", cueId: event.id, error: event.error });
        }
        bk.runningNodeId = null;
        break;
      }

      default:
        break;
    }
  }

  return PIPELINE_NODES.map((n) => nodes.get(n.id) ?? n);
}

/**
 * The most recent real handoff event id for each edge that has ever carried one, keyed
 * `"<from>-><to>"`. Motion spec §9: a handoff is "an event that represents a genuine handoff
 * between agents, not merely a state change." In v1 that is `repairer.started` (Verify -> Repairer
 * actually hands off; the spec's own prose says "Evaluator -> Repairer" but the contract inserts
 * Verify between them) and `pass.started` for pass 2 and 3 (Gate's loop back into Evaluator).
 *
 * Pure and event-count-only: it never clears an id back to absent, because "has this edge ever
 * fired" is what a static replay can answer. Whether the flash has finished playing is a question
 * about wall-clock time, not about the event log, so `GraphEdge` owns clearing its own animation
 * state on a timer keyed by this id — see its own comment.
 */
export function edgeFlowTokensFromEvents(events: RunEvent[]): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const event of events) {
    if (event.name === "repairer.started") {
      tokens["verify->repairer"] = event.id;
    } else if (event.name === "pass.started" && event.pass > 1) {
      tokens["gate->evaluator"] = event.id;
    }
  }
  return tokens;
}

/** One line of the append-only audit record `CueLog` renders — every event received, never
 *  truncated within a run (design doc §5 "Architecture screen"). */
export type CueEntry = {
  cueId: string;
  label: string;
  state: "running" | "done" | "failed";
  /** Present only for events that carry a real measured `StepCost.latencyMs`. */
  ms?: number;
  at: number;
};

/** Turns the raw event log into the human line `CueLog` shows for each one. Pure and total: every
 *  member of `EVENT_NAMES` has a case, so a new event type is a compile error here, not a silently
 *  dropped row in the audit trail. */
export function cueEntriesFromEvents(events: RunEvent[]): CueEntry[] {
  return events.map((event): CueEntry => {
    const at = Date.parse(event.at);
    switch (event.name) {
      case "run.started":
        return { cueId: event.id, label: "run started", state: "running", at };
      case "pass.started":
        return { cueId: event.id, label: `pass ${event.pass} started`, state: "running", at };
      case "evaluator.group.started":
        return { cueId: event.id, label: `evaluator · ${event.group} started`, state: "running", at };
      case "evaluator.group.completed":
        return {
          cueId: event.id,
          label: `evaluator · ${event.group} done`,
          state: "done",
          ms: event.cost.latencyMs,
          at,
        };
      case "repairer.started":
        return { cueId: event.id, label: "repairer started", state: "running", at };
      case "repairer.completed":
        return { cueId: event.id, label: "repairer done", state: "done", ms: event.cost.latencyMs, at };
      case "pass.completed":
        return { cueId: event.id, label: `pass ${event.pass} completed`, state: "done", at };
      case "run.completed":
        return {
          cueId: event.id,
          label: `run ${event.status}`,
          state: event.status === "passed" ? "done" : "failed",
          at,
        };
      case "run.failed":
        return { cueId: event.id, label: `run failed: ${event.error}`, state: "failed", at };
    }
  });
}
