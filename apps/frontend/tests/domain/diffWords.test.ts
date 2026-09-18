import { describe, expect, it } from "vitest";
import { diffWords } from "../../src/domain/diffWords.js";

const rejoin = (parts: ReturnType<typeof diffWords>, side: "before" | "after") =>
  parts
    .filter((p) => (side === "before" ? p.kind !== "added" : p.kind !== "removed"))
    .map((p) => p.text)
    .join("");

describe("diffWords", () => {
  it("rebuilds both inputs exactly, so what is shown is what is sent", () => {
    const before = "A young man with wavy brown hair, green eyes.";
    const after = "A young man with medium-length wavy brown hair, green eyes.";
    const parts = diffWords(before, after);
    expect(rejoin(parts, "before")).toBe(before);
    expect(rejoin(parts, "after")).toBe(after);
  });

  it("marks only the words that actually moved", () => {
    const parts = diffWords("hair is shoulder-length today", "hair is medium-length today");
    expect(parts.filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual([
      "shoulder-length",
    ]);
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual([
      "medium-length",
    ]);
  });

  it("reports nothing changed when nothing did", () => {
    const parts = diffWords("identical text", "identical text");
    expect(parts.every((p) => p.kind === "same")).toBe(true);
  });

  it("handles an addition at the end and a removal at the start", () => {
    expect(diffWords("one two", "one two three").filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["three"]);
    expect(diffWords("zero one", "one").filter((p) => p.kind === "removed").map((p) => p.text.trim())).toEqual(["zero"]);
  });
});
