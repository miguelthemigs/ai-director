import { randomUUID } from "node:crypto";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport } from "../api/client.js";
import { bandToPercent, isPass } from "../enforce/score.js";
import { loadRubric, type Rubric } from "../rubric/load.js";
import { buildRetryVerbatim } from "../orchestrate/coach.js";
import type { PassResult } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileRunStore } from "../store/FileRunStore.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { loadGrounding } from "../avatar/grounding.js";

const RUNS_DIR = "data/runs";
const AVATARS_DIR = "data/avatars";

/**
 * Pure formatter: every one of the rubric's checks prints exactly once, in
 * rubric order, so a check can never silently vanish from the output.
 *
 * - A scored check prints `bandToPercent(band)` -- never a hand-computed
 *   percentage -- plus its quotes, if any.
 * - A `not_evaluated` check has no band and prints as "not evaluated": never
 *   0%, never omitted, never counted as passing.
 * - `unverified` is printed separately and explicitly, never silently
 *   dropped -- these are quotes the model gave that could not be located, so
 *   they were excluded from repair rather than acted on.
 */
export function formatPassResult(result: PassResult, rubric: Rubric): string {
  const lines: string[] = [`Pass ${result.pass}`, ""];

  for (const check of rubric.checks) {
    const scored = result.results.find((r) => r.checkId === check.id);
    if (!scored) {
      lines.push(`  ??  MISSING  ${check.id} - no result was reported for this check`);
      continue;
    }
    if (scored.status === "not_evaluated") {
      lines.push(`  --  ${check.id} - not evaluated - ${scored.reason}`);
      continue;
    }
    const percent = bandToPercent(scored.band);
    const mark = isPass(scored.band) ? "pass" : "FAIL";
    lines.push(`${percent.toString().padStart(4)}%  ${mark}  ${check.id} - ${scored.reason}`);
    for (const quote of scored.quotes) lines.push(`          quote: "${quote}"`);
  }

  if (result.unverified.length > 0) {
    lines.push("", "Unverified quotes (not found verbatim in the description, excluded from repair):");
    for (const item of result.unverified) {
      lines.push(`  ${item.checkId}: unverified quote "${item.quote}" (${item.reason})`);
    }
  }

  return lines.join("\n");
}

// Every terminal status the CLI can print for a whole run. `passed` is the
// only one allowed to read as success -- the other three are failures and
// must never carry a checkmark, "done", "complete", or anything green.
const STATUS_LINE: Record<string, string> = {
  passed: "PASSED",
  improved_still_failing: "FAILED -- improved_still_failing (some fragments got better, but not enough to pass)",
  no_improvement: "FAILED -- no_improvement (nothing improved across all passes)",
  failed: "FAILED -- failed (a run error, not a scoring result -- see the error above)",
};

export async function main(argv: string[]): Promise<number> {
  // A run always starts from an avatar, as it does in the browser: the sheet was rendered
  // or uploaded, the describe step wrote a description off it, and that description is
  // what gets graded. The Repairer is handed the same sheet and brief (prompt v2), so it
  // can only claim what it can see. There is no blind run to ask for.
  const avatarIndex = argv.indexOf("--avatar");
  const avatarId = avatarIndex === -1 ? undefined : argv[avatarIndex + 1];
  if (!avatarId) {
    console.error("usage: npm run score -- --avatar <avatarId>");
    return 1;
  }

  // Read the key at call time, not at import time, so importing this module
  // without one never throws -- and so a missing key fails with a message,
  // never a stack trace, before any file or network I/O is attempted.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Export it before running the scorer, e.g.:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...",
    );
    return 1;
  }

  const avatarStore = new FileAvatarStore(AVATARS_DIR);
  const record = await avatarStore.get(avatarId);
  const grounding = record ? await loadGrounding(avatarStore, avatarId) : null;
  if (!record || !grounding) {
    console.error(`avatar ${avatarId} has no character sheet the Repairer can see in ${AVATARS_DIR}`);
    return 1;
  }
  const description = record.description?.trim();
  if (!description) {
    console.error(`avatar ${avatarId} has not been described yet. Describe it in the app first.`);
    return 1;
  }

  const rubric = await loadRubric("v1");
  const transport = createAnthropicTransport();
  const store = new FileRunStore(RUNS_DIR);
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

  // `runToCompletion` rethrows after marking the run "failed" in the store
  // (Task 9: `finishRun(runId, "failed", passes.length)` happens before the
  // rethrow, precisely so the run is never stranded at "running"). A caught
  // error here therefore always has a correctly-finished manifest on disk --
  // an API rate limit or a malformed retry response mid-run must print that
  // manifest's path and the error's message, never an unhandled rejection's
  // stack trace, and must exit 2 ("ran but did not pass"), not 1 ("usage or
  // config error before any run was attempted") -- a crash mid-run is not a
  // usage error, and conflating the two would make the exit code lie.
  let out: Awaited<ReturnType<typeof runToCompletion>>;
  try {
    out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, { ...args, ...grounding }),
      },
      { rubric, description, runId, repairerPromptVersion: "v2", avatarId },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`run failed: ${message}`);
    console.log(`run: ${RUNS_DIR}/${runId}`);
    return 2;
  }

  for (const pass of out.passes) {
    console.log(formatPassResult(pass, rubric));
    console.log("");
  }

  console.log(STATUS_LINE[out.status] ?? `FAILED -- unrecognized status "${out.status}"`);
  console.log(`run: ${RUNS_DIR}/${runId}`);

  if (out.finalDescription !== description) {
    console.log("\nfinal description:\n" + out.finalDescription);
  }

  return out.status === "passed" ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      // Last resort: nothing above should let a rejection reach here, but if
      // something outside `main`'s own try/catch throws (e.g. before `file`
      // is known), print a message, not a stack trace, and exit 1.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`score: unexpected error: ${message}`);
      process.exit(1);
    });
}
