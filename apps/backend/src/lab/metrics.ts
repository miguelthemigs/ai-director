import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { CallLog } from "@ai-director/contract";
import type { TranscriptLine } from "./collect.js";
import type { LabEnv } from "./commands.js";
import { LabError, readCalls, readJson, readRun, withRunLock, writeJson, writeRun } from "./runStore.js";
import type { CheckRecord, LabArch, LabStatus, LabStep } from "./types.js";

/**
 * The numbers a run is compared on. Measured, never estimated: a number the run's files do
 * not hold is null, and the comparison says "not measured".
 */
export type Tokens = { input: number; output: number };
export type LabMetrics = {
  runId: string;
  arch: LabArch;
  status: LabStatus | "abandoned";
  reason: string | null;
  wallSeconds: number | null;
  questionsAsked: number;
  /** Recipe: model calls per agent. Claude Code: prompts each agent received (a subagent call, a teammate's turn). */
  invocations: Record<string, number>;
  apiRequests: number | null;
  tokens: (Tokens & { byAgent: Record<string, Tokens> }) | null;
  retries: { director: number; cinematographer: number };
  refusedSaves: Record<LabStep, number>;
  firstTryPass: { plan: boolean | null; shots: boolean | null };
  models: string[];
  efforts: string[];
  rating: { score: number; note: string } | null;
};

async function readTranscript(root: string, runId: string): Promise<TranscriptLine[] | null> {
  try {
    const raw = await readFile(path.join(root, runId, "transcript.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TranscriptLine);
  } catch {
    return null;
  }
}

function add(byAgent: Record<string, Tokens>, agent: string, input: number, output: number): void {
  const current = byAgent[agent] ?? { input: 0, output: 0 };
  byAgent[agent] = { input: current.input + input, output: current.output + output };
}

function fromCalls(calls: CallLog[]): Pick<LabMetrics, "invocations" | "apiRequests" | "tokens" | "models"> {
  const byAgent: Record<string, Tokens> = {};
  const invocations: Record<string, number> = {};
  let complete = true;
  for (const call of calls) {
    const agent = call.promptVersion.split("/")[0] ?? call.promptVersion;
    invocations[agent] = (invocations[agent] ?? 0) + 1;
    if (call.inputTokens === null || call.outputTokens === null) complete = false;
    add(byAgent, agent, call.inputTokens ?? 0, call.outputTokens ?? 0);
  }
  const totals = Object.values(byAgent).reduce((sum, t) => ({ input: sum.input + t.input, output: sum.output + t.output }), {
    input: 0,
    output: 0,
  });
  return {
    invocations,
    apiRequests: calls.length,
    tokens: calls.length > 0 && complete ? { ...totals, byAgent } : null,
    models: [...new Set(calls.map((call) => call.model))],
  };
}

function fromTranscript(lines: TranscriptLine[]): Pick<LabMetrics, "invocations" | "apiRequests" | "tokens" | "models" | "efforts"> {
  const byAgent: Record<string, Tokens> = {};
  const invocations: Record<string, number> = {};
  let requests = 0;
  for (const line of lines) {
    if (line.role === "user" && line.text !== "" && !line.text.startsWith("[result]")) {
      invocations[line.agent] = (invocations[line.agent] ?? 0) + 1;
    }
    if (line.usage !== null) {
      requests += 1;
      add(byAgent, line.agent, line.usage.input, line.usage.output);
    }
  }
  const totals = Object.values(byAgent).reduce((sum, t) => ({ input: sum.input + t.input, output: sum.output + t.output }), {
    input: 0,
    output: 0,
  });
  return {
    invocations,
    apiRequests: requests,
    tokens: requests > 0 ? { ...totals, byAgent } : null,
    models: [...new Set(lines.flatMap((line) => (line.model ? [line.model] : [])))],
    efforts: [...new Set(lines.flatMap((line) => (line.effort ? [line.effort] : [])))],
  };
}

export async function labReport(env: LabEnv, runId: string): Promise<LabMetrics> {
  const run = await readRun(env.root, runId);
  const questions = await readJson<unknown[]>(env.root, runId, "questions.json");
  const firstPlan = await readJson<CheckRecord>(env.root, runId, "checks.plan.1.json");
  const firstShots = await readJson<CheckRecord>(env.root, runId, "checks.shots.1.json");

  const calls = await readCalls(env.root, runId);
  const transcript = await readTranscript(env.root, runId);
  const usage =
    calls.length > 0
      ? { ...fromCalls(calls), efforts: run.arch === "sequential" ? ["high"] : [] }
      : transcript !== null
        ? fromTranscript(transcript)
        : { invocations: {}, apiRequests: null, tokens: null, models: [], efforts: [] };

  const metrics: LabMetrics = {
    runId,
    arch: run.arch,
    status: run.status === "running" ? "abandoned" : run.status,
    reason: run.reason,
    wallSeconds:
      run.finishedAt === null ? null : Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000),
    questionsAsked: questions?.length ?? 0,
    ...usage,
    retries: { director: Math.max(0, run.attempts.plan - 1), cinematographer: Math.max(0, run.attempts.cameras - 1) },
    refusedSaves: run.refusedTotal,
    firstTryPass: { plan: firstPlan?.passed ?? null, shots: firstShots?.passed ?? null },
    rating: run.rating,
  };
  await writeJson(env.root, runId, "metrics.json", metrics);
  return metrics;
}

const show = (value: unknown): string => (value === null || value === undefined ? "not measured" : String(value));
const yesNo = (value: boolean | null): string => (value === null ? "-" : value ? "yes" : "no");

/** Every named run (or every run) side by side, as a markdown table. */
export async function labCompare(env: LabEnv, runIds: string[]): Promise<string> {
  let ids = runIds;
  if (ids.length === 0) {
    try {
      ids = (await readdir(env.root)).filter((name) => !name.startsWith(".")).sort();
    } catch {
      ids = [];
    }
  }
  const rows: string[] = [];
  for (const id of ids) {
    const m = await labReport(env, id);
    const refused = Object.values(m.refusedSaves).reduce((sum, n) => sum + n, 0);
    rows.push(
      `| ${m.runId} | ${m.arch} | ${m.status} | ${show(m.wallSeconds)} | ${m.questionsAsked} | ${m.retries.director} / ${m.retries.cinematographer} | ${refused} | ${yesNo(m.firstTryPass.plan)} / ${yesNo(m.firstTryPass.shots)} | ${show(m.apiRequests)} | ${m.tokens ? `${m.tokens.input} / ${m.tokens.output}` : "not measured"} | ${m.rating ? m.rating.score : "-"} |`,
    );
  }
  return [
    "| Run | Architecture | Status | Seconds | Questions | Retries (Director / Cinematographer) | Refused saves | First-try pass (plan / shots) | API requests | Tokens (in / out) | Rating |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Only `done` is a success. Tokens in include cached input; Claude Code runs include the lead's own prompt and relaying.",
  ].join("\n");
}

export async function labRate(env: LabEnv, runId: string, score: number, note: string): Promise<{ ok: true }> {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new LabError("a rating is a whole number from 1 to 5");
  return withRunLock(env.root, runId, async () => {
    const run = await readRun(env.root, runId);
    await writeRun(env.root, { ...run, rating: { score, note } });
    return { ok: true as const };
  });
}
