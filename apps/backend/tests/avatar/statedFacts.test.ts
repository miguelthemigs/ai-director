import { describe, expect, it } from "vitest";
import { statedFactsFor } from "../../src/avatar/statedFacts.js";
import type { AvatarRecord } from "../../src/store/AvatarStore.js";

const base: AvatarRecord = {
  id: "a",
  createdAt: "2026-09-12T00:00:00.000Z",
  source: "generated",
  mediaType: "image/jpeg",
};

describe("statedFactsFor", () => {
  it("prefers the brief the sheet was actually rendered from", () => {
    // `authoredPrompt` describes the picture by construction: Nano Banana drew it from
    // this text. `seedDescription` only says what was asked for, and on the real avatar
    // the two genuinely disagree -- the form said "average height" and the brief says
    // 1.78m, which is the number the render was conditioned on.
    const record = {
      ...base,
      seedDescription: "a 20-year-old man, average build, average height",
      authoredPrompt: "BUILD: about 1.78m, average build, medium frame",
    };
    expect(statedFactsFor(record)).toBe("BUILD: about 1.78m, average build, medium frame");
  });

  it("falls back to the user's own sentence when no brief was authored", () => {
    const record = { ...base, seedDescription: "a 20-year-old man, average height" };
    expect(statedFactsFor(record)).toBe("a 20-year-old man, average height");
  });

  it("returns null for an uploaded sheet, because nobody knows how tall that person is", () => {
    expect(statedFactsFor({ ...base, source: "uploaded" })).toBeNull();
  });

  it("treats a blank brief as no brief rather than as empty stated facts", () => {
    expect(statedFactsFor({ ...base, authoredPrompt: "   ", seedDescription: "  " })).toBeNull();
  });
});
