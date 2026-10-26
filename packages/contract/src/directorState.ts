import {
  DIRECTOR_NODE_IDS,
  DIRECTOR_RECIPE_EDGES,
  GATE_IDS,
  type DirectorEvent,
  type DirectorNodeId,
  type DirectorNodeView,
  type DirectorRunView,
  type GateId,
} from "./director.js";

const emptyNode = (): DirectorNodeView => ({
  status: "queued",
  attempt: 0,
  summary: null,
  outputRef: null,
  error: null,
});

const emptyView = (): DirectorRunView => ({
  id: "",
  brief: "",
  status: "running",
  waitingAt: null,
  seconds: null,
  nodes: Object.fromEntries(DIRECTOR_NODE_IDS.map((id) => [id, emptyNode()])) as Record<
    DirectorNodeId,
    DirectorNodeView
  >,
  gates: { A: "locked", B: "locked", C: "locked" },
  retries: { director: 0, cinematographer: 0 },
  checks: { plan: [], prompt: [] },
  textMicroUsd: 0,
  render: null,
  reason: null,
  lastSeq: 0,
  startedAt: "",
  finishedAt: null,
});

const BLOCKING_FINISHES = new Set(["stopped", "failed", "rejected", "render_failed"]);
const CHECK_NODES = new Set<string>(["planChecks", "promptChecks"]);
const isNode = (id: string): id is DirectorNodeId => (DIRECTOR_NODE_IDS as readonly string[]).includes(id);

/** The owner and every node downstream of it, stopping at (and including) a checks node. */
function nodesToRerun(owner: DirectorNodeId): DirectorNodeId[] {
  const seen = new Set<DirectorNodeId>([owner]);
  const queue: DirectorNodeId[] = [owner];
  while (queue.length > 0) {
    const current = queue.shift() as DirectorNodeId;
    if (CHECK_NODES.has(current)) continue;
    for (const edge of DIRECTOR_RECIPE_EDGES) {
      if (edge.from === current && isNode(edge.to) && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return [...seen];
}

/** Pure: returns a new view and never mutates its input, so identity changes on every event. */
export function applyDirectorEvent(view: DirectorRunView, event: DirectorEvent): DirectorRunView {
  const next: DirectorRunView = {
    ...view,
    nodes: { ...view.nodes },
    gates: { ...view.gates },
    retries: { ...view.retries },
    checks: { ...view.checks },
    lastSeq: event.seq,
  };
  const patchNode = (id: DirectorNodeId, patch: Partial<DirectorNodeView>) => {
    next.nodes[id] = { ...next.nodes[id], ...patch };
  };

  switch (event.type) {
    case "run.started":
      next.id = event.runId;
      next.brief = event.brief;
      next.startedAt = event.at;
      next.status = "running";
      for (const id of DIRECTOR_NODE_IDS) next.nodes[id] = emptyNode();
      for (const id of GATE_IDS) next.gates[id] = "locked";
      break;
    case "gate.opened":
      next.gates[event.gate] = "waiting";
      next.status = "awaiting_gate";
      next.waitingAt = event.gate;
      break;
    case "gate.resolved":
      next.waitingAt = null;
      if (event.decision === "approve") {
        next.gates[event.gate] = "done";
        next.status = "running";
        if (event.seconds !== null) next.seconds = event.seconds;
      } else {
        next.status = "rejected";
        next.reason = event.reason;
      }
      break;
    case "node.started":
      patchNode(event.node, { status: "running", attempt: event.attempt });
      break;
    case "node.completed":
      patchNode(event.node, {
        status: "done",
        attempt: event.attempt,
        summary: event.summary,
        outputRef: event.outputRef,
        error: null,
      });
      next.textMicroUsd += event.calls.reduce((sum, call) => sum + (call.microUsd ?? 0), 0);
      break;
    case "node.failed":
      patchNode(event.node, { status: "failed", error: event.error });
      break;
    case "node.abandoned":
      patchNode(event.node, { status: "queued" });
      break;
    case "checks.completed":
      next.checks[event.node === "planChecks" ? "plan" : "prompt"] = event.outcomes;
      break;
    case "route.sent":
      next.retries[event.owner] = event.retry;
      for (const id of nodesToRerun(event.owner)) patchNode(id, { status: "queued" });
      break;
    case "render.submitted":
      next.status = "rendering";
      next.reason = null;
      next.finishedAt = null;
      patchNode("render", { status: "running", attempt: event.attempt, error: null });
      next.render = {
        attempt: event.attempt,
        status: "queued",
        billing: null,
        estimatedMicroUsd: event.estimatedMicroUsd,
        actualMicroUsd: null,
        failure: null,
      };
      break;
    case "render.polled":
      if (next.render) next.render = { ...next.render, status: event.status };
      break;
    case "render.settled": {
      // A submit that failed logged no `render.submitted`: this attempt opens its own record
      // rather than writing onto (or past) the previous attempt's.
      const base =
        next.render !== null && next.render.attempt === event.attempt
          ? next.render
          : {
              attempt: event.attempt,
              status: "queued" as const,
              billing: null,
              estimatedMicroUsd: event.estimatedMicroUsd,
              actualMicroUsd: null,
              failure: null,
            };
      next.render = {
        ...base,
        status: event.status,
        billing: event.billing,
        actualMicroUsd: event.actualMicroUsd,
        failure: event.failure,
      };
      const ok = event.status === "succeeded";
      patchNode("render", {
        status: ok ? "done" : "failed",
        attempt: event.attempt,
        error: ok ? null : event.failure,
      });
      next.status = ok ? "rendered" : "render_failed";
      break;
    }
    case "run.finished":
      next.status = event.status;
      next.reason = event.reason;
      next.finishedAt = event.at;
      next.waitingAt = null;
      if (BLOCKING_FINISHES.has(event.status)) {
        for (const id of DIRECTOR_NODE_IDS) {
          if (next.nodes[id].status !== "done") patchNode(id, { status: "blocked" });
        }
        for (const id of GATE_IDS as readonly GateId[]) {
          if (next.gates[id] !== "done") next.gates[id] = "blocked";
        }
      }
      break;
  }
  return next;
}

export function reduceDirectorEvents(events: DirectorEvent[]): DirectorRunView {
  return events.reduce(applyDirectorEvent, emptyView());
}
