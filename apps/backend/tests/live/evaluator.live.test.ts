import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { evaluateAllGroups } from "../../src/agents/evaluator/run.js";
import { buildEvaluatorSystemPrompt } from "../../src/agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../../src/agents/evaluator/schema.js";
import { createAnthropicTransport } from "../../src/api/client.js";
import { isPass } from "../../src/enforce/score.js";
import { loadRubric } from "../../src/rubric/load.js";

const live = process.env.RUN_LIVE_API === "1";

// Generous timeout: this is a real network call to the real model, not a
// fixture. `describe.skipIf(!live)` means every `it` below only ever runs
// when a human has opted in with RUN_LIVE_API=1 -- vitest still reports the
// suite as green with these skipped, which is what `npm test` must show
// without ever touching the network.
describe.skipIf(!live)("evaluator against the real API", () => {
  // Carried in from Task 6's review: `evaluateGroup`/`evaluateAllGroups`
  // pass the non-beta `zodOutputFormat()` helper to `client.beta.messages.parse`.
  // That combination was justified only by a structural-typing argument
  // confirmed by `tsc`, never by a real call -- no unit test can touch the
  // network, so nothing has ever exercised it before this test runs. If this
  // assertion fails, it means the helper's JSON Schema output and the beta
  // `parse` endpoint are NOT runtime-compatible despite type-checking clean:
  // that is a Task 6 defect (the transport itself), not something to loosen
  // here or paper over in this test.
  it("client.beta.messages.parse returns a non-null, correctly-shaped parsed_output for zodOutputFormat()'s schema", async () => {
    const rubric = await loadRubric("v1");
    const transport = createAnthropicTransport();
    const system = buildEvaluatorSystemPrompt(rubric, "drawable");
    const { parsed_output } = await transport({
      system,
      user:
        "Character description to score:\n\n" +
        "A lean man, late 20s, with a very cinematic presence and moody, heartbroken eyes.",
      schema: EvaluatorGroupOutputSchema,
    });

    expect(
      parsed_output,
      "parsed_output came back null/undefined from client.beta.messages.parse. This means " +
        "the non-beta zodOutputFormat() helper is not runtime-compatible with the beta parse " +
        "endpoint -- Task 6's structural-typing justification does not hold against the real " +
        "API. Route this back to Task 6 (apps/backend/src/api/client.ts); do not loosen this " +
        "assertion.",
    ).not.toBeNull();
    expect(parsed_output).not.toBeUndefined();

    const result = EvaluatorGroupOutputSchema.safeParse(parsed_output);
    expect(
      result.success,
      "parsed_output was non-null but did not match EvaluatorGroupOutputSchema " +
        `(${result.success ? "" : JSON.stringify(result.error?.issues)}). This means the shape ` +
        "the beta endpoint actually returned for zodOutputFormat()'s schema diverges from what " +
        "Task 6 assumed -- a Task 6 defect, not a test to loosen.",
    ).toBe(true);
  }, 60_000);

  it("fails the weak description on the checks it should fail", async () => {
    const rubric = await loadRubric("v1");
    const description = (
      await readFile("data/samples/weak-description.txt", "utf8")
    ).trim();
    const results = await evaluateAllGroups(
      { transport: createAnthropicTransport() },
      { rubric, description },
    );
    // A check counts as failing if it scored below the pass band, or was
    // never scored at all -- matching runPass's own `failing` derivation, so
    // this test's notion of "failing" is the same one the product uses.
    const failing = results
      .filter((r) => (r.status === "scored" ? !isPass(r.band) : true))
      .map((r) => r.checkId);
    expect(failing).toContain("drawable_only");
    expect(failing).toContain("no_real_person");
    expect(failing).toContain("no_brand_name");
    expect(failing).toContain("no_cross_slot");
    for (const result of results.filter((r) => r.status === "scored" && !isPass(r.band))) {
      if (result.status !== "scored") continue;
      expect(result.quotes.length).toBeGreaterThan(0);
      for (const quote of result.quotes) expect(description).toContain(quote);
    }
  }, 120_000);

  it("passes the strong description on the look checks", async () => {
    const rubric = await loadRubric("v1");
    const description = (
      await readFile("data/samples/strong-description.txt", "utf8")
    ).trim();
    const results = await evaluateAllGroups(
      { transport: createAnthropicTransport() },
      { rubric, description },
    );
    const look = ["age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker"];
    for (const id of look) {
      const result = results.find((r) => r.checkId === id);
      expect(result?.status).toBe("scored");
      expect(result?.status === "scored" && isPass(result.band)).toBe(true);
    }
  }, 120_000);
});
