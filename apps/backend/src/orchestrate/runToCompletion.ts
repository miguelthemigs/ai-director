import { eventId, type CheckId, type ReplacementView } from "@ai-director/contract";
import type { EvaluatedCheck, GroupEventSink } from "../agents/evaluator/run.js";
import type { RepairedReplacement } from "../agents/repairer/run.js";
import type { Span } from "../enforce/verifySpans.js";
import type { EventSink } from "./events.js";
import { toCheckResultView } from "../present/toRunView.js";
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
 * Hands out ids of the form `<pass>-<step>` (spec §6): step numbers start at
 * 0 and increment within a pass, so calling this repeatedly for the same
 * `pass` walks 0, 1, 2, ... A pseudo-pass of 0 is used for `run.started`
 * (before pass 1 exists) and `passes.length + 1` for the run's closing event,
 * so both sort before/after every real pass's ids under the bus's
 * `<pass>-<step>` ordering.
 */
function makeStepper(): (pass: number) => string {
  const steps = new Map<number, number>();
  return (pass: number) => {
    const step = steps.get(pass) ?? 0;
    steps.set(pass, step + 1);
    return eventId(pass, step);
  };
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Wraps `evaluate` for exactly one pass so the three concurrent group calls
 * it makes surface as `evaluator.group.*` events. `evaluate` itself decides
 * when to call `onGroupEvent` (real settle order, not array order --
 * `evaluateAllGroups` already gets this right); this only translates each
 * call into a wire event with a fresh id.
 *
 * Spans are deliberately not verified here: verification is a pass-wide step
 * that runs once, after every group (and any retry) has settled, so at
 * group-settle time there is nothing honest to put in `spans`/`unverified`
 * yet. Those only arrive verified in the final `run.completed` view --
 * flagged in this task's report as a real gap for a frontend trying to
 * rebuild the coverage gutter progressively.
 */
function wrapEvaluate(
  evaluate: EvaluateFn,
  pass: number,
  emit: EventSink,
  nextId: (pass: number) => string,
): EvaluateFn {
  const onGroupEvent: GroupEventSink = (groupEvent) => {
    if (groupEvent.type === "started") {
      emit({ id: nextId(pass), name: "evaluator.group.started", at: now(), pass, group: groupEvent.group });
      return;
    }
    emit({
      id: nextId(pass),
      name: "evaluator.group.completed",
      at: now(),
      pass,
      group: groupEvent.group,
      results: groupEvent.results.map((check) => toCheckResultView(check, [], [])),
      cost: {},
    });
  };
  return (args) => evaluate({ ...args, onGroupEvent });
}

function toReplacementView(spanById: Map<string, Span>, replacement: RepairedReplacement): ReplacementView {
  const span = spanById.get(replacement.spanId);
  if (!span) {
    // Mirrors the presenter's own invariant (toPassView): a replacement
    // whose spanId has no matching span here is a bug in whatever assembled
    // the call, not something to paper over by dropping it from the event.
    throw new Error(
      `runToCompletion: repairer.completed references unknown spanId "${replacement.spanId}"`,
    );
  }
  return {
    spanId: replacement.spanId,
    checkId: span.checkId as CheckId,
    oldText: span.quote,
    newText: replacement.newText,
    rationale: replacement.rationale,
  };
}

/**
 * Wraps `repair` for exactly one pass so `repairer.started`/`repairer.completed`
 * fire exactly when `runPass` actually calls the repairer -- never on a pass
 * that had nothing to repair, since this wrapper only ever runs around a
 * real call.
 */
function wrapRepair(
  repair: RepairFn,
  pass: number,
  emit: EventSink,
  nextId: (pass: number) => string,
): RepairFn {
  return async (args) => {
    emit({
      id: nextId(pass),
      name: "repairer.started",
      at: now(),
      pass,
      spanIds: args.spans.map((span) => span.spanId),
    });
    const result = await repair(args);
    const spanById = new Map(args.spans.map((span) => [span.spanId, span] as const));
    emit({
      id: nextId(pass),
      name: "repairer.completed",
      at: now(),
      pass,
      replacements: result.replacements.map((r) => toReplacementView(spanById, r)),
      cost: {},
    });
    return result;
  };
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
 *
 * `emit`, when given, publishes progress events for this run (Task 18): once
 * `run.started`, then per pass `pass.started` / `evaluator.group.*` /
 * `repairer.*` / `pass.completed`, and -- only on the throwing path --
 * `run.failed`. It never emits `run.completed`: that needs the full `RunView`,
 * which only exists once the caller has run this function's result through
 * the presenter (`present/toRunView.ts`), so the caller emits it. When `emit`
 * is absent, none of this runs and behaviour is byte-identical to Task 9 --
 * the CLI, which has no bus, is unaffected.
 */
export async function runToCompletion(
  deps: {
    evaluate: EvaluateFn;
    retryVerbatim: RetryVerbatimFn;
    repair: RepairFn;
    store: RunStore;
    emit?: EventSink;
  },
  args: { rubric: Rubric; description: string; runId: string; maxPasses?: number },
): Promise<{ status: RunStatus; passes: PassResult[]; finalDescription: string }> {
  const { rubric, runId } = args;
  const { emit } = deps;
  const maxPasses = args.maxPasses ?? MAX_PASSES;
  const nextId = makeStepper();

  await deps.store.createRun({
    runId,
    rubricVersion: rubric.version,
    model: MODEL,
    status: "running",
    startedAt: new Date().toISOString(),
    passes: 0,
  });

  if (emit) {
    emit({
      id: nextId(0),
      name: "run.started",
      at: now(),
      runId,
      rubricVersion: rubric.version,
      model: MODEL,
      description: args.description,
    });
  }

  const passes: PassResult[] = [];
  let description = args.description;

  try {
    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const isFinalPass = pass === maxPasses;

      if (emit) {
        emit({ id: nextId(pass), name: "pass.started", at: now(), pass, description });
      }

      const passDeps = emit
        ? {
            ...deps,
            evaluate: wrapEvaluate(deps.evaluate, pass, emit, nextId),
            repair: wrapRepair(deps.repair, pass, emit, nextId),
          }
        : deps;

      const result = await runPass(passDeps, { rubric, description, pass, isFinalPass });
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

      if (emit) {
        emit(
          result.repairedDescription !== undefined
            ? {
                id: nextId(pass),
                name: "pass.completed",
                at: now(),
                pass,
                repairedDescription: result.repairedDescription,
                failing: result.failing,
              }
            : { id: nextId(pass), name: "pass.completed", at: now(), pass, failing: result.failing },
        );
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
    if (emit) {
      const message = err instanceof Error ? err.message : String(err);
      // `passes.length + 1` is exactly the pass that was in flight when this
      // threw (it never got pushed), so this continues that pass's own step
      // counter rather than colliding with or preceding events already
      // emitted for it.
      emit({ id: nextId(passes.length + 1), name: "run.failed", at: now(), error: message });
    }
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
