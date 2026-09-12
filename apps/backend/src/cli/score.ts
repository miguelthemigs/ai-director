import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../agents/evaluator/schema.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport, type ParseTransport } from "../api/client.js";
import { bandToPercent, isPass } from "../enforce/score.js";
import { checksForGroup, loadRubric, type Rubric } from "../rubric/load.js";
import type { PassResult, RetryVerbatimFn } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileRunStore } from "../store/FileRunStore.js";

const RUNS_DIR = "data/runs";

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
  const file = argv[2];
  if (!file) {
    console.error("usage: npm run score -- <path-to-description.txt>");
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

  const description = (await readFile(file, "utf8")).trim();
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
        repair: (args) => repairSpans({ transport }, args),
      },
      { rubric, description, runId },
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
