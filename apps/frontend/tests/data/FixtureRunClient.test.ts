import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FixtureRunClient } from "../../src/data/FixtureRunClient.js";
import { FIXTURE_RUNS } from "@ai-director/contract";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FixtureRunClient", () => {
  it("returns a run id from startRun", async () => {
    const client = new FixtureRunClient();
    await expect(client.startRun("a description")).resolves.toMatchObject({
      runId: expect.any(String),
    });
  });

  it("delivers events over time rather than all at once, so streaming bugs cannot hide", async () => {
    const client = new FixtureRunClient({ speedMs: 10 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    client.subscribe(runId, undefined, (e) => seen.push(e.name));
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual(["run.started"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toHaveLength(2);
  });

  it("ends on a terminal event", async () => {
    const client = new FixtureRunClient({ speedMs: 1 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    client.subscribe(runId, undefined, (e) => seen.push(e.name));
    await vi.advanceTimersByTimeAsync(1000);
    expect(["run.completed", "run.failed"]).toContain(seen[seen.length - 1]);
  });

  it("stops delivering after unsubscribe", async () => {
    const client = new FixtureRunClient({ speedMs: 10 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    const off = client.subscribe(runId, undefined, (e) => seen.push(e.name));
    await vi.advanceTimersByTimeAsync(10);
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(1);
  });

  it("can replay any scenario, including the ones that must never look like success", async () => {
    for (const scenario of ["passed", "improvedStillFailing", "noImprovement", "failed"] as const) {
      const client = new FixtureRunClient({ speedMs: 1, scenario });
      const { runId } = await client.startRun("a description");
      await vi.advanceTimersByTimeAsync(1000);
      const run = await client.getRun(runId);
      expect(run.status).toBe(FIXTURE_RUNS[scenario].status);
    }
  });
});
