import { afterEach, describe, expect, it } from "vitest";
import type { Plan } from "@ai-director/contract";
import { labSave, parseAgentJson, type LabEnv } from "../../src/lab/commands.js";
import { LabError, createRun, readJson, readRun, writeRun } from "../../src/lab/runStore.js";
import type { CameraSet } from "../../src/lab/types.js";
import { boardCameras, boardPlan } from "../orchestrate/director/planFixture.js";
import { cleanLabEnvs, newLabEnv, runWithBrief } from "./labEnv.js";

afterEach(cleanLabEnvs);

const json = (value: unknown) => JSON.stringify(value);
const save = (env: LabEnv, id: string, step: Parameters<typeof labSave>[2], value: unknown, by = "director") =>
  labSave(env, id, step, typeof value === "string" ? value : json(value), by);

function renamed(): Plan {
  const plan = boardPlan();
  plan.assets[1] = { ...plan.assets[1]!, handle: "@garden" };
  plan.scene = plan.scene.replace("@kitchen", "@garden");
  plan.shots = plan.shots.map((shot) => ({ ...shot, action: shot.action.replace("@kitchen", "@garden") }));
  return plan;
}

describe("parseAgentJson", () => {
  it("accepts one JSON value with whitespace around it", () => {
    expect(parseAgentJson('  {"a": 1}\n')).toEqual({ a: 1 });
  });

  it("refuses a code fence or prose around the JSON", () => {
    expect(() => parseAgentJson('```json\n{"a": 1}\n```')).toThrow(/not a single JSON value/);
    expect(() => parseAgentJson('Here is the plan: {"a": 1}')).toThrow(LabError);
  });
});

describe("labSave: plans", () => {
  it("saves the first plan as plan.1.json", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    expect(await save(env, id, "plan", boardPlan())).toMatchObject({ ok: true, file: "plan.1.json", attempt: 1 });
    expect((await readRun(env.root, id)).attempts.plan).toBe(1);
  });

  it("refuses a patch that renames an asset, and counts the refusal", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await save(env, id, "plan", boardPlan());
    await expect(save(env, id, "plan", renamed())).rejects.toThrow(/handle changed/);
    const run = await readRun(env.root, id);
    expect(run.refusedInARow.plan).toBe(1);
    expect(run.attempts.plan).toBe(1);
    expect(await readJson(env.root, id, "plan.2.json")).toBeNull();
  });

  it("fails the run on the third refused save in a row", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    for (let i = 0; i < 3; i++) await expect(save(env, id, "plan", "```json {}```")).rejects.toThrow(LabError);
    const run = await readRun(env.root, id);
    expect(run.status).toBe("failed");
    expect(run.reason).toBe("3 invalid plan saves in a row");
    await expect(save(env, id, "plan", boardPlan())).rejects.toThrow("run is failed");
  });

  it("resets the in-a-row count after a good save", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await expect(save(env, id, "plan", "nope")).rejects.toThrow(LabError);
    await save(env, id, "plan", boardPlan());
    const run = await readRun(env.root, id);
    expect(run.refusedInARow.plan).toBe(0);
    expect(run.refusedTotal.plan).toBe(1);
  });

  it("stops the run when the Director is out of retries", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    for (let i = 0; i < 3; i++) await save(env, id, "plan", boardPlan());
    await expect(save(env, id, "plan", boardPlan())).rejects.toThrow("director out of retries");
    const run = await readRun(env.root, id);
    expect(run.status).toBe("stopped");
    expect(run.reason).toBe("director out of retries");
  });

  it("refuses a plan that breaks the shape rules", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    const plan = boardPlan();
    plan.assets.push({ handle: "@second", kind: "product", description: "another" });
    await expect(save(env, id, "plan", plan)).rejects.toThrow(/2 product assets/);
  });

  it("lower-cases a capitalised handle instead of refusing it", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    const plan = boardPlan();
    plan.assets[2] = { ...plan.assets[2]!, handle: "@Maya" };
    await save(env, id, "plan", plan);
    const saved = await readJson<Plan>(env.root, id, "plan.1.json");
    expect(saved!.assets[2]!.handle).toBe("@maya");
  });
});

describe("labSave: cameras", () => {
  it("refuses cameras before any plan", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await expect(save(env, id, "cameras", { forPlan: 1, cameras: boardCameras() }, "cinematographer")).rejects.toThrow(/no plan/);
  });

  it("remembers which plan a camera set was made for", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await save(env, id, "plan", boardPlan());
    await save(env, id, "cameras", { forPlan: 1, cameras: boardCameras() }, "cinematographer");
    expect(await readJson<CameraSet>(env.root, id, "cameras.1.json")).toEqual({ forPlan: 1, cameras: boardCameras() });
  });

  it("lets a reshoot change only the shots the check sent back", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await save(env, id, "plan", boardPlan());
    await save(env, id, "cameras", { forPlan: 1, cameras: boardCameras() }, "cinematographer");
    const run = await readRun(env.root, id);
    await writeRun(env.root, { ...run, pendingReshoot: { forCameras: 1, shots: [2] } });

    const touchesShot1 = boardCameras().map((c) => (c.shot === 1 ? { ...c, light: "sun from behind" } : c));
    await expect(save(env, id, "cameras", { forPlan: 1, cameras: touchesShot1 }, "cinematographer")).rejects.toThrow(/shot 1/);

    const onlyShot2 = boardCameras().map((c) => (c.shot === 2 ? { ...c, light: "sun from behind" } : c));
    await expect(save(env, id, "cameras", { forPlan: 1, cameras: onlyShot2 }, "cinematographer")).resolves.toMatchObject({ attempt: 2 });
  });

  it("clears shot checks and any reshoot when a new plan arrives", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await save(env, id, "plan", boardPlan());
    await save(env, id, "cameras", { forPlan: 1, cameras: boardCameras() }, "cinematographer");
    const run = await readRun(env.root, id);
    await writeRun(env.root, {
      ...run,
      pendingReshoot: { forCameras: 1, shots: [2] },
      lastChecks: { ...run.lastChecks, shots: { attempt: 1, forPlan: 1, passed: false, outcomes: [] } },
    });
    await save(env, id, "plan", boardPlan());
    const after = await readRun(env.root, id);
    expect(after.pendingReshoot).toBeNull();
    expect(after.lastChecks.shots).toBeNull();
  });
});

describe("labSave: questions, answers, brief", () => {
  const questions = { questions: [{ id: "q1", topic: "website", question: "Which website?", ifYouDecide: "https://www.apple.com" }] };

  it("accepts a website question when nothing was scraped", async () => {
    const env = await newLabEnv();
    const run = await createRun(env.root, { arch: "swarm", brief: "an ad for Apple", url: null });
    await expect(save(env, run.id, "questions", questions, "interrogator")).resolves.toMatchObject({ file: "questions.json" });
  });

  it("refuses answers that skip a question", async () => {
    const env = await newLabEnv();
    const run = await createRun(env.root, { arch: "swarm", brief: "an ad for Apple", url: null });
    await save(env, run.id, "questions", questions, "interrogator");
    await expect(save(env, run.id, "answers", { answers: [] }, "owner")).rejects.toThrow(/q1/);
  });

  it("refuses a new brief once a plan exists", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await save(env, id, "plan", boardPlan());
    await expect(save(env, id, "brief", {}, "interrogator")).rejects.toThrow("the brief is fixed once a plan exists");
  });
});
