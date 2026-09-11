import type { ParseTransport } from "../../api/client.js";
import { checksForGroup, type CheckGroup, type Rubric } from "../../rubric/load.js";
import { buildEvaluatorSystemPrompt } from "./prompt.js";
import { type EvaluatorGroupOutput, EvaluatorGroupOutputSchema } from "./schema.js";

export async function evaluateGroup(
  deps: { transport: ParseTransport },
  args: { rubric: Rubric; group: CheckGroup; description: string },
): Promise<EvaluatorGroupOutput> {
  const { rubric, group, description } = args;
  const system = buildEvaluatorSystemPrompt(rubric, group);
  const { parsed_output } = await deps.transport({
    system,
    user: `Character description to score:\n\n${description}`,
    schema: EvaluatorGroupOutputSchema,
  });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error(`evaluator parse failed for group ${group}`);
  }
  const output = EvaluatorGroupOutputSchema.parse(parsed_output);

  const expected = new Set(checksForGroup(rubric, group).map((check) => check.id));
  for (const result of output.results) {
    if (!expected.has(result.checkId)) {
      throw new Error(`unexpected checkId ${result.checkId} in group ${group}`);
    }
  }
  const returned = new Set(output.results.map((result) => result.checkId));
  for (const id of expected) {
    if (!returned.has(id)) throw new Error(`missing result for ${id} in group ${group}`);
  }
  return output;
}

/**
 * The outcome of trying to score one check, after `evaluateAllGroups` has
 * reconciled a group's raw model output (or its absence) against the rubric.
 *
 * - "scored": the model produced a band for this check. `missingEvidence` is
 *   true when the band is below the pass threshold (4) but `quotes` is empty
 *   -- the schema no longer rejects that shape (see schema.ts), because doing
 *   so at parse time turned one bad check into a lost group. A caller must
 *   treat `missingEvidence: true` as unverifiable and exclude it from
 *   automatic repair, without discarding the band or reason.
 * - "not_evaluated": the check's whole group failed -- the transport
 *   rejected, the parse came back null, or the group's output was
 *   structurally broken (wrong or missing checkIds). This is its own state,
 *   distinct from both a pass and a scored failure, so a caller can never
 *   mistake "we never got a score for this" for "it passed."
 */
export type EvaluatedCheck =
  | {
      status: "scored";
      checkId: string;
      band: 1 | 2 | 3 | 4 | 5;
      reason: string;
      quotes: string[];
      missingEvidence: boolean;
    }
  | {
      status: "not_evaluated";
      checkId: string;
      reason: string;
    };

/**
 * Progress signal fired around each group's own call, independent of the
 * other two -- `evaluateAllGroups` issues all three concurrently, so
 * "started" fires for all of them up front (in the fixed order below) and
 * "completed" fires as each one individually settles, which is not
 * necessarily the same order. A caller wiring this to the run event bus
 * (Task 18) relies on that: emitting in array order instead of settle order
 * would misrepresent what the pipeline actually did.
 */
export type GroupEvent =
  | { type: "started"; group: CheckGroup }
  | { type: "completed"; group: CheckGroup; results: EvaluatedCheck[] };
export type GroupEventSink = (event: GroupEvent) => void;

function toEvaluatedChecks(
  rubric: Rubric,
  group: CheckGroup,
  settled: PromiseSettledResult<EvaluatorGroupOutput>,
): EvaluatedCheck[] {
  if (settled.status === "fulfilled") {
    return settled.value.results.map((check) => ({
      status: "scored",
      checkId: check.checkId,
      band: check.band,
      reason: check.reason,
      quotes: check.quotes,
      missingEvidence: check.band < 4 && check.quotes.length === 0,
    }));
  }
  const message = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
  return checksForGroup(rubric, group).map((check) => ({
    status: "not_evaluated",
    checkId: check.id,
    reason: `group ${group} failed to evaluate: ${message}`,
  }));
}

// One group's transport rejecting or parsing to null must not lose the
// other two groups' scores. Each group's checks land as "scored" or
// "not_evaluated" via toEvaluatedChecks -- never omitted, and never
// defaulted to a passing band. `settleOneGroup` never itself rejects (it
// folds a rejection into "not_evaluated" checks via toEvaluatedChecks), so
// Promise.all -- not allSettled -- is enough here, and it still preserves
// [look, safety, drawable] order in its result regardless of which group's
// underlying call actually finishes first.
export async function evaluateAllGroups(
  deps: { transport: ParseTransport },
  args: { rubric: Rubric; description: string; onGroupEvent?: GroupEventSink },
): Promise<EvaluatedCheck[]> {
  const { onGroupEvent } = args;

  function settleOneGroup(group: CheckGroup): Promise<EvaluatedCheck[]> {
    onGroupEvent?.({ type: "started", group });
    return evaluateGroup(deps, { ...args, group }).then(
      (value) => {
        const checks = toEvaluatedChecks(args.rubric, group, { status: "fulfilled", value });
        onGroupEvent?.({ type: "completed", group, results: checks });
        return checks;
      },
      (reason) => {
        const checks = toEvaluatedChecks(args.rubric, group, { status: "rejected", reason });
        onGroupEvent?.({ type: "completed", group, results: checks });
        return checks;
      },
    );
  }

  const [lookChecks, safetyChecks, drawableChecks] = await Promise.all([
    settleOneGroup("look"),
    settleOneGroup("safety"),
    settleOneGroup("drawable"),
  ]);

  return [...lookChecks, ...safetyChecks, ...drawableChecks];
}
