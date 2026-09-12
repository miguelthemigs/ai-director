import { describe, expect, it, vi } from "vitest";
import {
  describeImage,
  isSupportedMediaType,
  trimToWhole,
  type VisionTransport,
} from "../../src/describe/describeImage.js";
import {
  MENTIC_DESCRIBE_ACTOR_SYSTEM,
  MENTIC_DESCRIBE_ACTOR_USER,
  MENTIC_DESCRIBE_MAX_CHARS,
} from "../../src/describe/prompt.js";

function transportReturning(text: string): VisionTransport {
  return vi.fn(async () => ({ text }));
}

describe("Mentic's describe prompt, as copied", () => {
  it("still asks for one sentence under 400 characters", () => {
    // This is the conflict the whole repo exists to measure: five band-4 rows cannot fit
    // in 400 characters together. If Mentic ever relaxes this line, the hypothesis in
    // `prompt.ts` changes, and this test is what makes that change impossible to miss.
    expect(MENTIC_DESCRIBE_ACTOR_SYSTEM).toContain("One sentence, under 400 characters");
  });

  it("still forbids describing the sheet, which is check no_cross_slot by another name", () => {
    expect(MENTIC_DESCRIBE_ACTOR_SYSTEM).toContain("no panels, no divider lines, no grey");
  });

  it("still forbids a name or an identity, which is check no_real_person", () => {
    expect(MENTIC_DESCRIBE_ACTOR_SYSTEM).toContain("Never a name, never an identity");
  });

  it("stores 900 characters while asking for 400, and that gap is Mentic's own", () => {
    expect(MENTIC_DESCRIBE_MAX_CHARS).toBe(900);
  });
});

describe("describeImage", () => {
  it("sends Mentic's system prompt and user turn, unchanged", async () => {
    const transport = transportReturning("A woman in her thirties.");
    await describeImage(transport, { imageBase64: "aGk=", mediaType: "image/png" });

    expect(transport).toHaveBeenCalledWith({
      system: MENTIC_DESCRIBE_ACTOR_SYSTEM,
      user: MENTIC_DESCRIBE_ACTOR_USER,
      imageBase64: "aGk=",
      mediaType: "image/png",
    });
  });

  it("strips the wrapping quotes the model adds despite being told not to", async () => {
    const result = await describeImage(transportReturning('"A woman in her thirties."'), {
      imageBase64: "aGk=",
      mediaType: "image/png",
    });
    expect(result.description).toBe("A woman in her thirties.");
  });

  it("reports whether the cap actually cut anything, and keeps the raw text either way", async () => {
    const short = await describeImage(transportReturning("A woman."), {
      imageBase64: "aGk=",
      mediaType: "image/png",
    });
    expect(short.trimmed).toBe(false);
    expect(short.raw).toBe("A woman.");

    const long = "A woman, ".repeat(200);
    const cut = await describeImage(transportReturning(long), {
      imageBase64: "aGk=",
      mediaType: "image/png",
    });
    // The raw text is kept because the difference between the two IS the evidence: a
    // description that had to be trimmed is one the 400-character instruction failed to
    // hold, which is the conflict this path exists to expose.
    expect(cut.trimmed).toBe(true);
    expect(cut.raw.length).toBeGreaterThan(cut.description.length);
  });

  it("throws rather than returning an empty description", async () => {
    // Mentic returns null here and degrades the render to a generic person, because it
    // has a video to ship. Here the description IS the job: an empty string put through
    // the nine checks would produce a score for nothing.
    await expect(
      describeImage(transportReturning("   "), { imageBase64: "aGk=", mediaType: "image/png" }),
    ).rejects.toThrow(/no description/);
  });
});

describe("trimToWhole", () => {
  it("leaves text under the cap alone", () => {
    expect(trimToWhole("A woman.", 900)).toBe("A woman.");
  });

  it("cuts back to a sentence end rather than mid-word", () => {
    // Mentic's own bug: a hard slice ended a live description at "cream roller bli".
    const text = `${"x".repeat(40)}. a cream roller blind and more text after it`;
    const trimmed = trimToWhole(text, 60);
    expect(trimmed.endsWith(".")).toBe(true);
    expect(trimmed).not.toMatch(/bli$/);
  });

  it("falls back to the last space when no sentence end is far enough in", () => {
    const trimmed = trimToWhole("alpha beta gamma delta epsilon", 20);
    expect(trimmed).toBe("alpha beta gamma");
    expect(trimmed.endsWith(" ")).toBe(false);
  });

  it("hard-cuts only when a single unbroken token fills the whole budget", () => {
    expect(trimToWhole("y".repeat(50), 10)).toBe("y".repeat(10));
  });
});

describe("isSupportedMediaType", () => {
  it("accepts what the vision API accepts and nothing else", () => {
    expect(isSupportedMediaType("image/png")).toBe(true);
    expect(isSupportedMediaType("image/jpeg")).toBe(true);
    expect(isSupportedMediaType("image/heic")).toBe(false);
    expect(isSupportedMediaType("application/pdf")).toBe(false);
  });
});
