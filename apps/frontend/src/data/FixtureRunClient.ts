import {
  CHECK_IDS,
  eventId,
  FIXTURE_EVENT_LOG,
  FIXTURE_RUNS,
  type Band,
  type CheckDelta,
  type CheckGroup,
  type CheckId,
  type PassView,
  type Percent,
  type ReplacementView,
  type RunEvent,
  type RunView,
  type StepCost,
  type VersionCompare,
  type VersionRow,
} from "@ai-director/contract";
import { diffLines } from "../domain/textDiff.js";
import { FIXTURE_VERSIONS, FIXTURE_VERSION_CONTENT } from "./versionFixtures.js";
import type { RunClient } from "./RunClient.js";

type Scenario = keyof typeof FIXTURE_RUNS;

const DEFAULT_SCENARIO: Scenario = "improvedStillFailing";
const DEFAULT_SPEED_MS = 320;

/** Cost shown on the synthesized steps of scenarios that don't ship their own event log. */
const STEP_COST: StepCost = { inputTokens: 1100, outputTokens: 600, usd: 0.02, latencyMs: 4200 };

const GROUP_ORDER: readonly CheckGroup[] = ["look", "safety", "drawable"];

const BAND_BY_PERCENT: Record<Percent, Band> = { 20: 1, 40: 2, 60: 3, 80: 4, 100: 5 };

/** `null` when the row itself has no profile yet — "not scored yet" (contract's own comment on
 *  `VersionRow.profile`), never a fabricated band for a check nothing has measured. */
function bandForCheck(profile: Record<CheckId, Percent> | null, checkId: CheckId): Band | null {
  return profile === null ? null : BAND_BY_PERCENT[profile[checkId]];
}

/** Rebuilds one pass's events in the same shape and order as the contract's own fixture log. */
function eventsForPass(pass: PassView): RunEvent[] {
  const at = new Date().toISOString();
  const byGroup = (group: CheckGroup) => pass.results.filter((r) => r.group === group);
  const [look, safety, drawable] = GROUP_ORDER.map(byGroup);
  const spanIds = pass.replacements.map((r) => r.spanId);
  return [
    { id: eventId(pass.pass, 0), name: "pass.started", at, pass: pass.pass, description: pass.description },
    { id: eventId(pass.pass, 1), name: "evaluator.group.started", at, pass: pass.pass, group: "look" },
    { id: eventId(pass.pass, 2), name: "evaluator.group.started", at, pass: pass.pass, group: "safety" },
    { id: eventId(pass.pass, 3), name: "evaluator.group.completed", at, pass: pass.pass, group: "look", results: look ?? [], cost: STEP_COST },
    { id: eventId(pass.pass, 4), name: "evaluator.group.started", at, pass: pass.pass, group: "drawable" },
    { id: eventId(pass.pass, 5), name: "evaluator.group.completed", at, pass: pass.pass, group: "safety", results: safety ?? [], cost: STEP_COST },
    { id: eventId(pass.pass, 6), name: "evaluator.group.completed", at, pass: pass.pass, group: "drawable", results: drawable ?? [], cost: STEP_COST },
    { id: eventId(pass.pass, 7), name: "repairer.started", at, pass: pass.pass, spanIds },
    { id: eventId(pass.pass, 8), name: "repairer.completed", at, pass: pass.pass, replacements: pass.replacements as ReplacementView[], cost: STEP_COST },
    { id: eventId(pass.pass, 9), name: "pass.completed", at, pass: pass.pass, repairedDescription: pass.repairedDescription, failing: pass.failing },
  ];
}

/** Rebuilds a full run's event log from its `RunView`, for scenarios other than the one the
 *  contract package ships a real, wall-clock-ordered log for. */
function buildEventLog(run: RunView): RunEvent[] {
  const at = new Date().toISOString();
  const events: RunEvent[] = [
    {
      id: eventId(0, 0),
      name: "run.started",
      at,
      runId: run.runId,
      rubricVersion: run.rubricVersion,
      model: run.model,
      description: run.originalDescription,
    },
  ];
  for (const pass of run.passes) events.push(...eventsForPass(pass));
  events.push(
    run.status === "failed"
      ? { id: eventId(0, 1), name: "run.failed", at, error: run.error ?? "unknown error" }
      : { id: eventId(0, 1), name: "run.completed", at, status: run.status, run },
  );
  return events;
}

const EVENT_LOGS: Record<Scenario, RunEvent[]> = {
  // The contract already ships a hand-ordered log (interleaved groups, real ticking clock) for
  // this one scenario; reuse it rather than rebuild a lesser copy.
  improvedStillFailing: FIXTURE_EVENT_LOG,
  passed: buildEventLog(FIXTURE_RUNS.passed),
  noImprovement: buildEventLog(FIXTURE_RUNS.noImprovement),
  failed: buildEventLog(FIXTURE_RUNS.failed),
};

function isTerminalEventName(name: RunEvent["name"]): boolean {
  return name === "run.completed" || name === "run.failed";
}

type Listener = (event: RunEvent) => void;

type RunRecord = {
  events: RunEvent[];
  /** The run as it should read once the terminal event has landed. */
  finalView: RunView;
  view: RunView;
  listeners: Set<Listener>;
  timer: ReturnType<typeof setTimeout> | undefined;
  nextIndex: number;
  speedMs: number;
};

/**
 * Replays `FIXTURE_EVENT_LOG` (or, for the other three scenarios, an equivalent log built the
 * same way) on a real timer, `speedMs` per event. Every screen built against this client sees
 * events land one at a time, exactly as it will from SSE in production — a fixture that resolved
 * a finished run in one tick would hide every streaming bug the design exists to handle.
 */
export class FixtureRunClient implements RunClient {
  readonly isFixture = true;

  private readonly speedMs: number;
  private readonly scenario: Scenario;
  private readonly runs = new Map<string, RunRecord>();
  private counter = 0;

  constructor(options?: { speedMs?: number; scenario?: Scenario }) {
    this.speedMs = options?.speedMs ?? DEFAULT_SPEED_MS;
    this.scenario = options?.scenario ?? DEFAULT_SCENARIO;
  }

  async startRun(description: string): Promise<{ runId: string }> {
    this.counter += 1;
    const runId = `fixture-${this.counter}-${Date.now()}`;
    const finalRun = FIXTURE_RUNS[this.scenario];
    const finalView: RunView = { ...finalRun, runId };
    const runningView: RunView = {
      ...finalView,
      status: "running",
      finishedAt: undefined,
      originalDescription: description,
      passes: [],
    };
    const events = EVENT_LOGS[this.scenario];

    this.runs.set(runId, {
      events,
      finalView,
      view: runningView,
      listeners: new Set(),
      timer: undefined,
      nextIndex: 0,
      speedMs: this.speedMs,
    });

    // The run starts advancing the moment it starts, exactly as a server-side run would — not
    // only once someone happens to be subscribed. A caller that only ever polls `getRun` must
    // still see it reach its terminal state.
    this.scheduleNext(runId);

    return { runId };
  }

  async getRun(runId: string): Promise<RunView> {
    return this.mustGet(runId).view;
  }

  async listRuns(): Promise<RunView[]> {
    return [...this.runs.values()].map((record) => record.view);
  }

  async listVersions(): Promise<VersionRow[]> {
    return [...FIXTURE_VERSIONS];
  }

  async compareVersions(a: string, b: string): Promise<VersionCompare> {
    const rowA = FIXTURE_VERSIONS.find((version) => version.id === a);
    const rowB = FIXTURE_VERSIONS.find((version) => version.id === b);
    if (!rowA || !rowB) {
      throw new Error(`FixtureRunClient: unknown version id ${rowA ? b : a}`);
    }

    const promptDiff = diffLines(FIXTURE_VERSION_CONTENT[a] ?? [], FIXTURE_VERSION_CONTENT[b] ?? []);

    const perCheck: CheckDelta[] = CHECK_IDS.map((checkId) => {
      const bandA = bandForCheck(rowA.profile, checkId);
      const bandB = bandForCheck(rowB.profile, checkId);
      // Null the instant either side is unmeasured — never coerce an unmeasured side to zero
      // (contract's own comment on `CheckDelta.deltaPercent`).
      const deltaPercent =
        rowA.profile === null || rowB.profile === null ? null : rowB.profile[checkId] - rowA.profile[checkId];
      return { checkId, deltaPercent, bandA, bandB };
    });

    return { a: rowA, b: rowB, promptDiff, perCheck };
  }

  subscribe(runId: string, from: string | undefined, sink: Listener): () => void {
    const record = this.mustGet(runId);
    record.listeners.add(sink);

    if (from !== undefined) {
      const at = record.events.findIndex((event) => event.id === from);
      if (at >= 0) record.nextIndex = Math.max(record.nextIndex, at + 1);
    }

    this.scheduleNext(runId);

    return () => {
      record.listeners.delete(sink);
      if (record.listeners.size === 0 && record.timer) {
        clearTimeout(record.timer);
        record.timer = undefined;
      }
    };
  }

  private mustGet(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`FixtureRunClient: unknown run id ${runId}`);
    return record;
  }

  private scheduleNext(runId: string): void {
    const record = this.mustGet(runId);
    if (record.timer !== undefined) return;
    if (record.nextIndex >= record.events.length) return;

    record.timer = setTimeout(() => {
      record.timer = undefined;
      const event = record.events[record.nextIndex];
      record.nextIndex += 1;
      if (event) {
        if (isTerminalEventName(event.name)) record.view = record.finalView;
        for (const listener of [...record.listeners]) listener(event);
      }
      // Keep advancing regardless of whether anyone is currently subscribed — a run is not
      // waiting on a viewer. Only an explicit unsubscribe (see below) ever halts delivery.
      this.scheduleNext(runId);
    }, record.speedMs);
  }
}
