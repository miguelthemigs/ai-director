import { createInterface } from "node:readline/promises";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isValidVideoSeconds,
  VIDEO_SIZES,
  type VideoSize,
} from "@ai-director/contract";
import { readComparisonSources } from "../compare/readSources.js";
import { driveComparison, startComparison } from "../compare/runComparison.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { FileComparisonStore } from "../store/ComparisonStore.js";
import { FileRunStore } from "../store/FileRunStore.js";
import {
  createOpenRouterVideoTransport,
  openrouterContentUrl,
  submitProvablyUnbilled,
} from "../video/openrouterClient.js";

/**
 * One real pair, from the command line.
 *
 * ── Gated twice, on purpose ─────────────────────────────────────────────────────────
 * `RUN_LIVE_API=1` AND `OPENROUTER_API_KEY`, exactly as `cli/bias.ts` is gated and for the
 * reason the decision log gives: so it cannot run by accident. Then a typed confirmation,
 * because this one spends about $0.82 rather than reading a file.
 *
 * ── Who runs it ─────────────────────────────────────────────────────────────────────
 * The owner. The standing instruction in this project is that paid calls are the owner's
 * to make; the agent that wrote this file proved it with `--dry-run` and stopped.
 *
 * ── --dry-run ───────────────────────────────────────────────────────────────────────
 * Resolves the two descriptions, prints the estimate, and exits without calling
 * OpenRouter. This is what proves the CLI works before the real one is run.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file; environment variables are expected to be set some other way.
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

async function main(): Promise<void> {
  const avatarId = arg("avatar");
  const runId = arg("run");
  const dryRun = process.argv.includes("--dry-run");
  const seconds = Number(arg("seconds") ?? DEFAULT_VIDEO_SECONDS);
  const size = (arg("size") ?? DEFAULT_VIDEO_SIZE) as VideoSize;

  if (!avatarId || !runId) {
    throw new Error(
      "usage: npm run compare -- --avatar <avatarId> --run <runId> [--seconds 4] [--size 480x854] [--dry-run]",
    );
  }
  if (!isValidVideoSeconds(seconds)) throw new Error(`seconds must be a whole number 4..30`);
  if (!(VIDEO_SIZES as readonly string[]).includes(size)) {
    throw new Error(`size must be one of ${VIDEO_SIZES.join(", ")}`);
  }

  const sources = await readComparisonSources(
    { runStore: new FileRunStore("data/runs"), avatarStore: new FileAvatarStore("data/avatars") },
    { runId, avatarId },
  );
  if (!sources.ok) throw new Error(sources.reason);

  const perClip = estimateMicroUsd(size, seconds);
  console.log(`before: ${sources.sources.before.description}`);
  console.log(`after:  ${sources.sources.after.description}`);
  console.log(`\n${size} x ${seconds}s, two clips: about ${usd(perClip * 2)} in total.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing was submitted and nothing was billed.");
    return;
  }

  if (process.env.RUN_LIVE_API !== "1") {
    throw new Error("refusing to spend: set RUN_LIVE_API=1 to make real renders");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("refusing to spend: OPENROUTER_API_KEY is not set");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Submit two paid renders for ${usd(perClip * 2)}? type yes: `);
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("nothing submitted.");
    return;
  }

  const store = new FileComparisonStore("data/comparisons");
  const transport = createOpenRouterVideoTransport();
  const created = await startComparison(
    { store, transport },
    {
      avatarId,
      runId,
      seconds,
      size,
      rubricVersion: sources.rubricVersion,
      repairerPromptVersion: sources.repairerPromptVersion,
      sources: sources.sources,
    },
  );
  console.log(`comparison ${created.comparisonId}, polling...`);

  const done = await driveComparison({ store, transport }, created.comparisonId);

  for (const side of ["before", "after"] as const) {
    const render = done[side];
    console.log(
      `\n${side}: ${render.status}` +
        `\n  task    ${render.taskId ?? "none"}` +
        `\n  content ${render.taskId ? openrouterContentUrl(render.taskId) : "none"}` +
        `\n  clip    ${render.clipUrl ?? "not downloaded"}` +
        `\n  polls   ${render.polls}` +
        `\n  est     ${usd(render.estimatedMicroUsd)}` +
        `\n  billed  ${render.actualMicroUsd === null ? "not reported" : usd(render.actualMicroUsd)}` +
        (render.failure ? `\n  failure ${render.failureCode}: ${render.failure}` : ""),
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Whether a failed submit can safely be retried anywhere is a money question, so it is
  // printed rather than inferred by whoever reads the error.
  const safe = submitProvablyUnbilled(err);
  console.error(`compare: ${message}`);
  console.error(
    safe
      ? "nothing was billed by this failure."
      : "this failure MAY have been billed; do not resubmit.",
  );
  process.exit(1);
});
