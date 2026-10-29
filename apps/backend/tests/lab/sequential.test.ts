import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Plan } from "@ai-director/contract";
import type { ParseTransport } from "../../src/api/client.js";
import { CinematographerOutputSchema } from "../../src/agents/cinematographer/schema.js";
import { DirectorPlanSchema } from "../../src/agents/director/schema.js";
import { InterrogatorFillSchema, InterrogatorQuestionsSchema } from "../../src/agents/interrogator/schema.js";
import { labNew, labSave, type LabEnv } from "../../src/lab/commands.js";
import { LabError, readCalls, readJson, readRun } from "../../src/lab/runStore.js";
import { sequentialAsk, sequentialFinish } from "../../src/lab/sequential.js";
import { boardCameras, boardPlan } from "../orchestrate/director/planFixture.js";
import { cleanLabEnvs, newLabEnv } from "./labEnv.js";

afterEach(cleanLabEnvs);

type Script = { questions?: unknown[]; fill?: unknown[]; plans?: unknown[]; cameras?: unknown[] };

/** A fake model: each schema gets the next canned answer from its own queue. */
function scripted(script: Script): ParseTransport {
  const queues = new Map<unknown, unknown[]>([
    [InterrogatorQuestionsSchema, [...(script.questions ?? [])]],
    [InterrogatorFillSchema, [...(script.fill ?? [])]],
    [DirectorPlanSchema, [...(script.plans ?? [])]],
    [CinematographerOutputSchema, [...(script.cameras ?? [])]],
  ]);
  return async ({ schema }) => {
    const queue = queues.get(schema);
    if (!queue || queue.length === 0) throw new Error("the fake model has no answer left for this call");
    return { parsed_output: queue.shift(), usage: { inputTokens: 100, outputTokens: 50 }, model: "claude-sonnet-5-5" };
  };
}

const QUESTIONS = { questions: [{ id: "q1", topic: "location", question: "Where?", ifYouDecide: "A small apartment at dawn" }] };
const FILL = {
  productKind: "wireless over-ear headphones",
  product: "over-ear headphones in sand-coloured fabric",
  audience: "commuters in their twenties",
  tone: "calm",
  setting: "a small apartment at dawn",
  character: "a man in his late twenties",
  seconds: 15,
  mustNotAppear: [],
  avatarId: null,
};

function shortPlan(): Plan {
  const plan = boardPlan();
  plan.shots = plan.shots.slice(0, 2).map((shot) => ({ ...shot, weight: "normal" as const }));
  return plan;
}

function twoProducts(): Plan {
  const plan = boardPlan();
  plan.assets.push({ handle: "@second", kind: "product", description: "another" });
  return plan;
}

async function start(env: LabEnv, transport: ParseTransport, lines: string[] = []) {
  const { runId } = await labNew(env, { arch: "sequential", brief: "an ad for our headphones", url: null });
  const deps = { env, transport, print: (line: string) => lines.push(line) };
  await sequentialAsk(deps, runId);
  await labSave(env, runId, "answers", JSON.stringify({ answers: [{ id: "q1", answer: "you decide" }] }), "owner");
  return { runId, deps };
}

describe("the sequential recipe", () => {
  it("runs the fixed order to a done run", async () => {
    const env = await newLabEnv();
    const lines: string[] = [];
    const transport = scripted({ questions: [QUESTIONS], fill: [FILL], plans: [boardPlan()], cameras: [{ cameras: boardCameras() }] });
    const { runId, deps } = await start(env, transport, lines);
    const run = await sequentialFinish(deps, runId);

    expect(run.status).toBe("done");
    expect(readFileSync(path.join(env.root, runId, "prompt.txt"), "utf8")).toContain("Shot 4:");
    const calls = await readCalls(env.root, runId);
    expect(calls.map((call) => call.promptVersion)).toEqual([
      "interrogator/v2",
      "interrogator/v2",
      "director/v2",
      "cinematographer/v2",
    ]);
    expect(lines.some((line) => line.startsWith("[route]"))).toBe(false);
  });

  it("sends a failed plan back to the Director and passes on the patch", async () => {
    const env = await newLabEnv();
    const lines: string[] = [];
    const transport = scripted({ questions: [QUESTIONS], fill: [FILL], plans: [shortPlan(), boardPlan()], cameras: [{ cameras: boardCameras() }] });
    const { runId, deps } = await start(env, transport, lines);
    const run = await sequentialFinish(deps, runId);

    expect(run.status).toBe("done");
    expect(await readJson(env.root, runId, "plan.2.json")).not.toBeNull();
    expect(lines.some((line) => line.startsWith("[route] redo director"))).toBe(true);
  });

  it("stops when the third plan still fails", async () => {
    const env = await newLabEnv();
    const transport = scripted({ questions: [QUESTIONS], fill: [FILL], plans: [shortPlan(), shortPlan(), shortPlan()] });
    const { runId, deps } = await start(env, transport);
    const run = await sequentialFinish(deps, runId);

    expect(run.status).toBe("stopped");
    expect(await readJson(env.root, runId, "prompt.txt")).toBeNull();
  });

  it("fails after three invalid plans in a row", async () => {
    const env = await newLabEnv();
    const transport = scripted({ questions: [QUESTIONS], fill: [FILL], plans: [twoProducts(), twoProducts(), twoProducts()] });
    const { runId, deps } = await start(env, transport);
    const run = await sequentialFinish(deps, runId);

    expect(run.status).toBe("failed");
    expect(run.reason).toBe("3 invalid plan saves in a row");
    expect((await readRun(env.root, runId)).refusedTotal.plan).toBe(3);
  });

  it("refuses a run made for another architecture", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "coordinator", brief: "an ad", url: null });
    await expect(sequentialAsk({ env, transport: scripted({}), print: () => {} }, runId)).rejects.toBeInstanceOf(LabError);
  });

  it("never builds a real transport itself", () => {
    const source = readFileSync(path.join(import.meta.dirname, "../../src/lab/sequential.ts"), "utf8");
    expect(source).not.toContain("createAnthropicTransport");
  });
});
