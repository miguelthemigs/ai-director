import { describe, expect, it } from "vitest";
import {
  FIXTURE_EVENT_LOG,
  PIPELINE_NODES,
  type RunEvent,
} from "@ai-director/contract";
import { nodesFromEvents } from "../../src/domain/derive.js";

const PLANNED_IDS = ["interrogator", "director", "identity"];

function nodeById(nodes: ReturnType<typeof nodesFromEvents>, id: string) {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`no node with id ${id} in derived output`);
  return node;
}

describe("nodesFromEvents", () => {
  it("with no events, returns every node queued except the three planned agents", () => {
    const nodes = nodesFromEvents([]);
    expect(nodes).toHaveLength(PIPELINE_NODES.length);
    for (const node of nodes) {
      if (PLANNED_IDS.includes(node.id)) {
        expect(node.state).toBe("planned");
      } else {
        expect(node.state).toBe("queued");
      }
    }
  });

  it("moves the evaluator to running on evaluator.group.started", () => {
    const events: RunEvent[] = [
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:00.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:01.000Z", pass: 1, group: "look" },
    ];
    const nodes = nodesFromEvents(events);
    expect(nodeById(nodes, "evaluator").state).toBe("running");
  });

  it("moves the evaluator through progress 1/3, 2/3, 3/3 to done across its three group completions", () => {
    const cost = { inputTokens: 100, outputTokens: 50, usd: 0.01, latencyMs: 500 };
    const base: RunEvent[] = [
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:00.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:01.000Z", pass: 1, group: "look" },
    ];

    const afterFirst = nodesFromEvents([
      ...base,
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost },
    ]);
    expect(nodeById(afterFirst, "evaluator").state).toBe("running");
    expect(nodeById(afterFirst, "evaluator").progress).toBeCloseTo(1 / 3);

    const afterSecond = nodesFromEvents([
      ...base,
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost },
      { id: "1-3", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "safety", results: [], cost },
    ]);
    expect(nodeById(afterSecond, "evaluator").state).toBe("running");
    expect(nodeById(afterSecond, "evaluator").progress).toBeCloseTo(2 / 3);

    const afterThird = nodesFromEvents([
      ...base,
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost },
      { id: "1-3", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "safety", results: [], cost },
      { id: "1-4", name: "evaluator.group.completed", at: "2026-01-01T00:00:04.000Z", pass: 1, group: "drawable", results: [], cost },
    ]);
    expect(nodeById(afterThird, "evaluator").state).toBe("done");
    expect(nodeById(afterThird, "evaluator").progress).toBeCloseTo(1);
  });

  // Fix round 2: `StepCost`'s fields are each independently optional (a real run's cost may be
  // wholly unmeasured, since nothing upstream of the server measures tokens or latency yet -- see
  // apps/backend/src/server/server.ts). The evaluator node accumulates cost across three group
  // calls in a running total that starts at 0, so summing three unmeasured events must still say
  // "not measured", not report the accumulator's untouched initial zero as if it were a real
  // measurement. This is the test that would have caught fix round 1's `?? 0` regression, which
  // made every real run's Evaluator node show a fabricated $0.00 / 0 tokens.
  it("reports no cost fields for the evaluator when every group.completed event carries none", () => {
    const events: RunEvent[] = [
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:00.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:01.000Z", pass: 1, group: "look" },
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost: {} },
      { id: "1-3", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "safety", results: [], cost: {} },
      { id: "1-4", name: "evaluator.group.completed", at: "2026-01-01T00:00:04.000Z", pass: 1, group: "drawable", results: [], cost: {} },
    ];
    const evaluator = nodeById(nodesFromEvents(events), "evaluator");
    expect(evaluator.tokensIn).toBeUndefined();
    expect(evaluator.tokensOut).toBeUndefined();
    expect(evaluator.costUsd).toBeUndefined();
    expect(evaluator.latencyMs).toBeUndefined();
  });

  it("sums real per-group costs across all three groups once any of them is measured", () => {
    const cost = { inputTokens: 100, outputTokens: 50, usd: 0.01, latencyMs: 500 };
    const events: RunEvent[] = [
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:00.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:01.000Z", pass: 1, group: "look" },
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost },
      { id: "1-3", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "safety", results: [], cost },
      { id: "1-4", name: "evaluator.group.completed", at: "2026-01-01T00:00:04.000Z", pass: 1, group: "drawable", results: [], cost },
    ];
    const evaluator = nodeById(nodesFromEvents(events), "evaluator");
    expect(evaluator.tokensIn).toBe(300);
    expect(evaluator.tokensOut).toBe(150);
    expect(evaluator.costUsd).toBeCloseTo(0.03);
    expect(evaluator.latencyMs).toBe(1500);
  });

  it("shows the partial sum, not 'not measured', when only some of the pass's groups had a measured cost", () => {
    const cost = { inputTokens: 100, outputTokens: 50, usd: 0.01, latencyMs: 500 };
    const events: RunEvent[] = [
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:00.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:01.000Z", pass: 1, group: "look" },
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look", results: [], cost: {} },
      { id: "1-3", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "safety", results: [], cost },
    ];
    const evaluator = nodeById(nodesFromEvents(events), "evaluator");
    expect(evaluator.tokensIn).toBe(100);
    expect(evaluator.costUsd).toBeCloseTo(0.01);
  });

  it("moves only the currently-running node to failed on run.failed, leaving every other node alone", () => {
    const cost = { inputTokens: 100, outputTokens: 50, usd: 0.01, latencyMs: 500 };
    const events: RunEvent[] = [
      { id: "0-0", name: "run.started", at: "2026-01-01T00:00:00.000Z", runId: "r1", rubricVersion: "1.0.0", model: "m", description: "d" },
      { id: "1-0", name: "pass.started", at: "2026-01-01T00:00:01.000Z", pass: 1, description: "d" },
      { id: "1-1", name: "evaluator.group.started", at: "2026-01-01T00:00:02.000Z", pass: 1, group: "look" },
      { id: "1-2", name: "evaluator.group.completed", at: "2026-01-01T00:00:03.000Z", pass: 1, group: "look", results: [], cost },
      { id: "1-3", name: "run.failed", at: "2026-01-01T00:00:04.000Z", error: "upstream 503" },
    ];

    const nodes = nodesFromEvents(events);
    expect(nodeById(nodes, "evaluator").state).toBe("failed");
    expect(nodeById(nodes, "evaluator").error).toBe("upstream 503");
    // intake already reached `done` from run.started, and run.failed must not touch it.
    expect(nodeById(nodes, "intake").state).toBe("done");
    // Nodes that never started stay queued.
    expect(nodeById(nodes, "repairer").state).toBe("queued");
    expect(nodeById(nodes, "splice").state).toBe("queued");
    expect(nodeById(nodes, "gate").state).toBe("queued");
  });

  it("never moves a planned node off planned, across the entire fixture event log", () => {
    const nodes = nodesFromEvents(FIXTURE_EVENT_LOG);
    for (const id of PLANNED_IDS) {
      expect(nodeById(nodes, id).state).toBe("planned");
    }
  });

  it("gives every node with no measured cost no cost fields at all, never a fabricated zero", () => {
    const nodes = nodesFromEvents(FIXTURE_EVENT_LOG);
    const intake = nodeById(nodes, "intake");
    expect(intake.costUsd).toBeUndefined();
  });

  // Fix round 1: Verify's and Splice's latency was previously derived as the wall-clock gap
  // between two real event timestamps (repairer.started - lastGroupCompleted; pass.completed -
  // repairer.completed). Review found that gap can silently contain a full, invisible-on-the-wire
  // `retryVerbatim` model call in the backend (apps/backend/src/orchestrate/runPass.ts), so the
  // number looked measured but was not honestly attributable to that step. The fix is to never
  // derive it at all, so `formatLatency` renders "not measured" the same way it already does for
  // these nodes' token/cost fields. `FIXTURE_EVENT_LOG`'s own timestamps are seconds apart (real,
  // non-zero gaps) precisely so this test cannot pass by accident of a zero gap looking absent.
  it("reports no latency for verify, splice or gate, even though their bracketing events carry real, non-zero timestamp gaps", () => {
    const nodes = nodesFromEvents(FIXTURE_EVENT_LOG);
    expect(nodeById(nodes, "verify").latencyMs).toBeUndefined();
    expect(nodeById(nodes, "splice").latencyMs).toBeUndefined();
    expect(nodeById(nodes, "gate").latencyMs).toBeUndefined();
  });
});
