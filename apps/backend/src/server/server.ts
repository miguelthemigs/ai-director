import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../agents/evaluator/schema.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport, type ParseTransport } from "../api/client.js";
import { checksForGroup, loadRubric } from "../rubric/load.js";
import { toPassView, toRunView } from "../present/toRunView.js";
import type { RetryVerbatimFn } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileRunStore } from "../store/FileRunStore.js";
import { buildApp } from "./app.js";
import type { StartRun } from "./routes/runs.js";

// Loads .env into process.env if present. Optional -- a deployment that
// injects real environment variables (no .env file on disk) must not fail
// to start over this.
try {
  process.loadEnvFile();
} catch {
  // no .env file; environment variables are expected to be set some other way
}

const RUNS_DIR = "data/runs";

/**
 * Duplicated from `cli/score.ts`'s private `buildRetryVerbatim` rather than
 * imported: this task's file scope is `present/*` and `server/*` only (a
 * concurrent fix is landing elsewhere in the tree), so touching `cli/score.ts`
 * to export it was out of bounds. Same contract: re-asks one group with an
 * instruction to quote the description verbatim, validates the returned
 * checkIds against the rubric, and throws on a malformed or missing response
 * (a retry failure fails the run as "failed" rather than quietly degrading
 * one group to "not_evaluated" -- see `runPass`'s doc comment on
 * `RetryVerbatimFn`).
 */
function buildRetryVerbatim(transport: ParseTransport): RetryVerbatimFn {
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

async function main(): Promise<void> {
  const rubric = await loadRubric("v1");
  const store = new FileRunStore(RUNS_DIR);

  // KNOWN GAPS, carried into this task's report rather than papered over:
  //
  // 1. Cost is always zero. `ParseTransport` (Task 1) returns only
  //    `{ parsed_output }` -- no token counts, no latency -- so there is
  //    nothing real to sum here yet. `StepCost` fields are honest zeros, not
  //    a fabricated estimate.
  // 2. `replacements` is always `[]`. `PassResult` (Task 9) does not retain
  //    the Repairer's replacements, only the text they produced
  //    (`repairedDescription`) and the ones that failed (`rejected`) -- see
  //    `present/toRunView.ts`'s `PresentedReplacement` comment. The Run
  //    screen's diff view will show no fragments until a future task
  //    threads real replacements through `PassResult` (or a sibling
  //    channel) to this call site.
  const startRun: StartRun = async ({ runId, description }) => {
    const transport = createAnthropicTransport();
    const out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, args),
      },
      { rubric, description, runId },
    );

    const manifest = await store.getRun(runId);
    const passes = out.passes.map((pass) => toPassView(pass, []));
    const zeroCost = { inputTokens: 0, outputTokens: 0, usd: 0, latencyMs: 0 };
    return toRunView(manifest, passes, description, out.finalDescription, zeroCost);
  };

  const app = buildApp({ store, rubric, startRun });

  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`server: failed to start: ${message}`);
  process.exit(1);
});
