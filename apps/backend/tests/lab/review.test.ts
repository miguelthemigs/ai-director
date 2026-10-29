import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Plan } from "@ai-director/contract";
import type { ParseTransport } from "../../src/api/client.js";
import { InterrogatorQuestionsSchema } from "../../src/agents/interrogator/schema.js";
import { labCollect } from "../../src/lab/collect.js";
import { labAssemble, labCheck, labNew, labSave, type LabEnv } from "../../src/lab/commands.js";
import { renderAgentFiles } from "../../src/lab/agentFiles.js";
import { createRun, readRun } from "../../src/lab/runStore.js";
import { sequentialAsk, sequentialFinish } from "../../src/lab/sequential.js";
import { boardCameras, boardPlan } from "../orchestrate/director/planFixture.js";
import { cleanLabEnvs, newLabEnv, runWithBrief } from "./labEnv.js";

afterEach(cleanLabEnvs);

const savePlan = (env: LabEnv, id: string, plan: Plan = boardPlan()) => labSave(env, id, "plan", JSON.stringify(plan), "director");
const saveCameras = (env: LabEnv, id: string, forPlan: number, cameras = boardCameras()) =>
  labSave(env, id, "cameras", JSON.stringify({ forPlan, cameras }), "cinematographer");

describe("final review fixes", () => {
  it("refuses a camera for a shot the plan does not have, so it can be fixed instead of failing the run", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    const extra = [...boardCameras(), { ...boardCameras()[0]!, shot: 5 }];
    await expect(saveCameras(env, id, 1, extra)).rejects.toThrow("shot 5 is not in the plan (shots 1-4)");
    const zeroBased = boardCameras().map((camera) => ({ ...camera, shot: camera.shot - 1 }));
    await expect(saveCameras(env, id, 1, zeroBased)).rejects.toThrow("shot 0 is not in the plan");
    await expect(saveCameras(env, id, 1)).resolves.toMatchObject({ attempt: 1 });
  });

  it("never loses an update when two commands touch one run at once", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await labCheck(env, id, "plan", "director");
    await saveCameras(env, id, 1);
    await Promise.all([savePlan(env, id), labCheck(env, id, "shots", "cinematographer").catch(() => null)]);
    const run = await readRun(env.root, id);
    expect(run.attempts.plan).toBe(2);
    await expect(labAssemble(env, id, "cinematographer")).rejects.toThrow();
  });

  it("refuses cameras made for a plan that is no longer the latest", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    await savePlan(env, id);
    await savePlan(env, id);
    await expect(saveCameras(env, id, 1)).rejects.toThrow("these cameras are for plan 1, the latest plan is 2");
    await expect(
      labSave(env, id, "cameras", JSON.stringify({ cameras: boardCameras() }), "cinematographer"),
    ).rejects.toThrow(/forPlan/);
  });

  it("tells a coordinator subagent to return after one check instead of fixing on its own", () => {
    const files = renderAgentFiles();
    for (const name of ["lab-director", "lab-cinematographer"] as const) {
      expect(files[name]).toContain("save once, run the check once, and return");
      expect(files[name]).toContain("Do not fix it on your own");
    }
  });

  it("lets a brief with no questions be filled without saving empty answers first", async () => {
    const env = await newLabEnv();
    const run = await createRun(env.root, { arch: "coordinator", brief: "a detailed brief", url: null });
    await labSave(env, run.id, "questions", JSON.stringify({ questions: [] }), "interrogator");
    const fill = {
      productKind: "headphones", product: "sand fabric headphones", audience: "a", tone: "b", setting: "c",
      character: "d", seconds: 15, mustNotAppear: [], avatarId: null,
    };
    await expect(labSave(env, run.id, "brief", JSON.stringify(fill), "interrogator")).resolves.toMatchObject({ file: "brief.json" });
    expect((await readRun(env.root, run.id)).refusedTotal.brief).toBe(0);
  });

  it("tells the Interrogator to read the website it suggested when the owner says 'you decide'", () => {
    expect(renderAgentFiles()["lab-interrogator"]).toContain("answered \"you decide\" to the website question");
  });

  it("refuses to collect a session that never mentions the run", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "swarm", brief: "an ad", url: null });
    await expect(labCollect(env, runId, ["s1"], path.join(import.meta.dirname, "fixtures", "claude-projects"))).rejects.toThrow(
      `session s1 never mentions run ${runId}`,
    );
  });

  it("fails the run with the real cause when the model call itself fails, without counting a refusal", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "sequential", brief: "an ad", url: null });
    const failing: ParseTransport = async ({ schema }) => {
      if (schema === InterrogatorQuestionsSchema) return { parsed_output: { questions: [] } };
      throw new Error("429 rate_limit_error");
    };
    const deps = { env, transport: failing, print: () => {} };
    await sequentialAsk(deps, runId);
    const run = await sequentialFinish(deps, runId);
    expect(run.status).toBe("failed");
    expect(run.reason).toContain("the model call failed: 429 rate_limit_error");
    expect(run.refusedTotal.brief).toBe(0);
  });

  it("fails the run, instead of leaving it running, when assembly breaks an invariant", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    const plan = boardPlan();
    plan.shots[0] = { ...plan.shots[0]!, action: `@maya walks into @kitchen and reaches for @product ${"slowly ".repeat(2500)}` };
    await savePlan(env, id, plan);
    await labCheck(env, id, "plan", "director");
    await saveCameras(env, id, 1);
    await labCheck(env, id, "shots", "cinematographer");
    await expect(labAssemble(env, id, "cinematographer")).rejects.toThrow(/cap is 15000/);
    const run = await readRun(env.root, id);
    expect(run.status).toBe("failed");
    expect(run.reason).toContain("cap is 15000");
  });

  it("asks the owner at most 4 questions per prompt, with the choice in the option description", async () => {
    const skill = await readFile(path.join(import.meta.dirname, "../../../../.claude/skills/direct/SKILL.md"), "utf8");
    expect(skill).toContain("at most 4 questions per AskUserQuestion call");
    expect(skill).toContain("$CLAUDE_CODE_SESSION_ID");
  });
});
