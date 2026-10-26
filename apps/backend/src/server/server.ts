import { resolve } from "node:path";
import { eventId } from "@ai-director/contract";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport } from "../api/client.js";
import { createAnthropicTextTransport } from "../avatar/authorPrompt.js";
import { createGeminiImageTransport } from "../avatar/generateSheet.js";
import { createAnthropicVisionTransport } from "../describe/describeImage.js";
import { driveComparison } from "../compare/runComparison.js";
import { loadRubric } from "../rubric/load.js";
import { toPassView, toRunView } from "../present/toRunView.js";
import { RunEventBus } from "../orchestrate/events.js";
import { buildDirectorAgents } from "../orchestrate/director/agents.js";
import { DirectorEventHub } from "../orchestrate/director/hub.js";
import { buildRecipe } from "../orchestrate/director/recipe.js";
import { createUploadThingHost } from "../images/referenceHost.js";
import { buildRetryVerbatim } from "../orchestrate/coach.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { FileComparisonStore } from "../store/ComparisonStore.js";
import { FileDirectorRunStore } from "../store/FileDirectorRunStore.js";
import { FileRunStore } from "../store/FileRunStore.js";
import { FileVersionStore } from "../store/FileVersionStore.js";
import { createOpenRouterVideoTransport } from "../video/openrouterClient.js";
import { buildApp } from "./app.js";
import { resumeDirectorAfterRestart, type DirectorRouteDeps } from "./routes/director.js";
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
const DIRECTOR_RUNS_DIR = resolve("data/director-runs");

async function main(): Promise<void> {
  const rubric = await loadRubric("v1");
  const store = new FileRunStore(RUNS_DIR);
  const versionStore = new FileVersionStore(VERSIONS_DIR);
  // One bus for the whole process: `startRun` below publishes to it, and
  // `GET /runs/:id/events` (Task 18) subscribes to the very same instance --
  // that sharing is what lets a client watch a run it did not just start.
  const bus = new RunEventBus();
  // Handed to `buildApp` as `avatar.store`, which is also where `POST /runs` reads each
  // run's sheet and brief from before it starts the run.
  const avatarStore = new FileAvatarStore(AVATARS_DIR);

  // KNOWN GAP, carried into this task's report rather than papered over:
  // no token counts or latency are available anywhere in this pipeline yet
  // -- `ParseTransport` (Task 1) returns only `{ parsed_output }`. `StepCost`
  // is fully optional for exactly this reason (see the contract's own
  // comment on it): omitting every field here is the honest "not measured",
  // never a fabricated `0`.
  const startRun: StartRun = async ({ runId, description, avatarId, grounding }) => {
    const transport = createAnthropicTransport();

    // The route has already loaded this avatar's sheet and brief, or refused the run. So
    // the Repairer always sees the person and always runs prompt v2. v1 is still in the
    // tree only so the runs it made can be read and compared (`docs/repairer-cannot-see.md`).
    const out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, { ...args, ...grounding }),
        emit: (event) => bus.publish(runId, event),
      },
      { rubric, description, runId, repairerPromptVersion: "v2", avatarId },
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

  // The AI Director: wired only when all three of its keys are present (each of its agents,
  // pictures and hosted references needs one), and absent is a 503 on every `/director` route.
  // Rendering additionally needs OPENROUTER_API_KEY; without it a run plans but cannot render.
  let director: DirectorRouteDeps | undefined;
  if (hasAnthropic && hasGoogle && process.env.UPLOADTHING_TOKEN) {
    const directorStore = new FileDirectorRunStore(DIRECTOR_RUNS_DIR);
    // One hub: every event the runner and the render append is published to it, and
    // `GET /director/runs/:id/events` subscribes to it.
    const hub = new DirectorEventHub();
    const images = createGeminiImageTransport();
    const agents = buildDirectorAgents({
      transport: createAnthropicTransport(),
      images,
      host: createUploadThingHost(),
      store: directorStore,
      coach: { transport: createAnthropicTransport(), avatars: avatarStore, runs: store, rubric },
      character: {
        text: createAnthropicTextTransport(),
        images,
        vision: createAnthropicVisionTransport(),
        avatars: avatarStore,
      },
    });
    director = {
      runner: { store: directorStore, recipe: buildRecipe(agents), publish: hub.publish },
      store: directorStore,
      video: videoTransport ?? null,
      avatars: avatarStore,
      hub,
    };
  }

  app = buildApp({ store, rubric, startRun, bus, versionStore, avatar, compare, director, logger: true });

  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ port });

  // After `listen`, never before it: a render resume can poll for 15 minutes.
  if (director) {
    resumeDirectorAfterRestart(director, (err, what) => app.log.error({ err }, what));
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`server: failed to start: ${message}`);
  process.exit(1);
});
