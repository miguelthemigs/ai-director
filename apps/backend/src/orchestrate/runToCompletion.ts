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

/**
 * The three-pass loop. Terminal state is exactly one of `passed`,
 * `improved_still_failing`, or `no_improvement` -- the last two are failures,
 * and the UI must never show a success state for them (design doc §5,
 * PRODUCT.md, CLAUDE.md's "rules that are not negotiable" all say the same
 * thing). `passed` requires every check to have scored at or above the pass
 * band -- see `runPass`'s `failing`, which also folds in any `not_evaluated`
 * check, so a run that never got a real score for a check can never
 * terminate as `passed`.
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
  let firstFailingCount: number | null = null;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const result = await runPass(deps, { rubric, description, pass });
    passes.push(result);

    await deps.store.writePass(runId, pass, "eval", {
      description: result.description,
      results: result.results,
      failing: result.failing,
      spans: result.spans,
      unverified: result.unverified,
      negativeConstraintPresent: result.negativeConstraintPresent,
    });
    if (result.repairedDescription) {
      await deps.store.writePass(runId, pass, "repair", {
        from: result.description,
        to: result.repairedDescription,
      });
    }

    if (firstFailingCount === null) firstFailingCount = result.failing.length;

    if (result.failing.length === 0) {
      await deps.store.finishRun(runId, "passed", pass);
      return { status: "passed", passes, finalDescription: description };
    }

    // Nothing was repaired this pass (no verified spans, or the Repairer
    // returned nothing usable) -- another pass over an unchanged description
    // cannot make progress, so stop rather than burn the remaining passes.
    if (!result.repairedDescription) break;
    description = result.repairedDescription;
  }

  const lastPass = passes[passes.length - 1];
  if (!lastPass) throw new Error("runToCompletion: no passes were run");

  // improved_still_failing vs. no_improvement is a real comparison against
  // the first pass's failing count, not an assumption: the failing set must
  // have strictly shrunk for a run to count as improved.
  const status: RunStatus =
    firstFailingCount !== null && lastPass.failing.length < firstFailingCount
      ? "improved_still_failing"
      : "no_improvement";

  await deps.store.finishRun(runId, status, passes.length);
  return { status, passes, finalDescription: description };
}
