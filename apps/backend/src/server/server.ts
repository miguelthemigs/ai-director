import { eventId } from "@ai-director/contract";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../agents/evaluator/schema.js";
import { repairSpans } from "../agents/repairer/run.js";
import { DEFAULT_REPAIRER_PROMPT_VERSION } from "../agents/repairer/version.js";
import { statedFactsFor } from "../avatar/statedFacts.js";
import { isSupportedMediaType } from "../describe/describeImage.js";
import { createAnthropicTransport, type ParseTransport } from "../api/client.js";
import { createAnthropicTextTransport } from "../avatar/authorPrompt.js";
import { createGeminiImageTransport } from "../avatar/generateSheet.js";
import { createAnthropicVisionTransport } from "../describe/describeImage.js";
import { driveComparison } from "../compare/runComparison.js";
import { checksForGroup, loadRubric } from "../rubric/load.js";
import { toPassView, toRunView } from "../present/toRunView.js";
import { RunEventBus } from "../orchestrate/events.js";
import type { RetryVerbatimFn } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { FileComparisonStore } from "../store/ComparisonStore.js";
import { FileRunStore } from "../store/FileRunStore.js";
import { FileVersionStore } from "../store/FileVersionStore.js";
import { createOpenRouterVideoTransport } from "../video/openrouterClient.js";
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
const AVATARS_DIR = "data/avatars";
const VERSIONS_DIR = "data/versions";
const COMPARISONS_DIR = "data/comparisons";

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
  // Declared here rather than inside `avatar` below because `startRun` reads it too: it
  // needs the sheet and the brief to run Repairer prompt v2.
  const avatarStore = new FileAvatarStore(AVATARS_DIR);

  // KNOWN GAP, carried into this task's report rather than papered over:
  // no token counts or latency are available anywhere in this pipeline yet
  // -- `ParseTransport` (Task 1) returns only `{ parsed_output }`. `StepCost`
  // is fully optional for exactly this reason (see the contract's own
  // comment on it): omitting every field here is the honest "not measured",
  // never a fabricated `0`.
  const startRun: StartRun = async ({ runId, description, avatarId }) => {
    const transport = createAnthropicTransport();

    // ── What turns the Repairer from blind v1 into sighted v2 ────────────────────────
    // v1 is handed a failing fragment and a band-5 description of what the check wants,
    // and has no way to see the person. It satisfies the check by inventing: on run
    // `bee3bcd6` it wrote shoulder-length hair on a medium-length head, 5 foot 8 on a
    // 1.78m man and a narrow-shouldered build on an average one, and the run terminated
    // `passed`. `docs/repairer-cannot-see.md` has the trace.
    //
    // So when the caller names the avatar this description came from, the sheet and the
    // brief travel with the fragments. Absent an avatar — a description typed into the
    // textarea, the CLI, every run made before today — the Repairer stays blind and the
    // run records `v1`, which is the honest label for what actually ran.
    const sheet = avatarId ? await avatarStore.readImage(avatarId) : null;
    const record = avatarId ? await avatarStore.get(avatarId) : null;
    const grounding =
      sheet && isSupportedMediaType(sheet.mediaType)
        ? {
            sheet: { imageBase64: sheet.bytes.toString("base64"), mediaType: sheet.mediaType },
            statedFacts: record ? statedFactsFor(record) : null,
          }
        : null;

    const out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, { ...args, ...(grounding ?? {}) }),
        emit: (event) => bus.publish(runId, event),
      },
      {
        rubric,
        description,
        runId,
        repairerPromptVersion: grounding ? "v2" : DEFAULT_REPAIRER_PROMPT_VERSION,
      },
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

  // The Mentic-pipeline transports, each wired only when its key is actually present.
  //
  // A missing key is a real state, not a misconfiguration to crash on. A server with no
  // GOOGLE_AI_KEY grades descriptions perfectly well and simply cannot render a sheet,
  // and `/avatar/sheet` answers 503 saying so. Building the transport regardless and
  // letting it fail at call time would turn a known, explainable limit into a provider
  // error surfacing three layers down, after the user had already typed a description.
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGoogle = Boolean(process.env.GOOGLE_AI_KEY ?? process.env.GOOGLE_API_KEY);
  const avatar = {
    // The store is always wired, with or without provider keys: an avatar rendered on a
    // previous run is still worth listing and serving today.
    store: avatarStore,
    ...(hasAnthropic ? { text: createAnthropicTextTransport() } : {}),
    ...(hasAnthropic ? { vision: createAnthropicVisionTransport() } : {}),
    ...(hasGoogle ? { image: createGeminiImageTransport() } : {}),
  };

  // The video comparison. Same shape as `avatar` above and for the same reason: the store
  // is always wired, because a pair rendered last week is still worth listing and playing
  // today, while the transport exists only when a key does.
  const comparisonStore = new FileComparisonStore(COMPARISONS_DIR);
  const videoTransport = process.env.OPENROUTER_API_KEY
    ? createOpenRouterVideoTransport()
    : undefined;

  // Assigned immediately below. The `drive` closure reads it lazily rather than closing
  // over a value that does not exist yet: `buildApp` needs `compare`, and `compare` needs
  // somewhere to log a failed drive. The closure only ever runs from inside a request,
  // long after the assignment.
  let app: ReturnType<typeof buildApp>;

  const compare = {
    store: comparisonStore,
    runStore: store,
    avatarStore: avatar.store,
    ...(videoTransport
      ? {
          transport: videoTransport,
          drive: (comparisonId: string) => {
            // Unawaited by design, like `startRun`. `driveComparison` records every
            // outcome on the row, so a rejection here has already been written down;
            // logging it is all that is left to do with it.
            void driveComparison(
              { store: comparisonStore, transport: videoTransport },
              comparisonId,
            ).catch((err: unknown) => {
              app.log.error({ err, comparisonId }, "comparison drive failed");
            });
          },
        }
      : {}),
  };

  app = buildApp({ store, rubric, startRun, bus, versionStore, avatar, compare, logger: true });

  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`server: failed to start: ${message}`);
  process.exit(1);
});
