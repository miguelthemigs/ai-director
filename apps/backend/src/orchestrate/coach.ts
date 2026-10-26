import type { CharacterOutcome } from "@ai-director/contract";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../agents/evaluator/schema.js";
import { repairSpans } from "../agents/repairer/run.js";
import type { ParseTransport } from "../api/client.js";
import { loadGrounding } from "../avatar/grounding.js";
import { checksForGroup, type Rubric } from "../rubric/load.js";
import type { AvatarStore } from "../store/AvatarStore.js";
import type { RunStore } from "../store/RunStore.js";
import type { EventSink } from "./events.js";
import type { RetryVerbatimFn } from "./runPass.js";
import { runToCompletion } from "./runToCompletion.js";

/**
 * The production `retryVerbatim` dependency. Not folded into `evaluate`
 * (Task 9's review judged the separate seam correct): this asks a different
 * question of a single group -- "quote exactly this time" -- rather than
 * "score every group." It duplicates `evaluateGroup`'s output validation
 * (expected checkIds present, no stray ones) rather than importing it,
 * because that function is hard-wired to the normal prompt; the retry needs
 * the same validation against `buildVerbatimRetryPrompt`'s output instead.
 *
 * Left to throw on a malformed or missing response, same as `evaluateGroup`
 * does -- `runPass` calls this outside any `allSettled`, so a retry failure
 * is meant to fail the run as `failed` rather than quietly degrade one
 * group to `not_evaluated`. Degrading it here would hide a broken retry
 * behind a `no_improvement`/`improved_still_failing` result instead of the
 * distinct `failed` state the store already has for it.
 */
export function buildRetryVerbatim(transport: ParseTransport): RetryVerbatimFn {
  return async ({ rubric, description, group }) => {
    const system = buildVerbatimRetryPrompt(rubric, group);
    const { parsed_output } = await transport({
      system,
      user: `Character description to score:\n\n${description}`,
      schema: EvaluatorGroupOutputSchema,
    });
    if (parsed_output === null || parsed_output === undefined) {
      throw new Error(`verbatim retry parse failed for group ${group}`);
    }
    const output = EvaluatorGroupOutputSchema.parse(parsed_output);

    const expected = new Set(checksForGroup(rubric, group).map((check) => check.id));
    for (const result of output.results) {
      if (!expected.has(result.checkId)) {
        throw new Error(`unexpected checkId ${result.checkId} in group ${group} retry`);
      }
    }
    for (const id of expected) {
      if (!output.results.some((result) => result.checkId === id)) {
        throw new Error(`missing result for ${id} in group ${group} retry`);
      }
    }

    return output.results.map((check) => ({
      status: "scored" as const,
      checkId: check.checkId,
      band: check.band,
      reason: check.reason,
      quotes: check.quotes,
      missingEvidence: check.band < 4 && check.quotes.length === 0,
    }));
  };
}

export type CoachDeps = {
  transport: ParseTransport;
  avatars: AvatarStore;
  runs: RunStore;
  rubric: Rubric;
  emit?: EventSink;
};

/**
 * The Prompt Coach as one callable step: grade and repair a stored avatar's description,
 * the same wiring `server.ts` `startRun` and `cli/score.ts` use (the Repairer always sees
 * the sheet and runs prompt v2). Refuses, rather than falling back to a blind run, when
 * the avatar has no description or no sheet the Repairer can see.
 */
export async function coachDescription(
  deps: CoachDeps,
  args: { avatarId: string; runId: string },
): Promise<CharacterOutcome> {
  const { transport, avatars, runs, rubric, emit } = deps;
  const { avatarId, runId } = args;

  const record = await avatars.get(avatarId);
  const grounding = record ? await loadGrounding(avatars, avatarId) : null;
  if (!record || !grounding) {
    throw new Error(`avatar ${avatarId} has no character sheet the Repairer can see`);
  }
  const description = record.description?.trim();
  if (!description) throw new Error(`avatar ${avatarId} has not been described yet`);

  const out = await runToCompletion(
    {
      store: runs,
      evaluate: (a) => evaluateAllGroups({ transport }, a),
      retryVerbatim: buildRetryVerbatim(transport),
      repair: (a) => repairSpans({ transport }, { ...a, ...grounding }),
      ...(emit ? { emit } : {}),
    },
    { rubric, description, runId, repairerPromptVersion: "v2", avatarId },
  );

  return {
    avatarId,
    coachRunId: runId,
    status: out.status,
    description: out.finalDescription,
    passed: out.status === "passed",
  };
}
