import { describe, expect, it } from "vitest";
import { applyReplacements, assertByteIdentical, SpliceError } from "../../src/enforce/splice.js";
import { verifySpans } from "../../src/enforce/verifySpans.js";

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

describe("applyReplacements", () => {
  it("replaces only the quoted span", () => {
    const { spans } = verifySpans(description, [
      { checkId: "drawable_only", quote: "very cinematic presence" },
    ]);
    const out = applyReplacements(description, spans, [
      { spanId: "drawable_only:0", newText: "square jaw and a chipped left incisor" },
    ]);
    expect(out).toBe(
      "A lean man, late 20s, with a square jaw and a chipped left incisor and grey hoodie.",
    );
  });

  it("leaves the untouched text byte-identical", () => {
    const { spans } = verifySpans(description, [{ checkId: "wardrobe", quote: "grey hoodie" }]);
    const out = applyReplacements(description, spans, [
      { spanId: "wardrobe:0", newText: "charcoal hoodie, zip half open, white low-top sneakers" },
    ]);
    expect(out.startsWith("A lean man, late 20s, with a very cinematic presence and ")).toBe(true);
    expect(out.endsWith(".")).toBe(true);
  });

  it("applies two replacements without offset drift", () => {
    const { spans } = verifySpans(description, [
      { checkId: "age_build", quote: "lean man" },
      { checkId: "wardrobe", quote: "grey hoodie" },
    ]);
    const out = applyReplacements(description, spans, [
      { spanId: "age_build:0", newText: "lean man of 178cm" },
      { spanId: "wardrobe:0", newText: "charcoal hoodie and white sneakers" },
    ]);
    expect(out).toContain("lean man of 178cm");
    expect(out).toContain("charcoal hoodie and white sneakers");
  });

  it("applies three replacements of different lengths, growing and shrinking, without offset drift", () => {
    const { spans } = verifySpans(description, [
      { checkId: "age_build", quote: "lean man" },
      { checkId: "drawable_only", quote: "very cinematic presence" },
      { checkId: "wardrobe", quote: "grey hoodie" },
    ]);
    const out = applyReplacements(description, spans, [
      // grows: 8 chars -> 38 chars
      { spanId: "age_build:0", newText: "lean man of 178cm and broad shoulders" },
      // shrinks: 24 chars -> 10 chars
      { spanId: "drawable_only:0", newText: "square jaw" },
      // shrinks: 11 chars -> 8 chars
      { spanId: "wardrobe:0", newText: "red coat" },
    ]);

    // Independent oracle: sequential String.replace on the original text, which
    // never reasons about offsets at all, so it cannot share a bug with the
    // offset-based splice under test.
    const expected = description
      .replace("lean man", "lean man of 178cm and broad shoulders")
      .replace("very cinematic presence", "square jaw")
      .replace("grey hoodie", "red coat");

    expect(out).toBe(expected);
  });

  it("throws when a replacement names an unknown span", () => {
    expect(() => applyReplacements(description, [], [{ spanId: "nope:0", newText: "x" }])).toThrow(
      /unknown spanId nope:0/,
    );
  });

  it("throws when a replacement is empty", () => {
    const { spans } = verifySpans(description, [{ checkId: "wardrobe", quote: "grey hoodie" }]);
    expect(() => applyReplacements(description, spans, [{ spanId: "wardrobe:0", newText: " " }])).toThrow(
      /empty replacement/,
    );
  });

  it("throws on overlapping replacement spans instead of silently corrupting the text", () => {
    // Hand-built spans standing in for two checks that legitimately quote overlapping
    // text (e.g. wardrobe: "Nike hoodie", no_brand_name: "Nike"). verifySpans already
    // demotes one such span to `ambiguous` before it ever reaches applyReplacements, but
    // applyReplacements must not depend on that — it is handed a bare Span[] and must
    // refuse to splice two replacements whose ranges overlap, rather than merge them.
    const text = "A man in a Nike hoodie.";
    const wardrobeSpan = { spanId: "wardrobe:0", checkId: "wardrobe", quote: "Nike hoodie", start: 11, end: 22 };
    const brandSpan = { spanId: "no_brand_name:0", checkId: "no_brand_name", quote: "Nike", start: 11, end: 15 };

    expect(() =>
      applyReplacements(text, [wardrobeSpan, brandSpan], [
        { spanId: "wardrobe:0", newText: "grey hoodie" },
        { spanId: "no_brand_name:0", newText: "Acme" },
      ]),
    ).toThrow(SpliceError);
    expect(() =>
      applyReplacements(text, [wardrobeSpan, brandSpan], [
        { spanId: "wardrobe:0", newText: "grey hoodie" },
        { spanId: "no_brand_name:0", newText: "Acme" },
      ]),
    ).toThrow(/overlap/);
  });

  it("applying only one of two overlapping spans still works", () => {
    const text = "A man in a Nike hoodie.";
    const wardrobeSpan = { spanId: "wardrobe:0", checkId: "wardrobe", quote: "Nike hoodie", start: 11, end: 22 };
    const brandSpan = { spanId: "no_brand_name:0", checkId: "no_brand_name", quote: "Nike", start: 11, end: 15 };

    const out = applyReplacements(text, [wardrobeSpan, brandSpan], [
      { spanId: "no_brand_name:0", newText: "Acme" },
    ]);
    expect(out).toBe("A man in a Acme hoodie.");
  });
});

describe("assertByteIdentical", () => {
  // The splice's post-splice guard is unreachable through applyReplacements by
  // construction: both strings it compares are always built from the same span
  // offsets over the same immutable description. This tests the guard directly,
  // proving it would fire if that invariant were ever violated.
  it("does nothing when the two strings match", () => {
    expect(() => assertByteIdentical("same", "same")).not.toThrow();
  });

  it("throws a SpliceError when the two strings differ", () => {
    expect(() => assertByteIdentical("expected", "actual")).toThrow(SpliceError);
    expect(() => assertByteIdentical("expected", "actual")).toThrow(/untouched text changed/);
  });
});
