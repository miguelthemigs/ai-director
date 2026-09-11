import { describe, expect, it } from "vitest";
import { verifySpans } from "../../src/enforce/verifySpans.js";

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

describe("verifySpans", () => {
  it("finds a verbatim quote and computes its offsets in code", () => {
    const { spans, unverified } = verifySpans(description, [
      { checkId: "drawable_only", quote: "very cinematic presence" },
    ]);
    expect(unverified).toEqual([]);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(description.slice(span.start, span.end)).toBe("very cinematic presence");
    expect(span.spanId).toBe("drawable_only:0");
  });

  it("marks a paraphrase unverified instead of guessing", () => {
    const { spans, unverified } = verifySpans(description, [
      { checkId: "drawable_only", quote: "cinematic vibes" },
    ]);
    expect(spans).toEqual([]);
    expect(unverified).toEqual([
      { checkId: "drawable_only", quote: "cinematic vibes", reason: "not_found" },
    ]);
  });

  it("marks a quote that appears more than once as ambiguous", () => {
    const { spans, unverified } = verifySpans("grey hoodie, grey shoes", [
      { checkId: "wardrobe", quote: "grey" },
    ]);
    expect(spans).toEqual([]);
    expect(unverified[0]!.reason).toBe("ambiguous");
  });

  it("keeps spans sorted and non-overlapping", () => {
    const { spans } = verifySpans(description, [
      { checkId: "wardrobe", quote: "grey hoodie" },
      { checkId: "age_build", quote: "lean man" },
    ]);
    expect(spans.map((s) => s.start)).toEqual([2, 57]);
  });

  it("rejects an empty quote", () => {
    const { unverified } = verifySpans(description, [{ checkId: "wardrobe", quote: "  " }]);
    expect(unverified[0]!.reason).toBe("not_found");
  });
});
