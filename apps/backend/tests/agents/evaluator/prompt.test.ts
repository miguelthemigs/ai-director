import { describe, expect, it } from "vitest";
import { buildEvaluatorSystemPrompt } from "../../../src/agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../../../src/agents/evaluator/schema.js";
import { loadRubric } from "../../../src/rubric/load.js";

describe("evaluator prompt", () => {
  it("includes only the checks of the requested group", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "safety");
    expect(prompt).toContain("no_real_person");
    expect(prompt).toContain("no_brand_name");
    expect(prompt).not.toContain("hair_spec");
  });

  it("states the verbatim-quote rule and the no-rewrite rule", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "look");
    expect(prompt).toMatch(/copied character for character/i);
    expect(prompt).toMatch(/never rewrite/i);
  });

  it("prints every band definition so the score has an anchor", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "drawable");
    expect(prompt).toContain("Band 1:");
    expect(prompt).toContain("Band 5:");
  });
});

describe("evaluator schema", () => {
  it("accepts a well-formed group result", () => {
    const parsed = EvaluatorGroupOutputSchema.parse({
      results: [{ checkId: "no_brand_name", band: 5, reason: "No brand appears.", quotes: [] }],
    });
    expect(parsed.results[0]!.band).toBe(5);
  });

  it("rejects a band outside 1 to 5", () => {
    expect(() =>
      EvaluatorGroupOutputSchema.parse({
        results: [{ checkId: "x", band: 7, reason: "r", quotes: [] }],
      }),
    ).toThrow();
  });
});
