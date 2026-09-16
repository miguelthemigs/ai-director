import { describe, expect, it } from "vitest";
import { buildShotPrompt, SHOT_PROMPT_VERSION } from "../../src/video/shotPrompt/v1.js";

const DESCRIPTION =
  "A young man in his mid-twenties with wavy brown hair, green eyes, light stubble and fair skin.";

describe("buildShotPrompt", () => {
  it("is versioned, so a row can record which wrapper produced it", () => {
    expect(SHOT_PROMPT_VERSION).toBe("v1");
  });

  it("carries the description verbatim", () => {
    expect(buildShotPrompt(DESCRIPTION)).toContain(DESCRIPTION);
  });

  it("is a pure function of the description, so the two sides differ only in that", () => {
    const a = buildShotPrompt(DESCRIPTION);
    const b = buildShotPrompt(DESCRIPTION);
    expect(a).toBe(b);

    const other = buildShotPrompt("A different person entirely.");
    const shared = a.replace(DESCRIPTION, "");
    const otherShared = other.replace("A different person entirely.", "");
    expect(shared).toBe(otherShared);
  });

  it("names no location, lighting, camera move or emotion", () => {
    const wrapper = buildShotPrompt(DESCRIPTION).replace(DESCRIPTION, "");
    for (const banned of [
      "kitchen",
      "office",
      "golden hour",
      "dolly",
      "pan",
      "zoom",
      "tracking",
      "happy",
      "confident",
      "moody",
    ]) {
      expect(wrapper.toLowerCase()).not.toContain(banned);
    }
  });

  it("refuses an empty description rather than sending a wrapper with a hole in it", () => {
    expect(() => buildShotPrompt("   ")).toThrow(/description/i);
  });
});
