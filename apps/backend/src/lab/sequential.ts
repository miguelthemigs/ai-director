import type { CheckOutcome } from "@ai-director/contract";
import type { ParseTransport } from "../api/client.js";
import { CINEMATOGRAPHER_PROMPTS_V2 } from "../agents/cinematographer/prompt-v2.js";
import { reshoot, shootAll } from "../agents/cinematographer/run.js";
import {
  buildDirectorPatchSystemPromptV2,
  buildDirectorSystemPromptV2,
  renderLabDirectorPatchRequest,
  renderLabDirectorRequest,
} from "../agents/director/prompt-v2.js";
import { askForPlan } from "../agents/director/run.js";
import { askQuestions, fillBrief } from "../agents/interrogator/runV2.js";
import { meter } from "../orchestrate/director/metered.js";
import {
  labAssemble,
  labAvatars,
  labCheck,
  labFail,
  labRefuse,
  labSave,
  labScrape,
  latestCameras,
  latestPlan,
  type LabEnv,
} from "./commands.js";
import { LabError, appendCalls, readJson, readRun } from "./runStore.js";
import type { ScrapeResult } from "./scrape.js";
import type { LabAnswers, LabBrief, LabQuestion, LabRun, LabStep } from "./types.js";

/**
 * The SEQUENTIAL architecture: a fixed recipe in code. Code decides every step and its
 * order (Interrogator, Director, plan checks, Cinematographer, shot checks, Assembler);
 * the models only do the steps. Every model output goes through the same `lab` commands
 * the coordinator's and the swarm's agents call, so the rules are identical; only the
 * wiring differs. The transport is injected: this file never builds a real one.
 */
export const LAB_SPECIALIST_MODEL = "claude-sonnet-5-5";
export const MAX_ASKS_PER_STEP = 3;

export type SequentialDeps = { env: LabEnv; transport: ParseTransport; print: (line: string) => void };

async function sequentialRun(deps: SequentialDeps, runId: string): Promise<LabRun> {
  const run = await readRun(deps.env.root, runId);
  if (run.arch !== "sequential") throw new LabError(`run ${runId} is a ${run.arch} run, not sequential`);
  if (run.status !== "running") throw new LabError(`run is ${run.status}`);
  return run;
}

/** The model call itself failed (rate limit, network, auth): not an invalid answer. */
class ModelCallError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ModelCallError";
  }
}

/** One model call, metered; its calls go to `calls.jsonl` whether it succeeds or throws. */
async function metered<T>(
  deps: SequentialDeps,
  runId: string,
  agent: "interrogator" | "director" | "cinematographer",
  call: (transport: ParseTransport) => Promise<T>,
): Promise<T> {
  const m = meter(deps.transport, `${agent}/v2`);
  const guarded: ParseTransport = async (args) => {
    try {
      return await m.transport(args);
    } catch (error) {
      throw new ModelCallError(error);
    }
  };
  try {
    return await call(guarded);
  } finally {
    await appendCalls(deps.env.root, runId, m.calls());
  }
}

/**
 * Asks the model for one step's output and saves it through `labSave`, re-asking on a
 * thrown error or a refused save. Returns false once the run is no longer running (the
 * third refusal in a row has failed it, or a retry cap has stopped it).
 */
async function produce(
  deps: SequentialDeps,
  runId: string,
  step: LabStep,
  agent: "interrogator" | "director" | "cinematographer",
  generate: (transport: ParseTransport) => Promise<unknown>,
): Promise<boolean> {
  for (let ask = 1; ask <= MAX_ASKS_PER_STEP; ask++) {
    let value: unknown;
    try {
      value = await metered(deps, runId, agent, generate);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof ModelCallError) {
        // Not the model's answer being wrong: the run fails with the real cause, uncounted.
        deps.print(`[failed] ${step}: the model call failed: ${reason}`);
        await labFail(deps.env, runId, `the model call failed: ${reason}`, agent);
        return false;
      }
      deps.print(`[refused] ${step}: ${reason}`);
      const run = await labRefuse(deps.env, runId, step, reason, agent);
      if (run.status !== "running") return false;
      continue;
    }
    try {
      await labSave(deps.env, runId, step, JSON.stringify(value), agent);
      return true;
    } catch (error) {
      if (!(error instanceof LabError)) throw error;
      deps.print(`[refused] ${step}: ${error.message}`);
      if ((await readRun(deps.env.root, runId)).status !== "running") return false;
    }
  }
  return (await readRun(deps.env.root, runId)).status === "running";
}

/** The Interrogator's questions. With none, the empty answers are saved too. */
export async function sequentialAsk(deps: SequentialDeps, runId: string): Promise<LabQuestion[]> {
  await sequentialRun(deps, runId);
  const scrape = await readJson<ScrapeResult>(deps.env.root, runId, "scrape.json");
  const avatars = await labAvatars(deps.env);
  const brief = (await readRun(deps.env.root, runId)).brief;

  const saved = await produce(deps, runId, "questions", "interrogator", async (transport) => ({
    questions: await askQuestions({ transport }, { brief, scrape, avatars }),
  }));
  if (!saved) return [];
  const questions = (await readJson<LabQuestion[]>(deps.env.root, runId, "questions.json")) ?? [];
  deps.print(`[interrogator] ${questions.length} question${questions.length === 1 ? "" : "s"}`);
  if (questions.length === 0) await labSave(deps.env, runId, "answers", JSON.stringify({ answers: [] }), "lab");
  return questions;
}

const looksLikeUrl = (text: string): boolean => /^https?:\/\/\S+$/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
const asUrl = (text: string): string => (/^https?:\/\//i.test(text) ? text : `https://${text}`);

/** The website the owner gave as an answer, or the Interrogator's suggestion on "you decide". */
function answeredWebsite(questions: LabQuestion[], answers: LabAnswers): string | null {
  const question = questions.find((q) => q.topic === "website");
  if (!question) return null;
  const answer = answers.answers.find((a) => a.id === question.id)?.answer.trim() ?? "";
  const candidate = /^you decide$/i.test(answer) ? question.ifYouDecide.trim() : answer;
  return looksLikeUrl(candidate) ? asUrl(candidate) : null;
}

const failuresOf = (outcomes: CheckOutcome[]): CheckOutcome[] => outcomes.filter((outcome) => !outcome.passed);

/** Everything after the owner's answers, in a fixed order, to a terminal state. */
export async function sequentialFinish(deps: SequentialDeps, runId: string): Promise<LabRun> {
  const { env, print } = deps;
  await sequentialRun(deps, runId);
  const questions = (await readJson<LabQuestion[]>(env.root, runId, "questions.json")) ?? [];
  const answers = await readJson<LabAnswers>(env.root, runId, "answers.json");
  if (answers === null) throw new LabError("answer the Interrogator's questions first (lab save <run> answers)");
  const final = () => readRun(env.root, runId);

  // 1. A website given as an answer is read before the brief is filled.
  let scrape = await readJson<ScrapeResult>(env.root, runId, "scrape.json");
  const website = answeredWebsite(questions, answers);
  if (website !== null && (scrape === null || !scrape.ok || scrape.text === "")) {
    scrape = await labScrape(env, runId, website);
    print(`[scrape] ${website}: ${scrape.ok ? `${scrape.text.length} characters` : scrape.error}`);
  }

  // 2. The Interrogator fills the brief.
  const avatars = await labAvatars(env);
  const runBrief = (await final()).brief;
  // `lab save brief` takes the model's answer (with `avatarId`), as an agent would save it.
  const filled = await produce(deps, runId, "brief", "interrogator", async (transport) => {
    const lab = await fillBrief({ transport }, { brief: runBrief, scrape, avatars, questions, answers });
    return { ...lab, avatarId: lab.avatar?.avatarId ?? null };
  });
  if (!filled) return final();
  const brief = (await readJson<LabBrief>(env.root, runId, "brief.json"))!;
  print(`[interrogator] brief filled: ${brief.productKind}, ${brief.seconds} s`);

  // 3. The Director plans; plan checks route a failure back to it.
  for (;;) {
    const run = await final();
    const previous = await latestPlan(env, run);
    const failures = failuresOf(run.lastChecks.plan?.outcomes ?? []);
    const saved = await produce(deps, runId, "plan", "director", (transport) =>
      previous === null
        ? askForPlan(transport, buildDirectorSystemPromptV2(), renderLabDirectorRequest(brief))
        : askForPlan(
            transport,
            buildDirectorPatchSystemPromptV2(),
            renderLabDirectorPatchRequest({ brief, plan: previous, failures }),
          ),
    );
    if (!saved) return final();
    const plan = (await latestPlan(env, await final()))!;
    print(`[director] plan ${(await final()).attempts.plan}: ${plan.shots.length} shots`);
    const check = await labCheck(env, runId, "plan", "lab");
    print(`[checks] plan: ${check.outcomes.filter((o) => o.passed).length} of ${check.outcomes.length} passed`);
    if (check.route.kind === "pass") break;
    if (check.route.kind === "stop") {
      print(`[route] stop: ${check.route.reason}`);
      return final();
    }
    print(`[route] redo director: ${check.route.checkIds.join(", ")}`);
  }

  // 4. The Cinematographer shoots; shot checks route a failure back to it.
  for (;;) {
    const run = await final();
    const plan = (await latestPlan(env, run))!;
    const previous = await latestCameras(env, run);
    const pending = run.pendingReshoot;
    const saved = await produce(deps, runId, "cameras", "cinematographer", async (transport) => ({
      forPlan: run.attempts.plan,
      cameras:
        previous === null || pending === null
          ? await shootAll({ transport }, { plan, seconds: brief.seconds }, CINEMATOGRAPHER_PROMPTS_V2)
          : await reshoot(
              { transport },
              {
                plan,
                cameras: previous.cameras,
                shots: pending.shots,
                failures: failuresOf(run.lastChecks.shots?.outcomes ?? []),
              },
              CINEMATOGRAPHER_PROMPTS_V2,
            ),
    }));
    if (!saved) return final();
    print(`[cinematographer] cameras ${(await final()).attempts.cameras}`);
    const check = await labCheck(env, runId, "shots", "lab");
    print(`[checks] shots: ${check.outcomes.filter((o) => o.passed).length} of ${check.outcomes.length} passed`);
    if (check.route.kind === "pass") break;
    if (check.route.kind === "stop") {
      print(`[route] stop: ${check.route.reason}`);
      return final();
    }
    print(`[route] redo cinematographer: shots ${check.route.shots.join(", ")}`);
  }

  // 5. Code assembles the prompt.
  const assembled = await labAssemble(env, runId, "lab");
  print(`[assembler] prompt: ${assembled.chars} characters`);
  return final();
}
