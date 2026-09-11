import type { EvaluatedCheck } from "../agents/evaluator/run.js";
import type { Rubric } from "../rubric/load.js";
import type { RunStatus, RunStore } from "../store/RunStore.js";
import {
  runPass,
  type EvaluateFn,
  type PassResult,
  type RepairFn,
  type RetryVerbatimFn,
} from "./runPass.js";

export const MAX_PASSES = 3;
export const MODEL = "claude-opus-5";

type ScoredCheck = Extract<EvaluatedCheck, { status: "scored" }>;

// improved_still_failing vs. no_improvement is judged by whether anything got
// better, not by count alone (design doc §6.2 binds the banner's second line
// to "no fragment improved its band"). A band can rise for one check while
// the failing count stays put -- another check could take its place, or the
// same check could move partway to passing -- so both signals are checked.
function anyBandRose(first: EvaluatedCheck[], last: EvaluatedCheck[]): boolean {
  const firstBands = new Map<string, ScoredCheck["band"]>(
    first.filter((r): r is ScoredCheck => r.status === "scored").map((r) => [r.checkId, r.band]),
  );
  return last.some((r) => {
    if (r.status !== "scored") return false;
    const before = firstBands.get(r.checkId);
    return before !== undefined && r.band > before;
  });
}

/**
 * The three-pass loop. Terminal state is exactly one of `passed`,
 * `improved_still_failing`, `no_improvement`, or `failed` -- the last three
 * are failures, and the UI must never show a success state for them (design
 * doc §5, PRODUCT.md, CLAUDE.md's "rules that are not negotiable" all say the
 * same thing). `passed` requires every check to have scored at or above the
 * pass band -- see `runPass`'s `failing`, which also folds in any
 * `not_evaluated` check, so a run that never got a real score for a check can
 * never terminate as `passed`.
 */
export async function runToCompletion(
  deps: {
    evaluate: EvaluateFn;
    retryVerbatim: RetryVerbatimFn;
    repair: RepairFn;
    store: RunStore;
  },
  args: { rubric: Rubric; description: string; runId: string; maxPasses?: number },
): Promise<{ status: RunStatus; passes: PassResult[]; finalDescription: string }> {
  const { rubric, runId } = args;
  const maxPasses = args.maxPasses ?? MAX_PASSES;

  await deps.store.createRun({
    runId,
    rubricVersion: rubric.version,
    model: MODEL,
    status: "running",
    startedAt: new Date().toISOString(),
    passes: 0,
  });

  const passes: PassResult[] = [];
  let description = args.description;

  try {
    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const isFinalPass = pass === maxPasses;
      const result = await runPass(deps, { rubric, description, pass, isFinalPass });
      passes.push(result);

      await deps.store.writePass(runId, pass, "eval", {
        description: result.description,
        results: result.results,
        failing: result.failing,
        notEvaluated: result.notEvaluated,
        spans: result.spans,
        unverified: result.unverified,
        negativeConstraintPresent: result.negativeConstraintPresent,
      });
      // Written whenever a repair was attempted, even if nothing was
      // applied: a repairer that had every replacement rejected must leave a
      // trace somewhere other than a console line (Task 7's `rejected`).
      if (result.repairedDescription !== undefined || result.rejected.length > 0) {
        await deps.store.writePass(runId, pass, "repair", {
          from: result.description,
          to: result.repairedDescription ?? result.description,
          rejected: result.rejected,
        });
      }

      if (result.failing.length === 0) {
        await deps.store.finishRun(runId, "passed", pass);
        return { status: "passed", passes, finalDescription: description };
      }

      if (result.repairedDescription) {
        description = result.repairedDescription;
        continue;
      }

      // Nothing was repaired this pass. That is genuinely unrepairable only
      // when every check was actually evaluated -- a not_evaluated check
      // means a group call failed, possibly transiently, and produces no
      // unverified quote for the retry to rescue. Give it another pass
      // rather than reporting a false no_improvement off one API error.
      if (result.notEvaluated.length === 0) break;
    }
  } catch (err) {
    await deps.store.finishRun(runId, "failed", passes.length);
    throw err;
  }

  const first = passes[0];
  const last = passes[passes.length - 1];
  if (!first || !last) throw new Error("runToCompletion: no passes were run");

  const status: RunStatus =
    last.failing.length < first.failing.length || anyBandRose(first.results, last.results)
      ? "improved_still_failing"
      : "no_improvement";

  await deps.store.finishRun(runId, status, passes.length);
  return { status, passes, finalDescription: description };
}
