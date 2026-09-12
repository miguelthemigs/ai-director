import { describe, expect, it } from "vitest";
import {
  FIXTURE_RUNS,
  FIXTURE_EVENT_LOG,
  CHECK_IDS,
  isScoredCheck,
  isSuccess,
  type RunEvent,
  type RunView,
} from "../src/index.js";

const everyRun = Object.values(FIXTURE_RUNS) as RunView[];

describe("fixture runs", () => {
  it("covers all three terminal states plus a failure", () => {
    expect(Object.keys(FIXTURE_RUNS).sort()).toEqual([
      "failed", "improvedStillFailing", "noImprovement", "passed",
    ]);
  });

  it("covers all nine checks in every pass of every run, scored or not", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        expect(pass.results.map((r) => r.checkId).sort()).toEqual(CHECK_IDS.slice().sort());
      }
    }
  });

  it("gives the failed run a partial pass carrying not_evaluated checks", () => {
    const pass = FIXTURE_RUNS.failed.passes[0];
    expect(pass).toBeDefined();
    const notEvaluated = pass!.results.filter((r) => r.status === "not_evaluated");
    expect(notEvaluated.length).toBeGreaterThan(0);
    for (const result of notEvaluated) {
      expect(result).not.toHaveProperty("band");
      expect(result).not.toHaveProperty("percent");
      expect(result).not.toHaveProperty("passed");
    }
  });

  it("derives percent from band everywhere, never freely", () => {
    const expected = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 } as const;
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results.filter(isScoredCheck)) {
          expect(result.percent).toBe(expected[result.band]);
          expect(result.passed).toBe(result.band >= 4);
        }
      }
    }
  });

  it("gives every sub-threshold check at least one span or one unverified quote", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results.filter(isScoredCheck).filter((r) => !r.passed)) {
          expect(result.spans.length + result.unverified.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("makes every span's offsets quote the description exactly", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const span of pass.results.filter(isScoredCheck).flatMap((r) => r.spans)) {
          expect(pass.description.slice(span.start, span.end)).toBe(span.quote);
        }
      }
    }
  });

  it("carries at least one unverified quote somewhere, so the UI's 'fragment not found' state is exercised", () => {
    const unverified = everyRun.flatMap((run) =>
      run.passes.flatMap((pass) => pass.results.filter(isScoredCheck).flatMap((r) => r.unverified)),
    );
    expect(unverified.length).toBeGreaterThan(0);
  });

  it("marks only the passed run as success", () => {
    expect(isSuccess(FIXTURE_RUNS.passed.status)).toBe(true);
    expect(isSuccess(FIXTURE_RUNS.improvedStillFailing.status)).toBe(false);
    expect(isSuccess(FIXTURE_RUNS.noImprovement.status)).toBe(false);
    expect(isSuccess(FIXTURE_RUNS.failed.status)).toBe(false);
  });

  it("never invents an agreement number, because the gold set is not marked yet", () => {
    const serialised = JSON.stringify(FIXTURE_RUNS);
    expect(serialised).not.toMatch(/kappa/i);
  });
});

describe("fixture event log", () => {
  it("opens with run.started and closes with a terminal event", () => {
    expect(FIXTURE_EVENT_LOG[0]?.name).toBe("run.started");
    const last = FIXTURE_EVENT_LOG[FIXTURE_EVENT_LOG.length - 1];
    expect(["run.completed", "run.failed"]).toContain(last?.name);
  });

  it("gives every event a unique <pass>-<step> id", () => {
    const ids = FIXTURE_EVENT_LOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d+-\d+$/);
  });

  it("starts and completes each evaluator group exactly once per pass", () => {
    const started = FIXTURE_EVENT_LOG.filter((e) => e.name === "evaluator.group.started");
    const completed = FIXTURE_EVENT_LOG.filter((e) => e.name === "evaluator.group.completed");
    expect(started.length).toBe(completed.length);
    expect(started.length % 3).toBe(0);
  });

  // Fix round 1: the fixture previously handed evaluator.group.completed real, non-empty spans
  // (pulled from the finished RunView), which no live run can produce at group-settle time --
  // verification is pass-wide and hasn't run yet. That made the fixture more generous than the
  // wire: every screen built against it looked right and would have quietly gone dark against a
  // real server. This is the test that would have caught it.
  it("never gives evaluator.group.completed a verified span -- only pass.completed does", () => {
    const groupCompleted = FIXTURE_EVENT_LOG.filter(
      (e): e is Extract<RunEvent, { name: "evaluator.group.completed" }> =>
        e.name === "evaluator.group.completed",
    );
    expect(groupCompleted.length).toBeGreaterThan(0);
    for (const event of groupCompleted) {
      for (const result of event.results.filter(isScoredCheck)) {
        expect(result.spans).toEqual([]);
        expect(result.unverified).toEqual([]);
      }
    }
  });

  it("gives pass.completed the pass's verified results, with clickable spans for a failing check", () => {
    const passCompleted = FIXTURE_EVENT_LOG.filter(
      (e): e is Extract<RunEvent, { name: "pass.completed" }> => e.name === "pass.completed",
    );
    const pass1 = passCompleted.find((e) => e.pass === 1);
    if (!pass1) throw new Error("no pass.completed event for pass 1 in FIXTURE_EVENT_LOG");

    const failing = pass1.results.filter(isScoredCheck).filter((r) => !r.passed);
    expect(failing.length).toBeGreaterThan(0);
    // "Clickable" means it carries something to click: a verified span or, failing that, an
    // unverified quote the UI can still explain.
    for (const r of failing) {
      expect(r.spans.length + r.unverified.length).toBeGreaterThan(0);
    }
    // At least one real, non-empty span -- not just unverified quotes -- so the coverage gutter
    // has something to actually render, not only "not found" placeholders.
    expect(failing.some((r) => r.spans.length > 0)).toBe(true);
  });

  it("reconstructs a run with clickable spans after replaying only through pass 1's pass.completed", () => {
    const throughPass1 = FIXTURE_EVENT_LOG.slice(
      0,
      FIXTURE_EVENT_LOG.findIndex((e) => e.name === "pass.completed" && e.pass === 1) + 1,
    );
    const pass1Completed = throughPass1.at(-1);
    if (!pass1Completed || pass1Completed.name !== "pass.completed") {
      throw new Error("expected the replayed log to end on pass 1's pass.completed");
    }
    // This is exactly the payload a live-streaming client has in hand at that point in a real
    // run -- no run.completed, no fetch, nothing else.
    const clickable = pass1Completed.results
      .filter(isScoredCheck)
      .flatMap((r) => r.spans);
    expect(clickable.length).toBeGreaterThan(0);
    for (const span of clickable) {
      expect(pass1Completed.results.find((r) => r.checkId === span.checkId)).toBeDefined();
    }
  });
});
