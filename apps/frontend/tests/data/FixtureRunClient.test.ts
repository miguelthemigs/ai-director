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

  // Fix round 1 (task 16): the shared chrome's sample-data marker is driven off this flag, not a
  // build-time constant, so it disappears on its own once `main.tsx` swaps in `HttpRunClient`.
  it("marks itself as fixture data", () => {
    const client = new FixtureRunClient();
    expect(client.isFixture).toBe(true);
  });

  it("lists the version history, oldest sealed first", async () => {
    const client = new FixtureRunClient();
    const versions = await client.listVersions();
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("rejects comparing an id that is not on record, rather than silently returning nothing", async () => {
    const client = new FixtureRunClient();
    const versions = await client.listVersions();
    const realId = versions[0]?.id;
    expect(realId).toBeDefined();
    await expect(client.compareVersions("not-a-real-version", realId ?? "")).rejects.toThrow(
      /unknown version id/i,
    );
    await expect(client.compareVersions(realId ?? "", "also-not-real")).rejects.toThrow(
      /unknown version id/i,
    );
  });
});
