import type { EvaluatedCheck, GroupEventSink } from "../agents/evaluator/run.js";
import type { RejectedReplacement, RepairedReplacement } from "../agents/repairer/run.js";
import { hasNegativeConstraint } from "../enforce/invariants.js";
import { isPass } from "../enforce/score.js";
import { applyReplacements } from "../enforce/splice.js";
import { verifySpans, type Span, type UnverifiedQuote } from "../enforce/verifySpans.js";
import type { CheckGroup, Rubric, RubricCheck } from "../rubric/load.js";

export type PassResult = {
  pass: number;
  description: string;
  results: EvaluatedCheck[];
  // The gate for a terminal `passed`: every check scored below band 4, plus
  // every check that was never scored at all. A not_evaluated check has no
  // band and must never be treated as passing, so it is folded in here.
  failing: string[];
  // A display-only breakdown of `failing`, so a presenter can render "N below
  // band 4" honestly instead of conflating it with "N never scored" (design
  // doc §6.2 binds the banner numeral to checks below band 4 specifically).
  notEvaluated: string[];
  spans: Span[];
  unverified: UnverifiedQuote[];
  negativeConstraintPresent: boolean;
  repairedDescription?: string;
  // The replacements that were actually spliced into `repairedDescription`,
  // rationale included. Always [] on the final pass (never calls the
  // Repairer) and [] on any pass where nothing was repaired. This is what a
  // presenter needs to build the Run screen's fragment diff -- without it,
  // every real run would render as if nothing had ever been repaired, even
  // when it had.
  replacements: RepairedReplacement[];
  // Replacements the Repairer returned that could not be applied. Surfaced
  // here (and written through the store by the caller) rather than logged,
  // so an invented spanId or empty replacement leaves a trace the CLI/UI can
  // show -- a console line reaches none of them. Always [] on the final
  // pass, since the final pass never calls the Repairer.
  rejected: RejectedReplacement[];
};

export type EvaluateFn = (args: {
  rubric: Rubric;
  description: string;
  // Optional: a caller wiring up the run event bus (Task 18) passes this
  // through to `evaluateAllGroups` so it can emit `evaluator.group.*`
  // progress events as the three concurrent group calls are issued and
  // settle. Absent, `evaluate` behaves exactly as it always did -- this is
  // how the CLI (no bus) is unaffected.
  onGroupEvent?: GroupEventSink;
}) => Promise<EvaluatedCheck[]>;

/**
 * Spec §5's quote-exactly retry: re-asks one group only, with an instruction
 * to quote the description verbatim. `runPass` calls this at most once per
 * group per pass, and only for a group that had a quote fail verification the
 * first time. Returns that group's checks only -- the same contract as
 * Task 6's `evaluateGroup`, since a retry is a full re-ask of the group, not
 * of one check in isolation (the group call is the unit the transport is
 * made at, per the design doc's "three calls per pass, one per group").
 */
export type RetryVerbatimFn = (args: {
  rubric: Rubric;
  description: string;
  group: CheckGroup;
}) => Promise<EvaluatedCheck[]>;

export type RepairFn = (args: {
  spans: Span[];
  checks: RubricCheck[];
  reasons: Record<string, string>;
}) => Promise<{ replacements: RepairedReplacement[]; rejected: RejectedReplacement[] }>;

type ScoredCheck = Extract<EvaluatedCheck, { status: "scored" }>;

function isScored(check: EvaluatedCheck): check is ScoredCheck {
  return check.status === "scored";
}

function groupOf(rubric: Rubric, checkId: string): CheckGroup {
  const check = rubric.checks.find((c) => c.id === checkId);
  if (!check) throw new Error(`runPass: unknown checkId "${checkId}"`);
  return check.group;
}

// Lower number wins a collision. Safety first: those checks exist so the
// model does not refuse the prompt, which is the product's reason to exist.
const GROUP_PRIORITY: Record<CheckGroup, number> = { safety: 0, drawable: 1, look: 2 };

/**
 * verifySpans returns every individually-verifiable span, including spans
 * that nest across checks -- two checks can legitimately quote overlapping
 * text ("Nike hoodie" for wardrobe, "Nike" for no_brand_name). Task 4's
 * `applyReplacements` refuses to splice two overlapping replacements, so a
 * maximal non-overlapping subset must be chosen before spans go to the
 * Repairer.
 *
 * Order: safety group first, then drawable, then look. Within a group, the
 * longer span wins (it carries more context for the Repairer). The final
 * tiebreak is the lower start offset, so the choice is deterministic.
 *
 * A span that loses is not returned here, but the caller must not discard it
 * or mark it unverified -- it stays a verified span for this pass and is
 * simply not repaired; a later pass re-quotes it if it is still wrong.
 */
export function selectNonOverlapping(rubric: Rubric, spans: Span[]): Span[] {
  const ordered = [...spans].sort((a, b) => {
    const groupDiff =
      GROUP_PRIORITY[groupOf(rubric, a.checkId)] - GROUP_PRIORITY[groupOf(rubric, b.checkId)];
    if (groupDiff !== 0) return groupDiff;
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.start - b.start;
  });

  const selected: Span[] = [];
  for (const span of ordered) {
    const overlaps = selected.some((s) => span.start < s.end && s.start < span.end);
    if (!overlaps) selected.push(span);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function quotesFromFailing(results: EvaluatedCheck[]): Array<{ checkId: string; quote: string }> {
  return results
    .filter(isScored)
    .filter((r) => !isPass(r.band))
    .flatMap((r) => r.quotes.map((quote) => ({ checkId: r.checkId, quote })));
}

// Splices a group's freshly re-asked checks into the pass's running result
// set, replacing whatever that group previously held (a retry is a full
// re-ask of the group, so its old entries are superseded, not merged).
function mergeGroupResults(
  results: EvaluatedCheck[],
  retried: EvaluatedCheck[],
): EvaluatedCheck[] {
  const retriedIds = new Set(retried.map((r) => r.checkId));
  return results.filter((r) => !retriedIds.has(r.checkId)).concat(retried);
}

export async function runPass(
  deps: { evaluate: EvaluateFn; retryVerbatim: RetryVerbatimFn; repair: RepairFn },
  args: {
    rubric: Rubric;
    description: string;
    pass: number;
    isFinalPass: boolean;
    onGroupEvent?: GroupEventSink;
  },
): Promise<PassResult> {
  const { rubric, description, pass, isFinalPass, onGroupEvent } = args;

  let results = await deps.evaluate({ rubric, description, onGroupEvent });
  let verified = verifySpans(description, quotesFromFailing(results));

  // Exactly one retry, scoped to whichever groups had a quote fail
  // verification -- never a loop, since a model that cannot quote would
  // otherwise burn tokens indefinitely. The unverified count left after this
  // is itself the prompt-tuning signal the spec asks for.
  if (verified.unverified.length > 0) {
    const groupsNeedingRetry = new Set(verified.unverified.map((u) => groupOf(rubric, u.checkId)));
    for (const group of groupsNeedingRetry) {
      const retried = await deps.retryVerbatim({ rubric, description, group });
      results = mergeGroupResults(results, retried);
    }
    verified = verifySpans(description, quotesFromFailing(results));
  }

  const { spans, unverified } = verified;

  // A not_evaluated check has no band and is neither passing nor failing --
  // it has no result. It must never be counted as passing, so it is folded
  // into `failing` here rather than silently dropped.
  const notEvaluated = results.filter((r) => r.status === "not_evaluated").map((r) => r.checkId);
  const failing = results
    .filter((r) => (isScored(r) ? !isPass(r.band) : true))
    .map((r) => r.checkId);

  const base: PassResult = {
    pass,
    description,
    results,
    failing,
    notEvaluated,
    spans,
    unverified,
    negativeConstraintPresent: hasNegativeConstraint(description),
    replacements: [],
    rejected: [],
  };

  // The final pass evaluates and stops. Repairing here would hand back text
  // nothing ever scored, while the pass results describe different text --
  // `finalDescription` must always be exactly what the last scores describe.
  if (isFinalPass) return base;

  const selected = selectNonOverlapping(rubric, spans);
  if (selected.length === 0) return base;

  const failingByCheckId = new Map(
    results.filter(isScored).filter((r) => !isPass(r.band)).map((r) => [r.checkId, r] as const),
  );
  const reasons: Record<string, string> = {};
  for (const span of selected) {
    const result = failingByCheckId.get(span.checkId);
    if (result) reasons[span.spanId] = result.reason;
  }
  const checks = rubric.checks.filter((c) => selected.some((s) => s.checkId === c.id));

  const { replacements, rejected } = await deps.repair({ spans: selected, checks, reasons });
  if (replacements.length === 0) return { ...base, rejected };

  return {
    ...base,
    rejected,
    // Every item in `replacements` was validated against `selected`'s spanIds
    // by `repairSpans` already, and `applyReplacements` just spliced all of
    // them in -- so this is exactly the set that was actually applied.
    replacements,
    repairedDescription: applyReplacements(description, selected, replacements),
  };
}
