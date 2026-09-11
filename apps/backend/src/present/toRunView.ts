import {
  groupOf,
  type CheckId,
  type CheckResultView,
  type Percent,
  type PassView,
  type ReplacementView,
  type RunView,
  type SpanView,
  type StepCost,
  type UnverifiedQuoteView,
} from "@ai-director/contract";
import type { EvaluatedCheck } from "../agents/evaluator/run.js";
import type { Replacement } from "../enforce/splice.js";
import { bandToPercent, isPass } from "../enforce/score.js";
import type { Span, UnverifiedQuote } from "../enforce/verifySpans.js";
import type { PassResult } from "../orchestrate/runPass.js";
import type { RunManifest } from "../store/RunStore.js";

/**
 * `Replacement` (Task 4) is `{spanId, newText}` only -- `splice.ts` never
 * needed the model's rationale, so `repairSpans` (Task 7) does not return it
 * either. The wire's `ReplacementView` needs a rationale for the Run screen's
 * diff, so this presenter accepts the richer shape a caller assembling a real
 * run actually has (the Repairer's raw output, before it is narrowed down to
 * a bare `Replacement`) rather than widening Task 4's type, which would
 * ripple into every existing `Replacement` literal in `splice.ts` and its
 * tests for a field `applyReplacements` never needed.
 */
export type PresentedReplacement = Replacement & { rationale: string };

function toSpanView(span: Span): SpanView {
  return { spanId: span.spanId, checkId: span.checkId as CheckId, quote: span.quote, start: span.start, end: span.end };
}

function toUnverifiedView(quote: UnverifiedQuote): UnverifiedQuoteView {
  return { checkId: quote.checkId as CheckId, quote: quote.quote, reason: quote.reason };
}

/**
 * The only place an `EvaluatedCheck` (engine) becomes a `CheckResultView`
 * (wire). Narrows on `status` rather than reading `band` unconditionally --
 * a `not_evaluated` check has no band to read, and must reach the UI as
 * "not evaluated", never as a placeholder percent.
 */
export function toCheckResultView(
  result: EvaluatedCheck,
  spans: Span[],
  unverified: UnverifiedQuote[],
): CheckResultView {
  const checkId = result.checkId as CheckId;
  const group = groupOf(checkId);

  if (result.status === "not_evaluated") {
    return { status: "not_evaluated", checkId, group, reason: result.reason };
  }

  const band = result.band;
  return {
    status: "scored",
    checkId,
    group,
    band,
    // Always derived from the band in code -- never the model's own words --
    // per bandToPercent's contract.
    percent: bandToPercent(band) as Percent,
    passed: isPass(band),
    reason: result.reason,
    spans: spans.filter((span) => span.checkId === checkId).map(toSpanView),
    unverified: unverified.filter((quote) => quote.checkId === checkId).map(toUnverifiedView),
    missingEvidence: result.missingEvidence,
  };
}

/**
 * Assembles one pass's wire view. `replacements` is supplied separately from
 * `result` because `PassResult` does not retain the Repairer's replacements
 * (only `repairedDescription`, the text they produced, and `rejected`, the
 * ones that failed) -- see the module comment on `PresentedReplacement`.
 *
 * A replacement whose `spanId` has no matching span in `result.spans` is a
 * bug in whatever assembled the call, not a defect to paper over: it throws
 * rather than being silently dropped, because dropping it would show the UI
 * a repair that never happened to have applied.
 */
export function toPassView(result: PassResult, replacements: PresentedReplacement[]): PassView {
  const spanById = new Map(result.spans.map((span) => [span.spanId, span] as const));

  const replacementViews: ReplacementView[] = replacements.map((replacement) => {
    const span = spanById.get(replacement.spanId);
    if (!span) {
      throw new Error(
        `toPassView: replacement references unknown spanId "${replacement.spanId}" -- ` +
          "this replacement was never verified against this pass's spans",
      );
    }
    return {
      spanId: replacement.spanId,
      checkId: span.checkId as CheckId,
      oldText: span.quote,
      newText: replacement.newText,
      rationale: replacement.rationale,
    };
  });

  const view: PassView = {
    pass: result.pass,
    description: result.description,
    results: result.results.map((check) => toCheckResultView(check, result.spans, result.unverified)),
    failing: result.failing.map((id) => id as CheckId),
    replacements: replacementViews,
  };

  return result.repairedDescription !== undefined
    ? { ...view, repairedDescription: result.repairedDescription }
    : view;
}

/**
 * Assembles the full run view from the manifest's own fields, the presented
 * passes, both descriptions and the summed cost. `error` is intentionally
 * left unset here: `RunManifest` does not persist the failure message a
 * failed run raised (see this task's report), so there is nothing honest to
 * put there yet.
 */
export function toRunView(
  manifest: RunManifest,
  passes: PassView[],
  original: string,
  final: string,
  cost: StepCost,
): RunView {
  const view: RunView = {
    runId: manifest.runId,
    rubricVersion: manifest.rubricVersion,
    model: manifest.model,
    status: manifest.status,
    startedAt: manifest.startedAt,
    originalDescription: original,
    finalDescription: final,
    passes,
    cost,
  };

  return manifest.finishedAt !== undefined ? { ...view, finishedAt: manifest.finishedAt } : view;
}
