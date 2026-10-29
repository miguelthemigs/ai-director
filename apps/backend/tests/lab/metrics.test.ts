import { afterEach, describe, expect, it } from "vitest";
import { finishRun, labNew } from "../../src/lab/commands.js";
import { labCompare, labRate, labReport } from "../../src/lab/metrics.js";
import { LabError, appendCalls, readJson, readRun, writeJson } from "../../src/lab/runStore.js";
import { cleanLabEnvs, newLabEnv } from "./labEnv.js";

afterEach(cleanLabEnvs);

const call = (promptVersion: string, inputTokens: number, outputTokens: number) => ({
  model: "claude-sonnet-5-5",
  promptVersion,
  inputTokens,
  outputTokens,
  microUsd: null,
  latencyMs: 1000,
});

describe("labReport", () => {
  it("sums a sequential run's calls, by agent", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "sequential", brief: "an ad", url: null });
    await appendCalls(env.root, runId, [
      call("interrogator/v2", 100, 10),
      call("interrogator/v2", 200, 20),
      call("director/v2", 300, 30),
      call("cinematographer/v2", 400, 40),
    ]);
    await writeJson(env.root, runId, "questions.json", [{ id: "q1" }, { id: "q2" }]);
    await writeJson(env.root, runId, "checks.plan.1.json", { attempt: 1, forPlan: 1, passed: false, outcomes: [] });
    await writeJson(env.root, runId, "checks.shots.1.json", { attempt: 1, forPlan: 2, passed: true, outcomes: [] });
    await finishRun(env, await readRun(env.root, runId), "done", null);

    const metrics = await labReport(env, runId);
    expect(metrics.status).toBe("done");
    expect(metrics.apiRequests).toBe(4);
    expect(metrics.tokens).toEqual({
      input: 1000,
      output: 100,
      byAgent: {
        interrogator: { input: 300, output: 30 },
        director: { input: 300, output: 30 },
        cinematographer: { input: 400, output: 40 },
      },
    });
    expect(metrics.invocations).toEqual({ interrogator: 2, director: 1, cinematographer: 1 });
    expect(metrics.questionsAsked).toBe(2);
    expect(metrics.firstTryPass).toEqual({ plan: false, shots: true });
    expect(metrics.models).toEqual(["claude-sonnet-5-5"]);
    expect(await readJson(env.root, runId, "metrics.json")).toEqual(metrics);
  });

  it("shows a run nobody finished as abandoned, never done", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "swarm", brief: "an ad", url: null });
    const metrics = await labReport(env, runId);
    expect(metrics.status).toBe("abandoned");
    expect(metrics.tokens).toBeNull();
    expect(metrics.wallSeconds).toBeNull();
  });
});

describe("labCompare", () => {
  it("puts every run in one table", async () => {
    const env = await newLabEnv();
    const a = await labNew(env, { arch: "sequential", brief: "an ad", url: null });
    const b = await labNew(env, { arch: "coordinator", brief: "an ad", url: null });
    const table = await labCompare(env, [a.runId, b.runId]);
    const rows = table.split("\n").filter((line) => line.startsWith("|"));
    expect(rows[0]).toContain("Architecture");
    expect(rows).toHaveLength(4);
    expect(table).toContain("abandoned");
  });
});

describe("labRate", () => {
  it("records the owner's judgement and refuses a score outside 1-5", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "sequential", brief: "an ad", url: null });
    await labRate(env, runId, 4, "good blocking, flat light");
    expect((await readRun(env.root, runId)).rating).toEqual({ score: 4, note: "good blocking, flat light" });
    await expect(labRate(env, runId, 6, "too high")).rejects.toBeInstanceOf(LabError);
  });
});
