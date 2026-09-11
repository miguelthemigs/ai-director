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

// Promise.allSettled, not Promise.all: one group's transport rejecting or
// parsing to null must not lose the other two groups' scores. Each group's
// checks land as "scored" or "not_evaluated" via toEvaluatedChecks -- never
// omitted, and never defaulted to a passing band.
export async function evaluateAllGroups(
  deps: { transport: ParseTransport },
  args: { rubric: Rubric; description: string },
): Promise<EvaluatedCheck[]> {
  const [lookResult, safetyResult, drawableResult] = await Promise.allSettled([
    evaluateGroup(deps, { ...args, group: "look" }),
    evaluateGroup(deps, { ...args, group: "safety" }),
    evaluateGroup(deps, { ...args, group: "drawable" }),
  ]);

  return [
    ...toEvaluatedChecks(args.rubric, "look", lookResult),
    ...toEvaluatedChecks(args.rubric, "safety", safetyResult),
    ...toEvaluatedChecks(args.rubric, "drawable", drawableResult),
  ];
}
