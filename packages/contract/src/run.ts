import type { Band, CheckGroup, CheckId, Percent } from "./checks.js";

/** A verified quote: the model supplied the text, code supplied the offsets. */
export type SpanView = {
  spanId: string;
  checkId: CheckId;
  quote: string;
  start: number;
  end: number;
};

/** A quote the model returned that code could not find verbatim in the description. */
export type UnverifiedQuoteView = {
  checkId: CheckId;
  quote: string;
  reason: "not_found" | "ambiguous";
};

export type CheckResultView = {
  checkId: CheckId;
  group: CheckGroup;
  band: Band;
  /** Always bandToPercent(band). Sent by the server so no client recomputes it. */
  percent: Percent;
  passed: boolean;
  reason: string;
  spans: SpanView[];
  unverified: UnverifiedQuoteView[];
};

/** One fragment the Repairer rewrote, as the Run screen's diff renders it. */
export type ReplacementView = {
  spanId: string;
  checkId: CheckId;
  oldText: string;
  newText: string;
  rationale: string;
};

export type PassView = {
  pass: number;
  description: string;
  results: CheckResultView[];
  failing: CheckId[];
  replacements: ReplacementView[];
  repairedDescription?: string;
};

export const TERMINAL_STATUSES = [
  "passed",
  "improved_still_failing",
  "no_improvement",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type RunStatus = "running" | TerminalStatus | "failed";

export type StepCost = {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  latencyMs: number;
};

export type RunView = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  originalDescription: string;
  finalDescription: string;
  passes: PassView[];
  cost: StepCost;
  /** Present only when status is "failed". */
  error?: string;
};

export function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status) || status === "failed";
}

/**
 * The single source of truth for whether the UI may render a success state.
 * `improved_still_failing` and `no_improvement` are terminal but are NOT success, per spec §5.
 */
export function isSuccess(status: RunStatus): boolean {
  return status === "passed";
}
