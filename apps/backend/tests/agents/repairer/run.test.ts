import { describe, expect, it, vi } from "vitest";
import { repairSpans } from "../../../src/agents/repairer/run.js";
import { loadRubric } from "../../../src/rubric/load.js";

const spans = [
  { spanId: "drawable_only:0", checkId: "drawable_only", quote: "very cinematic presence", start: 22, end: 45 },
];

describe("repairSpans", () => {
  it("returns one replacement per span", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "drawable_only:0", newText: "square jaw", rationale: "replaced a mood word" },
        ],
      },
    });
    const out = await repairSpans({ transport }, { spans, checks, reasons: { "drawable_only:0": "mood word" } });
    expect(out).toEqual({
      replacements: [{ spanId: "drawable_only:0", newText: "square jaw" }],
      rejected: [],
    });
  });

  it("never sends the full description to the model", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: { replacements: [{ spanId: "drawable_only:0", newText: "square jaw", rationale: "r" }] },
    });
    await repairSpans({ transport }, { spans, checks, reasons: {} });
    const call = transport.mock.calls[0]![0] as { user: string };
    expect(call.user).toContain("very cinematic presence");
    expect(call.user).not.toContain("A lean man, late 20s");
  });

  it("drops an invented spanId into rejected but keeps the other replacements in the batch", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const twoSpans = [
      ...spans,
      { spanId: "drawable_only:1", checkId: "drawable_only", quote: "a certain vibe", start: 60, end: 74 },
    ];
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "wardrobe:9", newText: "x", rationale: "r" },
          { spanId: "drawable_only:1", newText: "sharp cheekbones", rationale: "r" },
        ],
      },
    });
    const out = await repairSpans({ transport }, { spans: twoSpans, checks, reasons: {} });
    expect(out.replacements).toEqual([{ spanId: "drawable_only:1", newText: "sharp cheekbones" }]);
    expect(out.rejected).toEqual([{ spanId: "wardrobe:9", reason: "unknown_span" }]);
  });

  it("drops an empty newText into rejected but keeps the other replacements in the batch", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const twoSpans = [
      ...spans,
      { spanId: "drawable_only:1", checkId: "drawable_only", quote: "a certain vibe", start: 60, end: 74 },
    ];
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "drawable_only:0", newText: "   ", rationale: "r" },
          { spanId: "drawable_only:1", newText: "sharp cheekbones", rationale: "r" },
        ],
      },
    });
    const out = await repairSpans({ transport }, { spans: twoSpans, checks, reasons: {} });
    expect(out.replacements).toEqual([{ spanId: "drawable_only:1", newText: "sharp cheekbones" }]);
    expect(out.rejected).toEqual([{ spanId: "drawable_only:0", reason: "empty_text" }]);
  });

  it("returns empty replacements and a populated rejected when every item in the batch is bad", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "wardrobe:9", newText: "x", rationale: "r" },
          { spanId: "drawable_only:0", newText: "", rationale: "r" },
        ],
      },
    });
    const out = await repairSpans({ transport }, { spans, checks, reasons: {} });
    expect(out.replacements).toEqual([]);
    expect(out.rejected).toEqual([
      { spanId: "wardrobe:9", reason: "unknown_span" },
      { spanId: "drawable_only:0", reason: "empty_text" },
    ]);
  });

  it("throws when parsing failed", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(repairSpans({ transport }, { spans, checks, reasons: {} })).rejects.toThrow(
      /parse failed/,
    );
  });
});
