import { describe, expect, it, vi } from "vitest";
import { isScoredCheck, type StepCost } from "@ai-director/contract";
import { toCheckResultView, toPassView, toRunView } from "../../src/present/toRunView.js";
import type { EvaluatedCheck } from "../../src/agents/evaluator/run.js";
import { repairSpans, type RepairedReplacement } from "../../src/agents/repairer/run.js";
import type { Span, UnverifiedQuote } from "../../src/enforce/verifySpans.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { PassResult } from "../../src/orchestrate/runPass.js";
import type { RunManifest } from "../../src/store/RunStore.js";

// The brief's illustrative test snippet predates Task 6's finalized shape:
// `evaluateAllGroups` returns `EvaluatedCheck`, a discriminated union on
// `status`, not the flat `{checkId, band, reason, quotes}` object the brief's
// sample code used. These tests exercise the real, committed engine type.

function scored(overrides: Partial<Extract<EvaluatedCheck, { status: "scored" }>> & { checkId: string }): EvaluatedCheck {
  return {
    status: "scored",
    band: 3,
    reason: "reason",
    quotes: [],
    missingEvidence: false,
    ...overrides,
  };
}

describe("toCheckResultView", () => {
  it("derives percent and passed from the band, never from the model", () => {
    const view = toCheckResultView(
      scored({ checkId: "drawable_only", band: 2, reason: "Mood words.", quotes: ["confident"] }),
      [{ spanId: "drawable_only-0", checkId: "drawable_only", quote: "confident", start: 2, end: 11 }],
      [],
    );
    expect(isScoredCheck(view)).toBe(true);
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.percent).toBe(40);
    expect(view.passed).toBe(false);
    expect(view.group).toBe("drawable");
  });

  it("marks band 4 as passed at 80 percent", () => {
    const view = toCheckResultView(
      scored({ checkId: "wardrobe", band: 4, reason: "Head to toe.", quotes: [] }),
      [],
      [],
    );
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.percent).toBe(80);
    expect(view.passed).toBe(true);
  });

  it("carries unverified quotes through so the UI can show 'fragment not found'", () => {
    const unverified: UnverifiedQuote[] = [
      { checkId: "no_cross_slot", quote: "35mm lens", reason: "not_found" },
    ];
    const view = toCheckResultView(
      scored({ checkId: "no_cross_slot", band: 1, reason: "Camera words.", quotes: [] }),
      [],
      unverified,
    );
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.unverified).toEqual(unverified);
    expect(view.spans).toEqual([]);
  });

  it("only attaches spans belonging to its own check", () => {
    const spans: Span[] = [
      { spanId: "wardrobe-0", checkId: "wardrobe", quote: "Nike hoodie", start: 25, end: 36 },
      { spanId: "no_brand_name-0", checkId: "no_brand_name", quote: "Nike", start: 25, end: 29 },
    ];
    const view = toCheckResultView(
      scored({ checkId: "wardrobe", band: 2, reason: "One garment.", quotes: ["Nike hoodie"] }),
      spans,
      [],
    );
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.spans.map((s) => s.spanId)).toEqual(["wardrobe-0"]);
  });

  it("only attaches unverified quotes belonging to its own check", () => {
    const unverified: UnverifiedQuote[] = [
      { checkId: "no_cross_slot", quote: "35mm lens", reason: "not_found" },
      { checkId: "wardrobe", quote: "a coat", reason: "ambiguous" },
    ];
    const view = toCheckResultView(scored({ checkId: "wardrobe", band: 1 }), [], unverified);
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.unverified).toEqual([{ checkId: "wardrobe", quote: "a coat", reason: "ambiguous" }]);
  });

  it("passes missingEvidence through faithfully", () => {
    const view = toCheckResultView(
      scored({ checkId: "anchor_marker", band: 1, quotes: [], missingEvidence: true }),
      [],
      [],
    );
    if (!isScoredCheck(view)) throw new Error("expected scored");
    expect(view.missingEvidence).toBe(true);
  });

  it("a not_evaluated check survives presentation with no band, no percent, never a placeholder", () => {
    const view = toCheckResultView(
      { status: "not_evaluated", checkId: "age_build", reason: "group look failed: 503" },
      [],
      [],
    );
    expect(view.status).toBe("not_evaluated");
    expect(view.group).toBe("look");
    expect(isScoredCheck(view)).toBe(false);
    expect(view).not.toHaveProperty("band");
    expect(view).not.toHaveProperty("percent");
    expect(view).not.toHaveProperty("passed");
    if (view.status === "not_evaluated") {
      expect(view.reason).toBe("group look failed: 503");
    }
  });
});

const COST: StepCost = { inputTokens: 100, outputTokens: 50, usd: 0.01, latencyMs: 900 };

function passResult(overrides: Partial<PassResult>): PassResult {
  return {
    pass: 1,
    description: "A confident young man in a Nike hoodie.",
    results: [],
    failing: [],
    notEvaluated: [],
    spans: [],
    unverified: [],
    negativeConstraintPresent: false,
    replacements: [],
    rejected: [],
    ...overrides,
  };
}

describe("toPassView", () => {
  it("pairs each replacement with the span it replaced, carrying oldText alongside newText", () => {
    const spans: Span[] = [
      { spanId: "no_brand_name-0", checkId: "no_brand_name", quote: "Nike", start: 25, end: 29 },
    ];
    const replacements: RepairedReplacement[] = [
      { spanId: "no_brand_name-0", newText: "plain grey", rationale: "Removes the brand name." },
    ];
    const result = passResult({
      results: [scored({ checkId: "no_brand_name", band: 1, quotes: ["Nike"] })],
      failing: ["no_brand_name"],
      spans,
    });

    const view = toPassView(result, replacements);

    expect(view.pass).toBe(1);
    expect(view.replacements).toEqual([
      {
        spanId: "no_brand_name-0",
        checkId: "no_brand_name",
        oldText: "Nike",
        newText: "plain grey",
        rationale: "Removes the brand name.",
      },
    ]);
    expect(view.failing).toEqual(["no_brand_name"]);
  });

  it("throws rather than silently drops a replacement whose spanId has no matching span", () => {
    const result = passResult({ spans: [] });
    const bad: RepairedReplacement[] = [{ spanId: "no_such_span", newText: "x", rationale: "r" }];
    expect(() => toPassView(result, bad)).toThrow(/no_such_span/);
  });

  it("omits repairedDescription when the pass has none, rather than setting it to undefined", () => {
    const result = passResult({});
    const view = toPassView(result, []);
    expect(view).not.toHaveProperty("repairedDescription");
  });

  it("includes repairedDescription when the pass repaired something", () => {
    const result = passResult({ repairedDescription: "A man in his late twenties." });
    const view = toPassView(result, []);
    expect(view.repairedDescription).toBe("A man in his late twenties.");
  });

  it("maps a not_evaluated engine check into the pass view without inventing a band", () => {
    const result = passResult({
      results: [{ status: "not_evaluated", checkId: "hair_spec", reason: "group look failed" }],
      failing: ["hair_spec"],
      notEvaluated: ["hair_spec"],
    });
    const view = toPassView(result, []);
    expect(view.results).toEqual([
      { status: "not_evaluated", checkId: "hair_spec", group: "look", reason: "group look failed" },
    ]);
  });

  // End to end: this is the test that would have caught fix round 1's defect
  // -- `repairSpans`'s real output, carried onto a real `PassResult` exactly
  // as `runPass` populates it, must reach the wire view with its rationale
  // intact. A stub replacement object can't prove this; a real repairer call
  // can, because it is the layer that used to throw the rationale away.
  it("carries a real repairSpans() replacement's rationale through PassResult to the wire view", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const spans: Span[] = [
      { spanId: "drawable_only:0", checkId: "drawable_only", quote: "very cinematic presence", start: 22, end: 45 },
    ];
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "drawable_only:0", newText: "square jaw", rationale: "replaces a mood word with a drawable feature" },
        ],
      },
    });

    const { replacements, rejected } = await repairSpans(
      { transport },
      { spans, checks, reasons: { "drawable_only:0": "mood word" } },
    );
    expect(rejected).toEqual([]);

    const result = passResult({
      results: [scored({ checkId: "drawable_only", band: 2, quotes: ["very cinematic presence"] })],
      failing: ["drawable_only"],
      spans,
      replacements,
      repairedDescription: "A lean man with a square jaw.",
    });

    const view = toPassView(result, result.replacements);

    expect(view.replacements).toEqual([
      {
        spanId: "drawable_only:0",
        checkId: "drawable_only",
        oldText: "very cinematic presence",
        newText: "square jaw",
        rationale: "replaces a mood word with a drawable feature",
      },
    ]);
  });
});

describe("toRunView", () => {
  const manifest: RunManifest = {
    runId: "run-1",
    rubricVersion: "1.0.0",
    model: "claude-opus-5",
    status: "passed",
    startedAt: "2026-09-11T10:00:00.000Z",
    finishedAt: "2026-09-11T10:00:30.000Z",
    passes: 1,
  };

  it("assembles the manifest fields, the passes, both descriptions and the summed cost", () => {
    const pass = toPassView(passResult({}), []);
    const view = toRunView(manifest, [pass], "original text", "final text", COST);

    expect(view).toEqual({
      runId: "run-1",
      rubricVersion: "1.0.0",
      model: "claude-opus-5",
      status: "passed",
      startedAt: "2026-09-11T10:00:00.000Z",
      finishedAt: "2026-09-11T10:00:30.000Z",
      originalDescription: "original text",
      finalDescription: "final text",
      passes: [pass],
      cost: COST,
    });
  });

  it("omits finishedAt when the manifest has none, rather than setting it to undefined", () => {
    const running: RunManifest = { ...manifest, status: "running", finishedAt: undefined };
    const view = toRunView(running, [], "x", "x", COST);
    expect(view).not.toHaveProperty("finishedAt");
  });
});
