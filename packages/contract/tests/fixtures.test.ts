import { describe, expect, it } from "vitest";
import {
  FIXTURE_RUNS,
  FIXTURE_EVENT_LOG,
  CHECK_IDS,
  isSuccess,
  type RunView,
} from "../src/index.js";

const everyRun = Object.values(FIXTURE_RUNS) as RunView[];

describe("fixture runs", () => {
  it("covers all three terminal states plus a failure", () => {
    expect(Object.keys(FIXTURE_RUNS).sort()).toEqual([
      "failed", "improvedStillFailing", "noImprovement", "passed",
    ]);
  });

  it("scores all nine checks in every pass of every run", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        expect(pass.results.map((r) => r.checkId).sort()).toEqual(CHECK_IDS.slice().sort());
      }
    }
  });

  it("derives percent from band everywhere, never freely", () => {
    const expected = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 } as const;
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results) {
          expect(result.percent).toBe(expected[result.band]);
          expect(result.passed).toBe(result.band >= 4);
        }
      }
    }
  });

  it("gives every sub-threshold check at least one span or one unverified quote", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results.filter((r) => !r.passed)) {
          expect(result.spans.length + result.unverified.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("makes every span's offsets quote the description exactly", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const span of pass.results.flatMap((r) => r.spans)) {
          expect(pass.description.slice(span.start, span.end)).toBe(span.quote);
        }
      }
    }
  });

  it("carries at least one unverified quote somewhere, so the UI's 'fragment not found' state is exercised", () => {
    const unverified = everyRun.flatMap((run) =>
      run.passes.flatMap((pass) => pass.results.flatMap((r) => r.unverified)),
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
});
