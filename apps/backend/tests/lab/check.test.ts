import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Plan } from "@ai-director/contract";
import { labAssemble, labCheck, labSave, labStop, type LabEnv } from "../../src/lab/commands.js";
import { LabError, readRun } from "../../src/lab/runStore.js";
import { boardCameras, boardPlan } from "../orchestrate/director/planFixture.js";
import { AVATAR_DESCRIPTION, AVATAR_ID, cleanLabEnvs, newLabEnv, runWithBrief } from "./labEnv.js";

afterEach(cleanLabEnvs);

const savePlan = (env: LabEnv, id: string, plan: Plan = boardPlan()) => labSave(env, id, "plan", JSON.stringify(plan), "director");
const saveCameras = (env: LabEnv, id: string, cameras = boardCameras(), forPlan = 1) =>
  labSave(env, id, "cameras", JSON.stringify({ forPlan, cameras }), "cinematographer");

/** Two normal shots: 6 s for a 15 s ad. */
function shortPlan(): Plan {
  const plan = boardPlan();
  plan.shots = plan.shots.slice(0, 2).map((shot) => ({ ...shot, weight: "normal" }));
  return plan;
}

describe("labCheck plan", () => {
  it("passes a plan that fits", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    const result = await labCheck(env, id, "plan", "director");
    expect(result.passed).toBe(true);
    expect(result.route).toEqual({ kind: "pass" });
    expect((await readRun(env.root, id)).lastChecks.plan).toMatchObject({ attempt: 1, forPlan: 1, passed: true });
  });

  it("sends a plan that is too short back to the Director", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id, shortPlan());
    const result = await labCheck(env, id, "plan", "director");
    expect(result.passed).toBe(false);
    expect(result.route).toMatchObject({ kind: "redo", owner: "director", checkIds: ["length_fits"] });
  });

  it("stops the run when the third plan still fails", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    for (let i = 0; i < 3; i++) await savePlan(env, id, shortPlan());
    const result = await labCheck(env, id, "plan", "director");
    expect(result.route.kind).toBe("stop");
    expect((await readRun(env.root, id)).status).toBe("stopped");
  });
});

describe("labCheck shots", () => {
  it("sends a light with no direction back to the Cinematographer, for that shot only", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await saveCameras(env, id, boardCameras().map((c) => (c.shot === 2 ? { ...c, light: "soft moody light" } : c)));
    const result = await labCheck(env, id, "shots", "cinematographer");
    expect(result.route).toMatchObject({ kind: "redo", owner: "cinematographer", shots: [2] });
    expect((await readRun(env.root, id)).pendingReshoot).toEqual({ forCameras: 1, shots: [2] });
  });

  it("refuses cameras made for an older plan", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await saveCameras(env, id);
    await savePlan(env, id);
    await expect(labCheck(env, id, "shots", "cinematographer")).rejects.toThrow(
      "cameras are stale: made for plan 1, latest is 2",
    );
    await expect(labAssemble(env, id, "cinematographer")).rejects.toBeInstanceOf(LabError);
  });
});

describe("labAssemble", () => {
  it("refuses while a shot check is failing, and changes nothing", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await labCheck(env, id, "plan", "director");
    await saveCameras(env, id, boardCameras().map((c) => (c.shot === 2 ? { ...c, light: "soft light" } : c)));
    await labCheck(env, id, "shots", "cinematographer");

    await expect(labAssemble(env, id, "cinematographer")).rejects.toThrow(/shot checks/);
    expect((await readRun(env.root, id)).status).toBe("running");
    await expect(readFile(path.join(env.root, id, "prompt.txt"), "utf8")).rejects.toThrow();
  });

  it("writes the prompt and the shot list when everything passed, once", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await labCheck(env, id, "plan", "director");
    await saveCameras(env, id);
    await labCheck(env, id, "shots", "cinematographer");

    const result = await labAssemble(env, id, "cinematographer");
    expect(result.status).toBe("done");
    const prompt = await readFile(path.join(env.root, id, "prompt.txt"), "utf8");
    expect(prompt).toContain("Shot 1:");
    expect(prompt).toContain("HERO (@maya): a woman in her thirties in a linen shirt");
    expect(await readFile(path.join(env.root, id, "shotlist.md"), "utf8")).toContain("# Shot list");
    expect((await readRun(env.root, id)).status).toBe("done");
    await expect(labAssemble(env, id, "cinematographer")).rejects.toThrow("run is done");
  });

  it("uses a saved avatar's description byte-identical", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env, "coordinator", { avatar: { avatarId: AVATAR_ID, description: AVATAR_DESCRIPTION } });
    await savePlan(env, id);
    await labCheck(env, id, "plan", "director");
    await saveCameras(env, id);
    await labCheck(env, id, "shots", "cinematographer");
    await labAssemble(env, id, "cinematographer");
    expect(await readFile(path.join(env.root, id, "prompt.txt"), "utf8")).toContain(`HERO (@maya): ${AVATAR_DESCRIPTION}`);
  });
});

describe("labStop", () => {
  it("stops the run, after which nothing saves", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    expect(await labStop(env, id, "the brief makes no sense", "lead")).toEqual({ status: "stopped" });
    const run = await readRun(env.root, id);
    expect(run.reason).toBe("the brief makes no sense");
    await expect(savePlan(env, id)).rejects.toThrow("run is stopped");
  });
});
