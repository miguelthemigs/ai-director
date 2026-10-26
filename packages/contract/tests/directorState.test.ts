import { describe, expect, it } from "vitest";
import {
  applyDirectorEvent,
  reduceDirectorEvents,
  type DirectorEvent,
  type DirectorEventBody,
} from "../src/index.js";

const ev = (body: DirectorEventBody, seq: number): DirectorEvent => ({
  ...body,
  runId: "r1",
  seq,
  at: `2026-10-26T00:00:${String(seq).padStart(2, "0")}Z`,
});
const start = ev({ type: "run.started", brief: "b" }, 1);
const log = (...bodies: DirectorEventBody[]) =>
  reduceDirectorEvents([start, ...bodies.map((b, i) => ev(b, i + 2))]);
const call = (microUsd: number | null) => ({
  model: "m", promptVersion: "v1", inputTokens: null, outputTokens: null, microUsd, latencyMs: 1,
});
const done = (
  node: "director" | "interrogator" | "cinematographer" | "assembler",
): Extract<DirectorEventBody, { type: "node.completed" }> => ({
  type: "node.completed", node, attempt: 1, outputRef: `nodes/${node}.1.json`,
  summary: "s", calls: [], latencyMs: 10,
});

describe("reduceDirectorEvents", () => {
  it("run.started queues every node, locks every gate, and records id, start and seq", () => {
    const v = reduceDirectorEvents([start]);
    expect(v.status).toBe("running");
    expect(v.id).toBe("r1");
    expect(v.brief).toBe("b");
    expect(v.startedAt).toBe(start.at);
    expect(v.lastSeq).toBe(1);
    expect(Object.values(v.nodes).every((n) => n.status === "queued")).toBe(true);
    expect(v.gates).toEqual({ A: "locked", B: "locked", C: "locked" });
  });

  it("gate.opened waits, gate.resolved approve resumes and sets seconds", () => {
    const opened = log({ type: "gate.opened", gate: "A" });
    expect(opened.gates.A).toBe("waiting");
    expect(opened.status).toBe("awaiting_gate");
    expect(opened.waitingAt).toBe("A");
    const v = log(
      { type: "gate.opened", gate: "A" },
      { type: "gate.resolved", gate: "A", decision: "approve", reason: null, seconds: 15 },
    );
    expect(v.gates.A).toBe("done");
    expect(v.status).toBe("running");
    expect(v.waitingAt).toBeNull();
    expect(v.seconds).toBe(15);
  });

  it("an approval without seconds leaves seconds alone", () => {
    const v = log(
      { type: "gate.resolved", gate: "A", decision: "approve", reason: null, seconds: 12 },
      { type: "gate.resolved", gate: "B", decision: "approve", reason: null, seconds: null },
    );
    expect(v.seconds).toBe(12);
  });

  it("gate.resolved reject rejects the run with its reason", () => {
    const v = log(
      { type: "gate.opened", gate: "B" },
      { type: "gate.resolved", gate: "B", decision: "reject", reason: "no", seconds: null },
    );
    expect(v.status).toBe("rejected");
    expect(v.reason).toBe("no");
    expect(v.waitingAt).toBeNull();
  });

  it("node.started, completed, failed and abandoned move a node", () => {
    expect(log({ type: "node.started", node: "director", attempt: 2, patchShots: null }).nodes.director)
      .toMatchObject({ status: "running", attempt: 2 });
    const completed = log({ ...done("director") });
    expect(completed.nodes.director).toMatchObject({
      status: "done", summary: "s", outputRef: "nodes/director.1.json",
    });
    const failed = log({ type: "node.failed", node: "director", attempt: 1, error: "boom" });
    expect(failed.nodes.director).toMatchObject({ status: "failed", error: "boom" });
    const abandoned = log(
      { type: "node.started", node: "director", attempt: 1, patchShots: null },
      { type: "node.abandoned", node: "director", attempt: 1 },
    );
    expect(abandoned.nodes.director.status).toBe("queued");
  });

  it("node.completed sums call cost, ignoring nulls", () => {
    const v = log(
      { ...done("director"), calls: [call(100), call(null), call(25)] },
      { ...done("cinematographer"), calls: [call(5)] },
    );
    expect(v.textMicroUsd).toBe(130);
  });

  it("checks.completed stores outcomes under plan or prompt", () => {
    const o = [{ id: "length_fits", passed: true, owner: "director", detail: null, shots: [] }] as const;
    const v = log(
      { type: "checks.completed", node: "planChecks", outcomes: [...o] },
      { type: "checks.completed", node: "promptChecks", outcomes: [] },
    );
    expect(v.checks.plan).toHaveLength(1);
    expect(v.checks.prompt).toHaveLength(0);
  });

  it("a routed failure re-queues the owner and its downstream, and counts the retry", () => {
    const v = reduceDirectorEvents([
      ev({ type: "run.started", brief: "b" }, 1),
      ev(done("director"), 2),
      ev({ type: "route.sent", owner: "director", checkIds: ["no_timestamps"], shots: [3], retry: 1 }, 3),
    ]);
    expect(v.nodes.director.status).toBe("queued");
    expect(v.nodes.planChecks.status).toBe("queued");
    expect(v.retries.director).toBe(1);
  });

  it("a routed failure stops at the checks node and spares unrelated nodes", () => {
    const v = log(
      done("interrogator"),
      done("director"),
      done("cinematographer"),
      done("assembler"),
      { type: "route.sent", owner: "cinematographer", checkIds: ["camera_per_shot"], shots: [1], retry: 2 },
    );
    expect(v.nodes.cinematographer.status).toBe("queued");
    expect(v.nodes.assembler.status).toBe("queued");
    expect(v.nodes.promptChecks.status).toBe("queued");
    expect(v.nodes.render.status).toBe("queued");
    expect(v.nodes.director.status).toBe("done");
    expect(v.nodes.interrogator.status).toBe("done");
    expect(v.retries).toEqual({ director: 0, cinematographer: 2 });
  });

  it("a stopped run blocks everything not done, and never reads as rendered", () => {
    const v = reduceDirectorEvents([
      ev({ type: "run.started", brief: "b" }, 1),
      ev({ type: "run.finished", status: "stopped", reason: "camera_per_shot after 2 retries" }, 2),
    ]);
    expect(v.status).toBe("stopped");
    expect(v.reason).toBe("camera_per_shot after 2 retries");
    expect(v.finishedAt).toBe("2026-10-26T00:00:02Z");
    expect(v.gates.C).toBe("blocked");
    expect(v.nodes.render.status).toBe("blocked");
  });

  it.each(["failed", "rejected", "render_failed"] as const)(
    "run.finished %s blocks what is not done and keeps done work",
    (status) => {
      const v = log(
        done("interrogator"),
        { type: "gate.resolved", gate: "A", decision: "approve", reason: null, seconds: 10 },
        { type: "run.finished", status, reason: "x" },
      );
      expect(v.status).toBe(status);
      expect(v.nodes.interrogator.status).toBe("done");
      expect(v.gates.A).toBe("done");
      expect(v.nodes.director.status).toBe("blocked");
      expect(v.gates.B).toBe("blocked");
    },
  );

  const submitted = { type: "render.submitted", attempt: 1, taskId: "t", estimatedMicroUsd: 3_470_000 } as const;

  it("render.submitted starts a render attempt", () => {
    const v = log(submitted);
    expect(v.status).toBe("rendering");
    expect(v.nodes.render).toMatchObject({ status: "running", attempt: 1 });
    expect(v.render).toEqual({
      attempt: 1, status: "queued", billing: null, estimatedMicroUsd: 3_470_000,
      actualMicroUsd: null, failure: null,
    });
  });

  it("render.polled updates the render status only", () => {
    const v = log(submitted, { type: "render.polled", status: "running", reads: 2 });
    expect(v.render?.status).toBe("running");
    expect(v.status).toBe("rendering");
  });

  it("render.settled succeeded renders the run and keeps the estimate beside the actual", () => {
    const v = log(submitted, {
      type: "render.settled", status: "succeeded", billing: "billed", actualMicroUsd: 3_000_000, failure: null,
    });
    expect(v.status).toBe("rendered");
    expect(v.nodes.render.status).toBe("done");
    expect(v.render).toMatchObject({
      status: "succeeded", billing: "billed", actualMicroUsd: 3_000_000, estimatedMicroUsd: 3_470_000,
    });
  });

  it("render.settled failed or cancelled fails the render, never rendered", () => {
    for (const status of ["failed", "cancelled"] as const) {
      const v = log(submitted, {
        type: "render.settled", status, billing: "not_billed", actualMicroUsd: null, failure: "nope",
      });
      expect(v.status).toBe("render_failed");
      expect(v.nodes.render).toMatchObject({ status: "failed", error: "nope" });
      expect(v.render?.failure).toBe("nope");
    }
  });

  it("render again after render_failed is a fresh attempt on a blocked render node", () => {
    const v = log(
      submitted,
      { type: "render.settled", status: "failed", billing: "not_billed", actualMicroUsd: null, failure: "f" },
      { type: "run.finished", status: "render_failed", reason: "f" },
      { type: "render.submitted", attempt: 2, taskId: "t2", estimatedMicroUsd: 1 },
    );
    expect(v.nodes.render).toMatchObject({ status: "running", attempt: 2, error: null });
    expect(v.render).toMatchObject({ attempt: 2, status: "queued", failure: null, actualMicroUsd: null });
    expect(v.status).toBe("rendering");
  });

  it("applyDirectorEvent never mutates its input and returns a new object", () => {
    const before = reduceDirectorEvents([start]);
    const snapshot = JSON.stringify(before);
    const after = applyDirectorEvent(before, ev(done("director"), 2));
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after).not.toBe(before);
    expect(after.nodes).not.toBe(before.nodes);
  });
});
