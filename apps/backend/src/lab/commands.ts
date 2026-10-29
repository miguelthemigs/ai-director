import { readFile } from "node:fs/promises";
import path from "node:path";
import { MAX_RETRIES_PER_OWNER, type Camera, type CheckOutcome, type Plan } from "@ai-director/contract";
import { CinematographerOutputSchema } from "../agents/cinematographer/schema.js";
import type { AvatarChoice } from "../agents/interrogator/prompt-v2.js";
import { validateFill, validateQuestions } from "../agents/interrogator/runV2.js";
import { assertPlanShape, lowerCaseHandles, planAssetChanges } from "../agents/director/run.js";
import { DirectorPlanSchema } from "../agents/director/schema.js";
import { runPlanChecks, runPromptChecks } from "../orchestrate/director/checks.js";
import { AssemblyInvariantError } from "../orchestrate/director/assemble.js";
import { route, type Route } from "../orchestrate/director/router.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { writeTextAtomic } from "../store/FileRunStore.js";
import { assembleTextPrompt, renderShotList } from "./assemble.js";
import {
  LabError,
  appendTrace,
  createRun,
  readJson,
  readRun,
  withRunLock,
  writeJson,
  writeRun,
} from "./runStore.js";
import { scrapeUrl, type ScrapeResult } from "./scrape.js";
import type { CameraSet, LabAnswers, LabArch, LabBrief, LabQuestion, LabRun, LabStep } from "./types.js";

/**
 * The lab's toolbox. Every architecture (the recipe in code, the coordinator's subagents,
 * the swarm's teammates) saves, checks and assembles through these functions, so every
 * rule lives here, in code, once: what a valid output is, how many tries an owner gets,
 * when a run stops or fails. A refusal is a `LabError` whose message tells the agent why.
 */
export type LabEnv = { root: string; avatarsDir: string; now?: () => Date; fetchImpl?: typeof fetch };

/** Three refused saves in a row for the same step end the run `failed`. */
export const MAX_REFUSALS_IN_A_ROW = 3;

const now = (env: LabEnv): Date => env.now?.() ?? new Date();

async function trace(env: LabEnv, runId: string, line: Parameters<typeof appendTrace>[2]): Promise<void> {
  await appendTrace(env.root, runId, line, now(env));
}

async function runningRun(env: LabEnv, runId: string): Promise<LabRun> {
  const run = await readRun(env.root, runId);
  if (run.status !== "running") throw new LabError(`run is ${run.status}`);
  return run;
}

/** Ends a run: `stopped`, `failed` or `done`, with the reason and the time. */
export async function finishRun(
  env: LabEnv,
  run: LabRun,
  status: "stopped" | "failed" | "done",
  reason: string | null,
): Promise<LabRun> {
  const finished: LabRun = { ...run, status, reason, finishedAt: now(env).toISOString() };
  await writeRun(env.root, finished);
  return finished;
}

export async function labNew(
  env: LabEnv,
  args: { arch: LabArch; brief: string; url: string | null },
): Promise<{ runId: string; scrape: ScrapeResult | null }> {
  if (args.brief.trim() === "") throw new LabError("the brief is blank");
  const run = await createRun(env.root, { ...args, now: now(env) });
  await trace(env, run.id, { actor: "owner", kind: "new", text: `${args.arch}: ${args.brief}` });
  const scrape = args.url === null ? null : await labScrape(env, run.id, args.url);
  return { runId: run.id, scrape };
}

export async function labScrape(env: LabEnv, runId: string, url: string): Promise<ScrapeResult> {
  await readRun(env.root, runId);
  const scrape = await scrapeUrl(url, env.fetchImpl ?? fetch);
  await writeJson(env.root, runId, "scrape.json", scrape);
  const summary = scrape.ok ? `${scrape.text.length} characters of text` : `failed: ${scrape.error}`;
  await trace(env, runId, { actor: "lab", kind: "scrape", text: `${url}: ${summary}` });
  return scrape;
}

export async function labAvatars(env: LabEnv): Promise<AvatarChoice[]> {
  const records = await new FileAvatarStore(env.avatarsDir).list();
  return records
    .filter((record) => (record.description ?? "").trim() !== "")
    .map((record) => ({ avatarId: record.id, description: record.description! }));
}

export async function latestPlan(env: LabEnv, run: LabRun): Promise<Plan | null> {
  return run.attempts.plan === 0 ? null : readJson<Plan>(env.root, run.id, `plan.${run.attempts.plan}.json`);
}

export async function latestCameras(env: LabEnv, run: LabRun): Promise<CameraSet | null> {
  return run.attempts.cameras === 0 ? null : readJson<CameraSet>(env.root, run.id, `cameras.${run.attempts.cameras}.json`);
}

/** The whole run at a glance, or one of its files. */
export async function labShow(env: LabEnv, runId: string, file?: string): Promise<unknown> {
  const run = await readRun(env.root, runId);
  if (file !== undefined) {
    if (file.endsWith(".json")) {
      const value = await readJson(env.root, runId, file);
      if (value === null) throw new LabError(`no file ${file} in run ${runId}`);
      return value;
    }
    if (!/^[\w.-]+$/.test(file)) throw new LabError(`not a run file: ${file}`);
    try {
      return await readFile(path.join(env.root, runId, file), "utf8");
    } catch {
      throw new LabError(`no file ${file} in run ${runId}`);
    }
  }
  return {
    run,
    scrape: await readJson(env.root, runId, "scrape.json"),
    questions: await readJson(env.root, runId, "questions.json"),
    answers: await readJson(env.root, runId, "answers.json"),
    brief: await readJson(env.root, runId, "brief.json"),
    latestPlan: await latestPlan(env, run),
    latestCameras: await latestCameras(env, run),
    lastChecks: run.lastChecks,
  };
}

export async function labLog(
  env: LabEnv,
  runId: string,
  args: { from: string; to: string; text: string },
): Promise<{ ok: true }> {
  await readRun(env.root, runId);
  await trace(env, runId, { actor: args.from, kind: "message", to: args.to, text: args.text });
  return { ok: true };
}

/** One JSON value and nothing else: an agent that wraps it in a fence or a sentence is refused, never half-parsed. */
export function parseAgentJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    const start = text.trim().slice(0, 40).replace(/\s+/g, " ");
    throw new LabError(`not a single JSON value (no code fence, no text around it); it starts with: ${start}`);
  }
}

function schemaError(what: string, issues: Array<{ path: PropertyKey[]; message: string }>): LabError {
  const first = issues[0];
  const where = first && first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
  return new LabError(`${what} does not match the schema${where}: ${first?.message ?? "invalid"}`);
}

/** A thrown shape error from the agents' own validation becomes a refusal with its message. */
function asRefusal(error: unknown): LabError {
  return error instanceof LabError ? error : new LabError(error instanceof Error ? error.message : String(error));
}

function validateAnswers(raw: unknown, questions: LabQuestion[]): LabAnswers {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as LabAnswers).answers)) {
    throw new LabError('answers must be { "answers": [{ "id": ..., "answer": ... }] }');
  }
  const answers = (raw as LabAnswers).answers;
  for (const item of answers) {
    if (typeof item?.id !== "string" || typeof item?.answer !== "string" || item.answer.trim() === "") {
      throw new LabError("every answer needs an id and a non-blank answer (\"you decide\" is fine)");
    }
  }
  const ids = answers.map((item) => item.id);
  for (const question of questions) {
    const count = ids.filter((id) => id === question.id).length;
    if (count !== 1) throw new LabError(`question ${question.id} must be answered exactly once, got ${count}`);
  }
  const unknown = ids.filter((id) => !questions.some((question) => question.id === id));
  if (unknown.length > 0) throw new LabError(`answers to questions that were not asked: ${unknown.join(", ")}`);
  return { answers: answers.map(({ id, answer }) => ({ id, answer })) };
}

function validateCameras(raw: unknown, shotCount: number): Camera[] {
  const parsed = CinematographerOutputSchema.safeParse(raw);
  if (!parsed.success) throw schemaError("the cameras", parsed.error.issues);
  for (const camera of parsed.data.cameras) {
    if (!Number.isInteger(camera.shot) || camera.shot < 1 || camera.shot > shotCount) {
      throw new LabError(`shot ${camera.shot} is not in the plan (shots 1-${shotCount})`);
    }
    if (!Number.isFinite(camera.lensMm) || camera.lensMm <= 0) {
      throw new LabError(`shot ${camera.shot} has a lens of ${camera.lensMm} mm`);
    }
  }
  return parsed.data.cameras;
}

/** A reshoot keeps every camera outside the shots the check sent back, exactly. */
function assertReshoot(previous: Camera[], next: Camera[], shots: number[], shotCount: number): void {
  const listed = new Set(shots);
  const key = (camera: Camera) => JSON.stringify(camera);
  const changed = new Set<number>();
  const before = previous.filter((camera) => !listed.has(camera.shot));
  const after = next.filter((camera) => !listed.has(camera.shot));
  for (const camera of before) if (!after.some((c) => key(c) === key(camera))) changed.add(camera.shot);
  for (const camera of after) if (!before.some((c) => key(c) === key(camera))) changed.add(camera.shot);
  if (changed.size > 0) {
    throw new LabError(
      `a reshoot may change only shot ${shots.join(", ")}; shot ${[...changed].sort((a, b) => a - b).join(", ")} changed`,
    );
  }
  // A listed shot the plan does not have cannot get a camera (save refuses it); it is dropped.
  for (const shot of shots.filter((n) => n >= 1 && n <= shotCount)) {
    const count = next.filter((camera) => camera.shot === shot).length;
    if (count !== 1) throw new LabError(`a reshoot needs exactly one camera for shot ${shot}, got ${count}`);
  }
}

type Validated =
  | { step: "questions"; value: LabQuestion[] }
  | { step: "answers"; value: LabAnswers }
  | { step: "brief"; value: LabBrief }
  | { step: "plan"; value: Plan }
  | { step: "cameras"; value: Camera[] };

async function validate(env: LabEnv, run: LabRun, step: LabStep, json: string): Promise<Validated> {
  if ((step === "questions" || step === "answers" || step === "brief") && run.attempts.plan > 0) {
    throw new LabError("the brief is fixed once a plan exists");
  }
  const raw = parseAgentJson(json);
  switch (step) {
    case "questions":
      return { step, value: validateQuestions(raw) };
    case "answers": {
      const questions = await readJson<LabQuestion[]>(env.root, run.id, "questions.json");
      if (questions === null) throw new LabError("no questions saved yet");
      return { step, value: validateAnswers(raw, questions) };
    }
    case "brief": {
      const questions = await readJson<LabQuestion[]>(env.root, run.id, "questions.json");
      if (questions === null) throw new LabError("no questions saved yet");
      // With no questions there is nothing to answer: the brief may be filled at once.
      if (questions.length > 0 && (await readJson(env.root, run.id, "answers.json")) === null) {
        throw new LabError("no answers saved yet");
      }
      return { step, value: validateFill(raw, { brief: run.brief, avatars: await labAvatars(env) }) };
    }
    case "plan": {
      if ((await readJson(env.root, run.id, "brief.json")) === null) throw new LabError("no brief saved yet");
      const parsed = DirectorPlanSchema.safeParse(raw);
      if (!parsed.success) throw schemaError("the plan", parsed.error.issues);
      const plan = lowerCaseHandles(parsed.data);
      assertPlanShape(plan);
      const previous = await latestPlan(env, run);
      if (previous !== null) {
        const changes = planAssetChanges(previous, plan);
        if (changes.length > 0) throw new LabError(`a new plan may change only asset descriptions: ${changes.join("; ")}`);
      }
      return { step, value: plan };
    }
    case "cameras": {
      const plan = await latestPlan(env, run);
      if (plan === null) throw new LabError("no plan saved yet");
      // The saver says which plan it shot, so cameras made from a plan that was revised
      // meanwhile (a swarm's Director working alongside) are refused, not relabelled.
      const forPlan = (raw as { forPlan?: unknown } | null)?.forPlan;
      if (typeof forPlan !== "number") {
        throw new LabError('cameras need "forPlan": the plan attempt you shot (lab show prints run.attempts.plan)');
      }
      if (forPlan !== run.attempts.plan) {
        throw new LabError(`these cameras are for plan ${forPlan}, the latest plan is ${run.attempts.plan}: read it and shoot again`);
      }
      const cameras = validateCameras(raw, plan.shots.length);
      const previous = await latestCameras(env, run);
      const pending = run.pendingReshoot;
      if (pending !== null && previous !== null && pending.forCameras === run.attempts.cameras && previous.forPlan === run.attempts.plan) {
        assertReshoot(previous.cameras, cameras, pending.shots, plan.shots.length);
      }
      return { step, value: cameras };
    }
  }
}

/**
 * Counts one invalid output for a step. The third in a row ends the run `failed`. The
 * recipe calls this too when a model answer is refused before it reaches `labSave`, so
 * every architecture is held to the same count.
 */
export async function labRefuse(env: LabEnv, runId: string, step: LabStep, reason: string, by: string): Promise<LabRun> {
  return withRunLock(env.root, runId, async () => refuse(env, await runningRun(env, runId), step, reason, by));
}

/** Ends a run `failed` for a cause that is not an invalid output (a model call that failed). */
export async function labFail(env: LabEnv, runId: string, reason: string, by: string): Promise<LabRun> {
  return withRunLock(env.root, runId, async () => {
    const run = await finishRun(env, await runningRun(env, runId), "failed", reason);
    await trace(env, runId, { actor: by, kind: "fail", text: reason });
    return run;
  });
}

async function refuse(env: LabEnv, run: LabRun, step: LabStep, reason: string, by: string): Promise<LabRun> {
  const inARow = run.refusedInARow[step] + 1;
  let next: LabRun = {
    ...run,
    refusedInARow: { ...run.refusedInARow, [step]: inARow },
    refusedTotal: { ...run.refusedTotal, [step]: run.refusedTotal[step] + 1 },
  };
  await writeRun(env.root, next);
  await trace(env, run.id, { actor: by, kind: "refused", text: `${step} refused: ${reason}` });
  if (inARow >= MAX_REFUSALS_IN_A_ROW) {
    next = await finishRun(env, next, "failed", `${MAX_REFUSALS_IN_A_ROW} invalid ${step} saves in a row`);
    await trace(env, run.id, { actor: "lab", kind: "fail", text: next.reason! });
  }
  return next;
}

/**
 * Validates and saves one agent output. A refusal is counted (the third in a row for a step
 * fails the run); a valid plan or camera set past the owner's retries stops the run.
 */
export async function labSave(
  env: LabEnv,
  runId: string,
  step: LabStep,
  json: string,
  by: string,
): Promise<{ ok: true; file: string; attempt?: number }> {
  return withRunLock(env.root, runId, () => save(env, runId, step, json, by));
}

async function save(
  env: LabEnv,
  runId: string,
  step: LabStep,
  json: string,
  by: string,
): Promise<{ ok: true; file: string; attempt?: number }> {
  const run = await runningRun(env, runId);

  let validated: Validated;
  try {
    validated = await validate(env, run, step, json);
  } catch (error) {
    const refusal = asRefusal(error);
    await refuse(env, run, step, refusal.message, by);
    throw refusal;
  }

  const cleared: LabRun = { ...run, refusedInARow: { ...run.refusedInARow, [step]: 0 } };
  switch (validated.step) {
    case "questions":
    case "answers":
    case "brief": {
      const file = `${validated.step}.json`;
      await writeJson(env.root, runId, file, validated.value);
      await writeRun(env.root, cleared);
      await trace(env, runId, { actor: by, kind: "save", text: `${validated.step} saved` });
      return { ok: true, file };
    }
    case "plan":
    case "cameras": {
      const owner = validated.step === "plan" ? "director" : "cinematographer";
      const key = validated.step;
      const attempt = run.attempts[key] + 1;
      if (attempt - 1 > MAX_RETRIES_PER_OWNER) {
        const reason = `${owner} out of retries`;
        await finishRun(env, cleared, "stopped", reason);
        await trace(env, runId, { actor: "lab", kind: "stop", text: reason });
        throw new LabError(reason);
      }
      const file = `${key}.${attempt}.json`;
      const value: Plan | CameraSet =
        validated.step === "plan" ? validated.value : { forPlan: run.attempts.plan, cameras: validated.value };
      await writeJson(env.root, runId, file, value);
      const next: LabRun = {
        ...cleared,
        attempts: { ...run.attempts, [key]: attempt },
        lastChecks: validated.step === "plan" ? { plan: null, shots: null } : { ...run.lastChecks, shots: null },
        pendingReshoot: null,
      };
      await writeRun(env.root, next);
      await trace(env, runId, { actor: by, kind: "save", text: `${key} ${attempt} saved` });
      return { ok: true, file, attempt };
    }
  }
}

function describeRoute(result: Route): string {
  if (result.kind === "pass") return "pass";
  if (result.kind === "stop") return `stop: ${result.reason}`;
  const shots = result.shots.length > 0 ? `, shots ${result.shots.join(", ")}` : "";
  return `redo ${result.owner} (${result.checkIds.join(", ")}${shots})`;
}

/**
 * Runs the code checks on the latest plan or camera set and routes a failure with the same
 * `route()` the Director app uses. Retries are counted when a new plan or camera set is
 * saved, so the route here only reads them; a `stop` ends the run.
 */
export async function labCheck(
  env: LabEnv,
  runId: string,
  which: "plan" | "shots",
  by: string,
): Promise<{ passed: boolean; outcomes: CheckOutcome[]; route: Route }> {
  return withRunLock(env.root, runId, () => check(env, runId, which, by));
}

async function check(
  env: LabEnv,
  runId: string,
  which: "plan" | "shots",
  by: string,
): Promise<{ passed: boolean; outcomes: CheckOutcome[]; route: Route }> {
  const run = await runningRun(env, runId);
  const brief = await readJson<LabBrief>(env.root, runId, "brief.json");
  if (brief === null) throw new LabError("no brief saved yet");
  const plan = await latestPlan(env, run);
  if (plan === null) throw new LabError("no plan saved yet");

  let outcomes: CheckOutcome[];
  let attempt: number;
  if (which === "plan") {
    outcomes = runPlanChecks(plan, brief.seconds, brief.mustNotAppear);
    attempt = run.attempts.plan;
  } else {
    const set = await latestCameras(env, run);
    if (set === null) throw new LabError("no cameras saved yet");
    if (set.forPlan !== run.attempts.plan) {
      throw new LabError(`cameras are stale: made for plan ${set.forPlan}, latest is ${run.attempts.plan}`);
    }
    outcomes = runPromptChecks(plan, set.cameras);
    attempt = run.attempts.cameras;
  }

  const retries = { director: run.attempts.plan - 1, cinematographer: Math.max(0, run.attempts.cameras - 1) };
  const result = route(outcomes, retries);
  const passed = outcomes.every((outcome) => outcome.passed);
  const record = { attempt, forPlan: run.attempts.plan, passed, outcomes };
  await writeJson(env.root, runId, `checks.${which}.${attempt}.json`, record);

  let next: LabRun = { ...run, lastChecks: { ...run.lastChecks, [which]: record } };
  if (result.kind === "redo" && result.owner === "cinematographer") {
    next = { ...next, pendingReshoot: { forCameras: run.attempts.cameras, shots: result.shots } };
  }
  await writeRun(env.root, next);
  const count = outcomes.filter((outcome) => outcome.passed).length;
  await trace(env, runId, {
    actor: by,
    kind: "check",
    text: `${which} checks: ${count} of ${outcomes.length} passed -> ${describeRoute(result)}`,
  });
  if (result.kind === "stop") {
    await finishRun(env, next, "stopped", result.reason);
    await trace(env, runId, { actor: "lab", kind: "stop", text: result.reason });
  }
  return { passed, outcomes, route: result };
}

/**
 * Glues the final prompt and the shot list, only once the latest plan and the cameras made
 * for it have both passed their checks. The run is then `done`, the one success state.
 */
export async function labAssemble(
  env: LabEnv,
  runId: string,
  by: string,
): Promise<{ status: "done"; promptFile: string; shotListFile: string; chars: number }> {
  return withRunLock(env.root, runId, () => assemble(env, runId, by));
}

async function assemble(
  env: LabEnv,
  runId: string,
  by: string,
): Promise<{ status: "done"; promptFile: string; shotListFile: string; chars: number }> {
  const run = await runningRun(env, runId);
  const planCheck = run.lastChecks.plan;
  if (planCheck === null || planCheck.attempt !== run.attempts.plan || !planCheck.passed) {
    throw new LabError(`plan checks have not passed on plan ${run.attempts.plan}`);
  }
  const set = await latestCameras(env, run);
  if (set === null || set.forPlan !== run.attempts.plan) {
    throw new LabError(`there are no cameras made for plan ${run.attempts.plan}`);
  }
  const shotCheck = run.lastChecks.shots;
  if (shotCheck === null || shotCheck.attempt !== run.attempts.cameras || !shotCheck.passed) {
    throw new LabError(`shot checks have not passed on camera set ${run.attempts.cameras}`);
  }

  const brief = (await readJson<LabBrief>(env.root, runId, "brief.json"))!;
  const plan = (await latestPlan(env, run))!;
  const character = plan.assets.find((asset) => asset.kind === "character");
  const characterText = brief.avatar?.description ?? character?.description ?? "";
  let text: string;
  try {
    ({ text } = assembleTextPrompt({ plan, cameras: set.cameras, characterText }));
  } catch (error) {
    if (!(error instanceof AssemblyInvariantError)) throw error;
    // A broken invariant is a defect, never routed back to an agent: the run fails with it.
    const reason = `assembly failed: ${error.message}`;
    await finishRun(env, run, "failed", reason);
    await trace(env, runId, { actor: "lab", kind: "fail", text: reason });
    throw new LabError(reason);
  }
  await writeTextAtomic(path.join(env.root, runId, "prompt.txt"), text);
  await writeTextAtomic(
    path.join(env.root, runId, "shotlist.md"),
    renderShotList({ plan, cameras: set.cameras, characterText, brief }),
  );
  await finishRun(env, run, "done", null);
  await trace(env, runId, { actor: by, kind: "assemble", text: `prompt assembled: ${text.length} characters` });
  return { status: "done", promptFile: "prompt.txt", shotListFile: "shotlist.md", chars: text.length };
}

/** Gives up on a run: it ends `stopped`, never a success. */
export async function labStop(env: LabEnv, runId: string, reason: string, by: string): Promise<{ status: "stopped" }> {
  return withRunLock(env.root, runId, async () => {
    const run = await runningRun(env, runId);
    if (reason.trim() === "") throw new LabError("say why the run is stopping");
    await finishRun(env, run, "stopped", reason);
    await trace(env, runId, { actor: by, kind: "stop", text: reason });
    return { status: "stopped" as const };
  });
}
