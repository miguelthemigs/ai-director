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
    expect(out).toEqual([{ spanId: "drawable_only:0", newText: "square jaw" }]);
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

  it("throws when the model invents a spanId", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: { replacements: [{ spanId: "wardrobe:9", newText: "x", rationale: "r" }] },
    });
    await expect(
      repairSpans({ transport }, { spans, checks, reasons: {} }),
    ).rejects.toThrow(/unknown spanId wardrobe:9/);
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
