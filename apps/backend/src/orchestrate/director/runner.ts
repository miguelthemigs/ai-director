import {
  DIRECTOR_RECIPE_EDGES,
  GATE_IDS,
  reduceDirectorEvents,
  type CheckOutcome,
  type DirectorEvent,
  type DirectorEventBody,
  type DirectorNodeId,
  type DirectorRunStatus,
  type DirectorRunView,
  type GateAAnswers,
  type GateId,
} from "@ai-director/contract";
import type { DirectorRunStore } from "../../store/DirectorRunStore.js";
import type { NodeContext, NodeSpec } from "./recipe.js";
import { route } from "./router.js";

export type RunnerDeps = { store: DirectorRunStore; recipe: NodeSpec[]; publish?: (ev: DirectorEvent) => void };

/** The gate asked about is not the one the run is waiting at (the HTTP route answers 409). */
export class GateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateConflictError";
  }
}

const TERMINAL: ReadonlySet<DirectorRunStatus> = new Set([
  "rendered",
  "render_failed",
  "stopped",
  "rejected",
  "failed",
]);
const CHECK_NODES = ["planChecks", "promptChecks"] as const;
type CheckNode = (typeof CHECK_NODES)[number];

const isGate = (id: string): id is GateId => (GATE_IDS as readonly string[]).includes(id);

/** The nodes a gate waits for, from the recipe edges. */
const gateAfter = (gate: GateId): DirectorNodeId[] =>
  DIRECTOR_RECIPE_EDGES.filter((edge) => edge.to === gate && !isGate(edge.from)).map(
    (edge) => edge.from as DirectorNodeId,
  );

/** The gate a checks node guards. */
const gateOf = (node: CheckNode): GateId =>
  DIRECTOR_RECIPE_EDGES.find((edge) => edge.from === node && isGate(edge.to))!.to as GateId;

/** Tail of each run's lock chain: drives, gate answers and resumes on one run never overlap. */
const locks = new Map<string, Promise<void>>();

function withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(runId) ?? Promise.resolve();
  const result = previous.then(work);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(runId, tail);
  void tail.then(() => {
    if (locks.get(runId) === tail) locks.delete(runId);
  });
  return result;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function emitter(deps: RunnerDeps, runId: string) {
  return async (body: DirectorEventBody): Promise<DirectorEvent> => {
    const event = await deps.store.append(runId, body);
    deps.publish?.(event);
    return event;
  };
}

/**
 * The patch for a node started because a failed check was routed to it: the latest `route.sent`
 * addressed to it that it has not yet completed since, with that owner's failing outcomes from
 * the checks that caused it. Null for every other start.
 */
function patchFor(events: DirectorEvent[], node: DirectorNodeId): NodeContext["patch"] {
  if (node !== "director" && node !== "cinematographer") return null;
  let routeAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "node.completed" && event.node === node) return null;
    if (event.type === "route.sent" && event.owner === node) {
      routeAt = i;
      break;
    }
  }
  if (routeAt < 0) return null;
  const sent = events[routeAt] as Extract<DirectorEvent, { type: "route.sent" }>;
  const checks = events
    .slice(0, routeAt)
    .reverse()
    .find((event): event is Extract<DirectorEvent, { type: "checks.completed" }> => event.type === "checks.completed");
  const failures = (checks?.outcomes ?? []).filter((outcome) => !outcome.passed && outcome.owner === node);
  return { checkIds: sent.checkIds, shots: sent.shots, failures };
}

function isReady(spec: NodeSpec, view: DirectorRunView): boolean {
  return (
    view.nodes[spec.id].status === "queued" &&
    spec.after.every((dep) => (isGate(dep) ? view.gates[dep] === "done" : view.nodes[dep].status === "done"))
  );
}

/**
 * Records the verdict of a finished checks node whose gate is still locked: `checks.completed` if
 * it is not yet logged for this completion, then `route.sent` or `run.finished stopped`. Returns
 * true when it appended anything. Idempotent, so a crash between those appends is recovered.
 */
async function settleChecks(
  deps: RunnerDeps,
  runId: string,
  events: DirectorEvent[],
  view: DirectorRunView,
  emit: ReturnType<typeof emitter>,
): Promise<boolean> {
  for (const node of CHECK_NODES) {
    const state = view.nodes[node];
    if (state.status !== "done" || view.gates[gateOf(node)] !== "locked") continue;

    const completedSeq = events.findLast((e) => e.type === "node.completed" && e.node === node)!.seq;
    const logged = events.findLast(
      (e): e is Extract<DirectorEvent, { type: "checks.completed" }> =>
        e.type === "checks.completed" && e.node === node && e.seq > completedSeq,
    );
    let appended = false;
    let outcomes: CheckOutcome[];
    if (logged) {
      outcomes = logged.outcomes;
    } else {
      outcomes = await deps.store.readOutput<CheckOutcome[]>(runId, state.outputRef!);
      await emit({ type: "checks.completed", node, outcomes });
      appended = true;
    }

    const verdict = route(outcomes, view.retries);
    if (verdict.kind === "redo") {
      const { owner, checkIds, shots, retry } = verdict;
      await emit({ type: "route.sent", owner, checkIds, shots, retry });
      return true;
    }
    if (verdict.kind === "stop") {
      await emit({ type: "run.finished", status: "stopped", reason: verdict.reason });
      return true;
    }
    if (appended) return true;
  }
  return false;
}

type Settled = { node: DirectorNodeId; error: string | null };

/** Appends `node.started`, then returns the node's run (wrapped, so awaiting the start does not await the run). */
async function startNode(
  deps: RunnerDeps,
  runId: string,
  spec: NodeSpec,
  events: DirectorEvent[],
  view: DirectorRunView,
  emit: ReturnType<typeof emitter>,
): Promise<{ settled: Promise<Settled> }> {
  const attempt = view.nodes[spec.id].attempt + 1;
  const patch = patchFor(events, spec.id);
  await emit({ type: "node.started", node: spec.id, attempt, patchShots: patch?.shots ?? null });

  const ctx: NodeContext = {
    runId,
    attempt,
    patch,
    view,
    read: async <T>(node: DirectorNodeId) => {
      const ref = view.nodes[node].outputRef;
      if (ref === null) throw new Error(`${node} has no output yet`);
      return deps.store.readOutput<T>(runId, ref);
    },
    answers: async () => {
      const answers = await deps.store.readAnswers(runId);
      if (answers === null) throw new Error("gate A has not been answered");
      return answers;
    },
  };

  const started = Date.now();
  const settled = (async (): Promise<Settled> => {
    try {
      const result = await spec.run(ctx);
      const latencyMs = Date.now() - started;
      const outputRef = await deps.store.writeOutput(runId, spec.id, attempt, result.output);
      await emit({
        type: "node.completed",
        node: spec.id,
        attempt,
        outputRef,
        summary: result.summary,
        calls: result.calls,
        latencyMs,
      });
      return { node: spec.id, error: null };
    } catch (error) {
      const text = message(error);
      await emit({ type: "node.failed", node: spec.id, attempt, error: text });
      return { node: spec.id, error: text };
    }
  })();
  return { settled };
}

/**
 * One drive, under the run's lock: start every ready node at once, record each result, route
 * checks, and stop at a gate, a terminal state, or when nothing is left to start. A node that
 * fails stops new starts; its siblings in flight finish and are logged before the run fails.
 */
async function drive(deps: RunnerDeps, runId: string): Promise<void> {
  const emit = emitter(deps, runId);
  const inFlight = new Map<DirectorNodeId, Promise<Settled>>();
  let failure: string | null = null;

  for (;;) {
    if (failure === null) {
      const events = await deps.store.events(runId);
      const view = reduceDirectorEvents(events);
      if (TERMINAL.has(view.status) || view.status === "awaiting_gate") return;

      if (inFlight.size === 0) {
        if (await settleChecks(deps, runId, events, view, emit)) continue;
        const gate = GATE_IDS.find(
          (id) => view.gates[id] === "locked" && gateAfter(id).every((node) => view.nodes[node].status === "done"),
        );
        if (gate !== undefined) {
          await emit({ type: "gate.opened", gate });
          return;
        }
      }

      for (const spec of deps.recipe) {
        if (inFlight.has(spec.id) || !isReady(spec, view)) continue;
        const { settled } = await startNode(deps, runId, spec, events, view, emit);
        inFlight.set(spec.id, settled);
      }
    }

    if (inFlight.size === 0) {
      if (failure !== null) await emit({ type: "run.finished", status: "failed", reason: failure });
      return;
    }
    const settled = await Promise.race(inFlight.values());
    inFlight.delete(settled.node);
    if (settled.error !== null && failure === null) failure = settled.error;
  }
}

/** Creates the run (`run.started`) and returns its id; the caller fires `driveDirectorRun`. */
export async function startDirectorRun(deps: RunnerDeps, brief: string): Promise<string> {
  const runId = await deps.store.createRun(brief);
  for (const event of await deps.store.events(runId)) deps.publish?.(event);
  return runId;
}

export function driveDirectorRun(deps: RunnerDeps, runId: string): Promise<void> {
  return withRunLock(runId, () => drive(deps, runId));
}

/**
 * Answers the gate the run is waiting at, then drives on. Throws GateConflictError, appending
 * nothing, unless the run is waiting at exactly this gate. Approving gate A requires the answers.
 * Approving gate C only records the approval: render is started by the gate C route, not here.
 */
export async function resolveGate(
  deps: RunnerDeps,
  runId: string,
  gate: GateId,
  decision: { decision: "approve"; answers?: GateAAnswers } | { decision: "reject"; reason: string },
): Promise<void> {
  await withRunLock(runId, async () => {
    const view = reduceDirectorEvents(await deps.store.events(runId));
    if (view.waitingAt !== gate) {
      throw new GateConflictError(
        `run ${runId} is waiting at ${view.waitingAt === null ? "no gate" : `gate ${view.waitingAt}`}, not gate ${gate}`,
      );
    }
    const emit = emitter(deps, runId);
    if (decision.decision === "reject") {
      await emit({ type: "gate.resolved", gate, decision: "reject", reason: decision.reason, seconds: null });
      await emit({ type: "run.finished", status: "rejected", reason: decision.reason });
      return;
    }
    let seconds: number | null = null;
    if (gate === "A") {
      if (decision.answers === undefined) throw new Error("approving gate A needs the answers");
      await deps.store.writeAnswers(runId, decision.answers);
      seconds = decision.answers.seconds;
    }
    await emit({ type: "gate.resolved", gate, decision: "approve", reason: null, seconds });
  });
  await driveDirectorRun(deps, runId);
}

/**
 * After a restart: every recipe node left `running` is logged `node.abandoned` (it re-runs as the
 * next attempt), then every run that is neither finished nor waiting at a gate is driven.
 * `render` is not a recipe node, so a render in flight is left to the render resume.
 */
export async function resumeAllDirectorRuns(deps: RunnerDeps): Promise<void> {
  const ids = await deps.store.listIds();
  const results = await Promise.allSettled(
    ids.map((runId) =>
      withRunLock(runId, async () => {
        const view = reduceDirectorEvents(await deps.store.events(runId));
        if (view.id === "" || TERMINAL.has(view.status)) return;
        const emit = emitter(deps, runId);
        for (const spec of deps.recipe) {
          const node = view.nodes[spec.id];
          if (node.status === "running") await emit({ type: "node.abandoned", node: spec.id, attempt: node.attempt });
        }
        if (view.status !== "awaiting_gate") await drive(deps, runId);
      }),
    ),
  );
  const failed = results.flatMap((result, i) =>
    result.status === "rejected" ? [`${ids[i]}: ${message(result.reason)}`] : [],
  );
  if (failed.length > 0) throw new Error(`could not resume ${failed.join("; ")}`);
}
