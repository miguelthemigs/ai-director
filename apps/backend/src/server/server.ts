import { eventId } from "@ai-director/contract";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../agents/evaluator/schema.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport, type ParseTransport } from "../api/client.js";
import { checksForGroup, loadRubric } from "../rubric/load.js";
import { toPassView, toRunView } from "../present/toRunView.js";
import { RunEventBus } from "../orchestrate/events.js";
import type { RetryVerbatimFn } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileRunStore } from "../store/FileRunStore.js";
import { FileVersionStore } from "../store/FileVersionStore.js";
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
const VERSIONS_DIR = "data/versions";

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
  const versionStore = new FileVersionStore(VERSIONS_DIR);
  // One bus for the whole process: `startRun` below publishes to it, and
  // `GET /runs/:id/events` (Task 18) subscribes to the very same instance --
  // that sharing is what lets a client watch a run it did not just start.
  const bus = new RunEventBus();

  // KNOWN GAP, carried into this task's report rather than papered over:
  // no token counts or latency are available anywhere in this pipeline yet
  // -- `ParseTransport` (Task 1) returns only `{ parsed_output }`. `StepCost`
  // is fully optional for exactly this reason (see the contract's own
  // comment on it): omitting every field here is the honest "not measured",
  // never a fabricated `0`.
  const startRun: StartRun = async ({ runId, description }) => {
    const transport = createAnthropicTransport();
    const out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, args),
        emit: (event) => bus.publish(runId, event),
      },
      { rubric, description, runId },
    );

    const manifest = await store.getRun(runId);
    const passes = out.passes.map((pass) => toPassView(pass, pass.replacements));
    const unmeasuredCost = {};
    const view = toRunView(manifest, passes, description, out.finalDescription, unmeasuredCost);

    // `runToCompletion` emits every other event itself (including
    // `run.failed`, from its own catch block) but never this one -- it has
    // no access to the presenter, so building the full `RunView` and closing
    // the stream with it is this caller's job. `out.passes.length + 1`
    // continues on from the last pass's own ids without colliding with them,
    // since a successful `runToCompletion` only ever returns once every
    // started pass has also been pushed to `out.passes`.
    bus.publish(runId, {
      id: eventId(out.passes.length + 1, 0),
      name: "run.completed",
      at: new Date().toISOString(),
      status: out.status,
      run: view,
    });

    return view;
  };

  const app = buildApp({ store, rubric, startRun, bus, versionStore });

  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`server: failed to start: ${message}`);
  process.exit(1);
});
