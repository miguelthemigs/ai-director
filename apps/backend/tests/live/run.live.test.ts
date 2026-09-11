import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAllGroups } from "../../src/agents/evaluator/run.js";
import { buildVerbatimRetryPrompt } from "../../src/agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../../src/agents/evaluator/schema.js";
import { repairSpans } from "../../src/agents/repairer/run.js";
import { createAnthropicTransport, type ParseTransport } from "../../src/api/client.js";
import { formatPassResult } from "../../src/cli/score.js";
import { checksForGroup, loadRubric } from "../../src/rubric/load.js";
import type { RetryVerbatimFn } from "../../src/orchestrate/runPass.js";
import { runToCompletion } from "../../src/orchestrate/runToCompletion.js";
import { FileRunStore } from "../../src/store/FileRunStore.js";

const live = process.env.RUN_LIVE_API === "1";

// A description engineered to still fail after three real passes, per Task
// 20's review: it stacks several problems the repairer cannot fix by
// rewriting a fragment in place.
//
// - A named public figure (lookalike framing) and a brand name are both
//   quotable, single-fragment problems -- the repairer can plausibly patch
//   either of those in one pass.
// - But the look checks (age_build, face_skin, hair_spec, anchor_marker) have
//   NO concrete content anywhere in the text -- no age, no build, no named
//   face feature, no hair colour/texture/style, no localized marker. A check
//   that failed with nothing to quote (`missingEvidence`) never gets a span,
//   so `runPass`'s `selectNonOverlapping` never hands the repairer anything
//   for it, and it can never be fixed by repair -- only by re-describing the
//   character from scratch, which this pipeline never does.
// - The rest of the text is pure mood/backstory language with nothing
//   drawable, and a camera/lighting instruction, so drawable_only and
//   no_cross_slot fail too.
//
// The result should never reach "passed": at minimum the look checks above
// have no path to a fix within three passes.
const unrepairableDescription =
  "He carries an old soul, heartbroken and achingly mysterious, the kind of quiet " +
  "devastating charm everyone says belongs to a young Leonardo DiCaprio. He's got his " +
  "lucky Nike hoodie on tonight, shot in moody film-noir lighting with a teal-and-orange " +
  "grade, full of longing and regret.";

const runsDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runsDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Mirrors `buildRetryVerbatim` in `apps/backend/src/cli/score.ts` (not
 * exported from there), so this live test wires the orchestrator exactly the
 * way the real CLI does, rather than through some test-only shortcut.
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

// Every terminal status the CLI actually knows how to render (see
// `STATUS_LINE` in cli/score.ts, not exported). Repeated here only to give
// this test's own assertions a name to check against -- the "no success
// language" assertion below is checked against `formatPassResult`'s output,
// never against this list.
const FAILING_STATUSES = new Set(["improved_still_failing", "no_improvement", "failed"]);

describe.skipIf(!live)("a full run against the real API reads as a failure when it should", () => {
  // Carried in from Task 20's review: the safety-critical rule that
  // `improved_still_failing` and `no_improvement` must never read as success
  // has, until this test, only ever been exercised against fixtures --
  // Task 20's own live run happened to pass on its first try. This is the
  // first time anyone watches a real failing run all the way through, and
  // checks what the screen actually shows for it.
  it("reaches a failing terminal state, and its rendered output never reads as a success", async () => {
    const rubric = await loadRubric("v1");
    const transport = createAnthropicTransport();
    const root = await mkdtemp(path.join(tmpdir(), "runs-live-"));
    runsDirs.push(root);
    const store = new FileRunStore(root);

    const out = await runToCompletion(
      {
        store,
        evaluate: (args) => evaluateAllGroups({ transport }, args),
        retryVerbatim: buildRetryVerbatim(transport),
        repair: (args) => repairSpans({ transport }, args),
      },
      { rubric, description: unrepairableDescription, runId: "live-unrepairable-run" },
    );

    expect(
      out.status,
      `expected a failing terminal state (one of ${[...FAILING_STATUSES].join(", ")}), ` +
        `but the run reported "${out.status}". If this is "passed", the description this test ` +
        "relies on to stay unrepairable turned out to be repairable after all (see the " +
        "comment above unrepairableDescription) -- report the actual per-pass results, don't " +
        "loosen this assertion.",
    ).not.toBe("passed");
    expect(FAILING_STATUSES.has(out.status)).toBe(true);

    // The one claim this test exists to check: what a user would actually
    // see, not the objects underneath it. `formatPassResult` is the CLI's own
    // presenter (apps/backend/src/cli/score.ts) -- rendering every pass
    // through it and inspecting the resulting text is what "checking what a
    // user would see" means here, as opposed to asserting on `out.status` or
    // `out.passes` directly.
    const rendered = out.passes.map((pass) => formatPassResult(pass, rubric)).join("\n\n");

    // No tick glyph of any kind, in any pass's rendered text.
    for (const glyph of ["✓", "✔", "✅"]) {
      expect(
        rendered.includes(glyph),
        `formatPassResult's output contained a success glyph ("${glyph}") for a run that ` +
          `finished as "${out.status}" -- a failing run must never render a checkmark anywhere.`,
      ).toBe(false);
    }

    // No unconditional success language. Lowercase "pass" is legitimate here
    // -- formatPassResult prints it per-check for any individual check that
    // scored at or above the pass band, which can happen even in a failing
    // run -- so this checks for the words a failing run must never use, not
    // for the substring "pass".
    for (const word of ["PASSED", "SUCCESS", "success", "complete", "done"]) {
      expect(
        rendered.includes(word),
        `formatPassResult's output contained "${word}" for a run that finished as ` +
          `"${out.status}" -- that reads as success and must never appear in a failing run's ` +
          "rendered output.",
      ).toBe(false);
    }
  }, 200_000);
});
