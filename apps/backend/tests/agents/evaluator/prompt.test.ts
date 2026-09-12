import { describe, expect, it } from "vitest";
import {
  buildEvaluatorSystemPrompt,
  buildVerbatimRetryPrompt,
} from "../../../src/agents/evaluator/prompt.js";
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

describe("verbatim retry prompt", () => {
  it("instructs the model to quote only text that appears verbatim in the description", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildVerbatimRetryPrompt(rubric, "safety");
    expect(prompt).toMatch(/quote (only )?.*verbatim|verbatim.*quote/i);
    expect(prompt).toMatch(/exactly/i);
  });

  it("still contains only its own group's check ids", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildVerbatimRetryPrompt(rubric, "safety");
    expect(prompt).toContain("no_real_person");
    expect(prompt).toContain("no_brand_name");
    expect(prompt).not.toContain("hair_spec");
    expect(prompt).not.toContain("drawable_only");
  });

  it("is the group's normal prompt plus the retry instruction, not a replacement for it", async () => {
    const rubric = await loadRubric("v1");
    const normal = buildEvaluatorSystemPrompt(rubric, "look");
    const retry = buildVerbatimRetryPrompt(rubric, "look");
    expect(retry).toContain(normal);
    expect(retry.length).toBeGreaterThan(normal.length);
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

  // The schema validates structure only. A failing band (< 4) with empty quotes is
  // structurally well-formed and parses successfully here; the quotes-required-below-4
  // rule is enforced per check, in code, by Task 6's `evaluateGroup` — not by this schema.
  it("parses a failing band with empty quotes (schema is structural only)", () => {
    const parsed = EvaluatorGroupOutputSchema.parse({
      results: [{ checkId: "wardrobe", band: 3, reason: "Footwear missing.", quotes: [] }],
    });
    expect(parsed.results[0]!.band).toBe(3);
    expect(parsed.results[0]!.quotes).toEqual([]);
  });
});
