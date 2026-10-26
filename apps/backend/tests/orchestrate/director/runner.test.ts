import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  reduceDirectorEvents,
  type CheckOutcome,
  type DirectorEvent,
  type DirectorNodeId,
  type GateAAnswers,
} from "@ai-director/contract";
import { FileDirectorRunStore } from "../../../src/store/FileDirectorRunStore.js";
import {
  buildRecipe,
  type DirectorAgents,
  type NodeContext,
  type NodeResult,
} from "../../../src/orchestrate/director/recipe.js";
import {
  GateConflictError,
  driveDirectorRun,
  resolveGate,
  resumeAllDirectorRuns,
  startDirectorRun,
  type RunnerDeps,
} from "../../../src/orchestrate/director/runner.js";

type AgentId = keyof DirectorAgents;

const roots: string[] = [];
async function newRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "director-runner-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ANSWERS: GateAAnswers = {
  productPhotoAsset: "assets/product.png",
  productKind: "bottle",
  seconds: 12,
  mustNotAppear: [],
  cast: { kind: "new" },
};

const pass = (id: CheckOutcome["id"], owner: CheckOutcome["owner"]): CheckOutcome => ({
  id,
  owner,
  passed: true,
  detail: null,
  shots: [],
});
const fail = (id: CheckOutcome["id"], owner: CheckOutcome["owner"], shots: number[]): CheckOutcome => ({
  id,
  owner,
  passed: false,
  detail: `${id} failed`,
  shots,
});

const AGENT_IDS: AgentId[] = [
  "interrogator",
  "director",
  "planChecks",
  "product",
  "location",
  "character",
  "cinematographer",
  "assembler",
  "promptChecks",
];

/** Fake agents: each records the context it was called with; `bodies` overrides the default body. */
function fakeAgents(bodies: Partial<Record<AgentId, (ctx: NodeContext, call: number) => Promise<unknown>>> = {}) {
  const calls = Object.fromEntries(AGENT_IDS.map((id) => [id, [] as NodeContext[]])) as Record<
    AgentId,
    NodeContext[]
  >;
  const defaults: Record<AgentId, () => unknown> = {
    interrogator: () => ({ brief: "filled" }),
    director: () => ({ plan: "p" }),
    planChecks: () => [pass("length_fits", "director")],
    product: () => ({ picture: "product" }),
    location: () => ({ picture: "location" }),
    character: () => ({ character: "c" }),
    cinematographer: () => ({ cameras: [] }),
    assembler: () => ({ text: "prompt" }),
    promptChecks: () => [pass("camera_per_shot", "cinematographer")],
  };
  const agents = Object.fromEntries(
    AGENT_IDS.map((id) => [
      id,
      async (ctx: NodeContext): Promise<NodeResult> => {
        calls[id].push(ctx);
        const body = bodies[id];
        const output = body ? await body(ctx, calls[id].length) : defaults[id]();
        return { output, summary: `${id} done`, calls: [] };
      },
    ]),
  ) as DirectorAgents;
  return { agents, calls };
}

function depsFor(root: string, agents: DirectorAgents, published: DirectorEvent[] = []): RunnerDeps {
  return {
    store: new FileDirectorRunStore(root),
    recipe: buildRecipe(agents),
    publish: (ev) => published.push(ev),
  };
}

async function viewOf(deps: RunnerDeps, runId: string) {
  return reduceDirectorEvents(await deps.store.events(runId));
}

/** Drives a fresh run to gate B: start, drive to A, approve A with answers. */
async function runToGateB(deps: RunnerDeps): Promise<string> {
  const runId = await startDirectorRun(deps, "a sparkling water ad");
  await driveDirectorRun(deps, runId);
  await resolveGate(deps, runId, "A", { decision: "approve", answers: ANSWERS });
  return runId;
}

describe("buildRecipe", () => {
  it("declares every node but render, with dependencies from the recipe edges", () => {
    const recipe = buildRecipe(fakeAgents().agents);
    expect(recipe.map((spec) => spec.id)).toEqual(AGENT_IDS);
    const after = Object.fromEntries(recipe.map((spec) => [spec.id, spec.after]));
    expect(after.interrogator).toEqual([]);
    expect(after.director).toEqual(["A"]);
    expect(after.planChecks).toEqual(["director"]);
    expect(after.product).toEqual(["B"]);
    expect(after.assembler).toEqual(["product", "location", "character", "cinematographer"]);
    expect(after.promptChecks).toEqual(["assembler"]);
  });
});

describe("Director runner", () => {
  it("stops at gate A after the Interrogator", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await startDirectorRun(deps, "a brief");
    await driveDirectorRun(deps, runId);

    const view = await viewOf(deps, runId);
    expect(view.status).toBe("awaiting_gate");
    expect(view.waitingAt).toBe("A");
    expect(view.nodes.interrogator.status).toBe("done");
    expect(calls.interrogator).toHaveLength(1);
    expect(calls.director).toHaveLength(0);
  });

  it("publishes every event it appends, run.started included", async () => {
    const published: DirectorEvent[] = [];
    const { agents } = fakeAgents();
    const deps = depsFor(await newRoot(), agents, published);
    const runId = await runToGateB(deps);
    expect(published.map((e) => e.seq)).toEqual((await deps.store.events(runId)).map((e) => e.seq));
  });

  it("gate A writes the answers, records the chosen seconds, and the Director can read them", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);

    const resolved = (await deps.store.events(runId)).find((e) => e.type === "gate.resolved");
    expect(resolved).toMatchObject({ gate: "A", decision: "approve", reason: null, seconds: 12 });
    expect(await calls.director[0]!.answers()).toEqual(ANSWERS);
    expect(await calls.director[0]!.read("interrogator")).toEqual({ brief: "filled" });
    expect(calls.director[0]!.attempt).toBe(1);
    expect(calls.director[0]!.patch).toBeNull();
    const view = await viewOf(deps, runId);
    expect(view.waitingAt).toBe("B");
    expect(view.seconds).toBe(12);
  });

  it("approving gate A without answers throws and appends nothing", async () => {
    const { agents } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await startDirectorRun(deps, "a brief");
    await driveDirectorRun(deps, runId);
    const before = await deps.store.events(runId);

    await expect(resolveGate(deps, runId, "A", { decision: "approve" })).rejects.toThrow(/answers/);
    await expect(resolveGate(deps, runId, "A", { decision: "approve" })).rejects.not.toBeInstanceOf(
      GateConflictError,
    );
    expect(await deps.store.events(runId)).toEqual(before);
  });

  it("after B, the four branches all start before any of them finishes", async () => {
    const gates = {
      product: deferred<unknown>(),
      location: deferred<unknown>(),
      character: deferred<unknown>(),
      cinematographer: deferred<unknown>(),
    };
    const allCalled = deferred<void>();
    let called = 0;
    const branch = (id: keyof typeof gates) => () => {
      called += 1;
      if (called === 4) allCalled.resolve();
      return gates[id].promise;
    };
    const { agents } = fakeAgents({
      product: branch("product"),
      location: branch("location"),
      character: branch("character"),
      cinematographer: branch("cinematographer"),
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);

    const driving = resolveGate(deps, runId, "B", { decision: "approve" });
    await allCalled.promise;
    for (const g of Object.values(gates)) g.resolve({});
    await driving;

    const events = await deps.store.events(runId);
    const branches = new Set<DirectorNodeId>(["product", "location", "character", "cinematographer"]);
    const firstCompleted = events.findIndex((e) => e.type === "node.completed" && branches.has(e.node));
    const startedBefore = events
      .slice(0, firstCompleted)
      .filter((e) => e.type === "node.started" && branches.has(e.node));
    expect(startedBefore).toHaveLength(4);
    expect((await viewOf(deps, runId)).waitingAt).toBe("C");
  });

  it("a fresh runner over the same store resumes without re-running finished nodes", async () => {
    const root = await newRoot();
    const first = fakeAgents();
    const runId = await runToGateB(depsFor(root, first.agents));

    const second = fakeAgents();
    const deps2 = depsFor(root, second.agents);
    await resolveGate(deps2, runId, "B", { decision: "approve" });

    expect(first.calls.interrogator).toHaveLength(1);
    expect(first.calls.director).toHaveLength(1);
    expect(second.calls.interrogator).toHaveLength(0);
    expect(second.calls.director).toHaveLength(0);
    expect(second.calls.assembler).toHaveLength(1);
    expect((await viewOf(deps2, runId)).waitingAt).toBe("C");
  });

  it("a node in flight at restart is re-run as attempt 2 and logged as abandoned", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await deps.store.createRun("a brief");
    await deps.store.append(runId, { type: "node.started", node: "interrogator", attempt: 1, patchShots: null });

    await resumeAllDirectorRuns(deps);

    const events = await deps.store.events(runId);
    const abandoned = events.findIndex((e) => e.type === "node.abandoned");
    expect(events[abandoned]).toMatchObject({ node: "interrogator", attempt: 1 });
    expect(events[abandoned + 1]).toMatchObject({ type: "node.started", node: "interrogator", attempt: 2 });
    expect(calls.interrogator).toHaveLength(1);
    expect(calls.interrogator[0]!.attempt).toBe(2);
    expect((await viewOf(deps, runId)).waitingAt).toBe("A");
  });

  it("resume leaves terminal and waiting runs alone", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const waiting = await startDirectorRun(deps, "waits at A");
    await driveDirectorRun(deps, waiting);
    const failed = await deps.store.createRun("failed");
    await deps.store.append(failed, { type: "run.finished", status: "failed", reason: "x" });
    const waitingBefore = await deps.store.events(waiting);
    const failedBefore = await deps.store.events(failed);

    await resumeAllDirectorRuns(deps);

    expect(await deps.store.events(waiting)).toEqual(waitingBefore);
    expect(await deps.store.events(failed)).toEqual(failedBefore);
    expect(calls.interrogator).toHaveLength(1);
  });

  it("answering a gate that is not waiting throws GateConflictError and appends nothing", async () => {
    const { agents } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await startDirectorRun(deps, "a brief");
    await driveDirectorRun(deps, runId);
    const before = await deps.store.events(runId);

    await expect(resolveGate(deps, runId, "B", { decision: "approve" })).rejects.toBeInstanceOf(
      GateConflictError,
    );
    await expect(
      resolveGate(deps, runId, "C", { decision: "reject", reason: "no" }),
    ).rejects.toBeInstanceOf(GateConflictError);
    expect(await deps.store.events(runId)).toEqual(before);
    expect(await deps.store.readAnswers(runId)).toBeNull();
  });

  it("rejecting a gate finishes the run as rejected with the reason", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);
    await resolveGate(deps, runId, "B", { decision: "reject", reason: "wrong product" });

    const events = await deps.store.events(runId);
    expect(events.slice(-2)).toMatchObject([
      { type: "gate.resolved", gate: "B", decision: "reject", reason: "wrong product", seconds: null },
      { type: "run.finished", status: "rejected", reason: "wrong product" },
    ]);
    expect(calls.product).toHaveLength(0);
  });

  it("a node that throws fails the run with its message", async () => {
    const { agents } = fakeAgents({
      interrogator: async () => {
        throw new Error("the brief is empty");
      },
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await startDirectorRun(deps, "a brief");
    await driveDirectorRun(deps, runId);

    const events = await deps.store.events(runId);
    expect(events.slice(-2)).toMatchObject([
      { type: "node.failed", node: "interrogator", attempt: 1, error: "the brief is empty" },
      { type: "run.finished", status: "failed", reason: "the brief is empty" },
    ]);
    expect((await viewOf(deps, runId)).status).toBe("failed");
  });

  it("a branch that throws lets its siblings finish, then fails the run", async () => {
    const productFailed = deferred<void>();
    const { agents, calls } = fakeAgents({
      product: async () => {
        productFailed.resolve();
        throw new Error("no product photo");
      },
      // Still in flight when product throws.
      location: async () => {
        await productFailed.promise;
        await new Promise((r) => setImmediate(r));
        return {};
      },
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);
    await resolveGate(deps, runId, "B", { decision: "approve" });

    const events = await deps.store.events(runId);
    const last = events[events.length - 1]!;
    expect(last).toMatchObject({ type: "run.finished", status: "failed", reason: "no product photo" });
    expect(events.some((e) => e.type === "node.completed" && e.node === "location")).toBe(true);
    expect(calls.assembler).toHaveLength(0);
  });

  it("a failed plan check is routed to the Director with its failures, then passes", async () => {
    const failing = [fail("no_timestamps", "director", [2]), pass("length_fits", "director")];
    const { agents, calls } = fakeAgents({
      planChecks: async (_ctx, call) => (call === 1 ? failing : [pass("no_timestamps", "director")]),
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);

    const events = await deps.store.events(runId);
    const types = events.map((e) => e.type);
    const routeAt = types.indexOf("route.sent");
    expect(types[routeAt - 1]).toBe("checks.completed");
    expect(events[routeAt]).toMatchObject({
      owner: "director",
      checkIds: ["no_timestamps"],
      shots: [2],
      retry: 1,
    });
    expect(events[routeAt + 1]).toMatchObject({
      type: "node.started",
      node: "director",
      attempt: 2,
      patchShots: [2],
    });

    expect(calls.director).toHaveLength(2);
    expect(calls.director[0]!.patch).toBeNull();
    expect(calls.director[1]!.attempt).toBe(2);
    expect(calls.director[1]!.patch).toEqual({
      checkIds: ["no_timestamps"],
      shots: [2],
      failures: [failing[0]],
    });
    expect(calls.planChecks).toHaveLength(2);
    expect(calls.planChecks[1]!.patch).toBeNull();
    expect(calls.interrogator).toHaveLength(1);

    const view = await viewOf(deps, runId);
    expect(view.waitingAt).toBe("B");
    expect(view.retries.director).toBe(1);
  });

  it("a failed prompt check re-runs only the Cinematographer and what follows it", async () => {
    const failing = [fail("light_has_direction", "cinematographer", [1, 3])];
    const { agents, calls } = fakeAgents({
      promptChecks: async (_ctx, call) =>
        call === 1 ? failing : [pass("light_has_direction", "cinematographer")],
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);
    await resolveGate(deps, runId, "B", { decision: "approve" });

    expect(calls.cinematographer).toHaveLength(2);
    expect(calls.cinematographer[1]!.patch).toEqual({
      checkIds: ["light_has_direction"],
      shots: [1, 3],
      failures: failing,
    });
    expect(calls.assembler).toHaveLength(2);
    expect(calls.assembler[1]!.patch).toBeNull();
    expect(calls.promptChecks).toHaveLength(2);
    expect(calls.product).toHaveLength(1);
    expect(calls.director).toHaveLength(1);
    expect((await viewOf(deps, runId)).waitingAt).toBe("C");
  });

  it("a third failure for the same owner stops the run", async () => {
    const { agents, calls } = fakeAgents({
      planChecks: async () => [fail("length_fits", "director", [])],
    });
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);

    const events = await deps.store.events(runId);
    expect(events.filter((e) => e.type === "route.sent").map((e) => e.type === "route.sent" && e.retry)).toEqual([
      1, 2,
    ]);
    const last = events[events.length - 1]!;
    expect(last).toMatchObject({ type: "run.finished", status: "stopped" });
    expect(last.type === "run.finished" && last.reason).toMatch(/length_fits.*2 retries/);
    expect(calls.director).toHaveLength(3);
    expect(calls.director[2]!.attempt).toBe(3);
    expect((await viewOf(deps, runId)).status).toBe("stopped");
  });

  it("a checks node that completed just before a crash is still routed on the next drive", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const store = deps.store;
    const runId = await store.createRun("a brief");
    const done = async (node: DirectorNodeId, output: unknown) => {
      await store.append(runId, { type: "node.started", node, attempt: 1, patchShots: null });
      const outputRef = await store.writeOutput(runId, node, 1, output);
      await store.append(runId, {
        type: "node.completed",
        node,
        attempt: 1,
        outputRef,
        summary: "",
        calls: [],
        latencyMs: 0,
      });
    };
    await done("interrogator", {});
    await store.append(runId, { type: "gate.opened", gate: "A" });
    await store.writeAnswers(runId, ANSWERS);
    await store.append(runId, { type: "gate.resolved", gate: "A", decision: "approve", reason: null, seconds: 12 });
    await done("director", {});
    await done("planChecks", [fail("length_fits", "director", [])]);

    await driveDirectorRun(deps, runId);

    const types = (await store.events(runId)).map((e) => e.type);
    expect(types.slice(types.indexOf("checks.completed"), types.indexOf("checks.completed") + 3)).toEqual([
      "checks.completed",
      "route.sent",
      "node.started",
    ]);
    expect(calls.director).toHaveLength(1);
    expect(calls.director[0]!.attempt).toBe(2);
    expect((await viewOf(deps, runId)).waitingAt).toBe("B");
  });

  it("after gate C is approved, driving does nothing further and never starts render", async () => {
    const { agents } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await runToGateB(deps);
    await resolveGate(deps, runId, "B", { decision: "approve" });
    await resolveGate(deps, runId, "C", { decision: "approve" });
    const after = await deps.store.events(runId);

    await driveDirectorRun(deps, runId);

    expect(await deps.store.events(runId)).toEqual(after);
    expect(after[after.length - 1]).toMatchObject({
      type: "gate.resolved",
      gate: "C",
      decision: "approve",
      seconds: null,
    });
    const view = await viewOf(deps, runId);
    expect(view.status).toBe("running");
    expect(view.nodes.render.status).toBe("queued");
    expect(after.some((e) => e.type === "node.started" && e.node === "render")).toBe(false);
  });

  it("two drives at once never start a node twice", async () => {
    const { agents, calls } = fakeAgents();
    const deps = depsFor(await newRoot(), agents);
    const runId = await startDirectorRun(deps, "a brief");
    await Promise.all([driveDirectorRun(deps, runId), driveDirectorRun(deps, runId)]);
    expect(calls.interrogator).toHaveLength(1);
    expect((await deps.store.events(runId)).filter((e) => e.type === "gate.opened")).toHaveLength(1);
  });
});
