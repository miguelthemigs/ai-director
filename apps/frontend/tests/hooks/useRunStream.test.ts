import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isScoredCheck } from "@ai-director/contract";
import { FixtureRunClient } from "../../src/data/FixtureRunClient.js";
import { useRunStream } from "../../src/hooks/useRunStream.js";

describe("useRunStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle with no run, then streams, merging groups without discarding earlier ones", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });

    const { result, rerender } = renderHook(({ runId }) => useRunStream(client, runId), {
      initialProps: { runId: null as string | null },
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.run).toBeNull();

    let runId = "";
    await act(async () => {
      const started = await client.startRun("a description");
      runId = started.runId;
    });

    rerender({ runId });
    expect(result.current.status).toBe("streaming");

    // Advance past run.started, pass.started, both group.started events, and the first
    // evaluator.group.completed (look) — 5 events at 1ms each.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });

    const afterLook = result.current.run;
    const lookIds = afterLook?.passes.at(-1)?.results.map((r) => r.checkId) ?? [];
    expect(lookIds).toContain("age_build");
    expect(lookIds).not.toContain("no_real_person");

    // Advance through the drawable group start and the safety group's completion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    const afterSafety = result.current.run;
    const idsAfterSafety = afterSafety?.passes.at(-1)?.results.map((r) => r.checkId) ?? [];
    // The bug this fixture design exists to catch: `look`'s results must still be present.
    expect(idsAfterSafety).toContain("age_build");
    expect(idsAfterSafety).toContain("no_real_person");

    // Run the rest of the log to completion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.status).toBe("improved_still_failing");
    expect(result.current.run?.status).toBe("improved_still_failing");
    expect(result.current.run?.passes).toHaveLength(3);
    const finalResults = result.current.run?.passes.at(-1)?.results ?? [];
    expect(finalResults.filter(isScoredCheck)).toHaveLength(finalResults.length);
  });

  // Fix round 1: pass.completed now carries the pass's verified results (real spans), since the
  // fixture previously handed evaluator.group.completed spans no live run can produce that early
  // -- this is the test that would have caught the fixture being more generous than the wire.
  it("has a clickable span for a failing check right after pass 1's pass.completed, well before run.completed", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "improvedStillFailing" });

    const { result, rerender } = renderHook(({ runId }) => useRunStream(client, runId), {
      initialProps: { runId: null as string | null },
    });

    let runId = "";
    await act(async () => {
      const started = await client.startRun("a description");
      runId = started.runId;
    });
    rerender({ runId });

    // Event index 4 is "look"'s evaluator.group.completed (run.started=0, pass.started=1, two
    // group.started=2,3, then this) -- 5 events at 1ms each. age_build (a failing "look" check)
    // has a band by now, but must NOT yet have a span: verification hasn't run yet at this point
    // in a live pipeline, so a fixture that hands one out here is lying about what the wire gives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5);
    });
    const afterGroup = result.current.run?.passes.at(-1)?.results.find((r) => r.checkId === "age_build");
    expect(afterGroup).toBeDefined();
    if (afterGroup && isScoredCheck(afterGroup)) {
      expect(afterGroup.spans).toEqual([]);
    }

    // Event index 10 is pass 1's pass.completed. 6 more events (11 total) reaches it -- the run
    // is still streaming, nowhere near run.completed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6);
    });

    expect(result.current.status).toBe("streaming");
    const pass1 = result.current.run?.passes[0];
    expect(pass1).toBeDefined();
    const failing = pass1?.results.filter(isScoredCheck).filter((r) => !r.passed) ?? [];
    expect(failing.length).toBeGreaterThan(0);
    // The check this whole product exists to make clickable: a verified span, not merely a band.
    expect(failing.some((r) => r.spans.length > 0)).toBe(true);
  });

  it("sets status failed with the error string, without throwing", async () => {
    const client = new FixtureRunClient({ speedMs: 1, scenario: "failed" });

    const { result, rerender } = renderHook(({ runId }) => useRunStream(client, runId), {
      initialProps: { runId: null as string | null },
    });

    let runId = "";
    await act(async () => {
      const started = await client.startRun("a description");
      runId = started.runId;
    });
    rerender({ runId });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toBeTruthy();
    expect(typeof result.current.error).toBe("string");
  });
});
