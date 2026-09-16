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

/**
 * A check as the wire carries it. This is a discriminated union, mirroring the engine's
 * `EvaluatedCheck`, and it is deliberately NOT a flat shape with an optional band.
 *
 * The failure this project fears is a consumer treating an unevaluated check as passing. With a flat
 * optional `band`, a naive read of `passed` compiles fine and goes through undetected. With the union,
 * `band`, `percent` and `passed` exist only inside the `scored` branch, so any code path reading them
 * without narrowing on `status` fails to compile. The engine already has that guarantee; this carries
 * it across the network instead of silently downgrading it.
 */
export type CheckResultView =
  | {
      status: "scored";
      checkId: CheckId;
      group: CheckGroup;
      band: Band;
      /** Always bandToPercent(band). Sent by the server so no client recomputes it. */
      percent: Percent;
      passed: boolean;
      reason: string;
      spans: SpanView[];
      unverified: UnverifiedQuoteView[];
      /** True when the check scored below band 4 but returned no quotes to back it. */
      missingEvidence: boolean;
    }
  | {
      status: "not_evaluated";
      checkId: CheckId;
      group: CheckGroup;
      /** Why the group call failed. Never a band, never a percent. */
      reason: string;
    };

/** Narrows a `CheckResultView` to its `scored` branch, so `.band`/`.percent`/`.passed` are safe to read. */
export function isScoredCheck(
  result: CheckResultView,
): result is Extract<CheckResultView, { status: "scored" }> {
  return result.status === "scored";
}

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

/**
 * Every field is optional, and that is load-bearing. An absent field means "not measured" and the
 * UI renders it as such; a present `0` means a real measurement of zero. A required numeric field
 * cannot express that difference, so an unmeasured run would arrive as a confident `$0.00` -- the
 * exact fabrication the Architecture screen's "not measured" rule (`PipelineNode`'s own optional
 * cost fields) exists to prevent.
 */
export type StepCost = {
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  latencyMs?: number;
};

/**
 * What `GET /runs` can actually answer from a manifest, without reading every pass file. `listRuns`
 * returns these; a full `RunView` requires `GET /runs/:id`.
 */
export type RunSummary = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  passes: number;
  /**
   * Which stored avatar this run graded, when it came from one.
   *
   * Absent for a description typed or pasted by hand, and for every run written before
   * 2026-09-16. The Compare screen filters its run picker on this: a comparison whose
   * "after" came from a different person is worthless, and nothing about it would look
   * wrong on screen.
   */
  avatarId?: string;
  /**
   * Which Repairer prompt repaired it: "v1" blind, "v2" with the character sheet in hand.
   *
   * Absent means the run predates the record, which is a different claim from "v1" and is
   * shown as such. This is the difference between a comparison that tests a repair and one
   * that tests a fabrication — see `docs/repairer-cannot-see.md`.
   */
  repairerPromptVersion?: string;
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
