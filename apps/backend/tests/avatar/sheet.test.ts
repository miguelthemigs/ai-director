import { describe, expect, it, vi } from "vitest";
import {
  ACTOR_SHEET_ASPECT_RATIO,
  actorSheetBrief,
  IMAGE_REALISM_TAIL,
  withRealismTail,
} from "../../src/avatar/sheetBrief.js";
import {
  DEFAULT_IMAGE_MODEL,
  generateSheet,
  NANO_BANANA_PRO,
  type ImageTransport,
} from "../../src/avatar/generateSheet.js";
import {
  authorActorPrompt,
  loadMenticActorDoctrine,
  MENTIC_TEXT_MODEL,
  type TextTransport,
} from "../../src/avatar/authorPrompt.js";

describe("the sheet brief, as copied from Mentic", () => {
  it("wraps the identity in the three fixed panels", () => {
    const brief = actorSheetBrief("A 29-year-old woman.");
    expect(brief).toContain("Cinematic character reference sheet, split-frame layout, photorealistic.");
    expect(brief).toContain("A 29-year-old woman.");
    expect(brief).toContain("Left panel, facial close-up");
    expect(brief).toContain("Right panel, full-body front and back views side by side");
  });

  it("ends with the realism tail, last", () => {
    expect(actorSheetBrief("A woman.").endsWith(IMAGE_REALISM_TAIL)).toBe(true);
  });

  it("never carries the camera tail, which would contradict the close-up panel's 85mm", () => {
    // Mentic's judgement, reproduced: the camera tail forbids by name ("no shallow-focus
    // portrait look, no bokeh") the exact shallow depth the left panel asks for.
    const brief = actorSheetBrief("A woman.");
    expect(brief).not.toContain("Shot on an iPhone");
    expect(brief).toContain("shallow depth of field");
  });

  it("is landscape, because a square frame crops or crushes a three-panel sheet", () => {
    expect(ACTOR_SHEET_ASPECT_RATIO).toBe("16:9");
  });
});

describe("withRealismTail", () => {
  it("keeps an empty prompt empty rather than shipping a bare tail", () => {
    // A failed authoring slot returns "". Turning that into a lone realism tail would
    // hide the failure behind something that reads like a real prompt.
    expect(withRealismTail("", IMAGE_REALISM_TAIL)).toBe("");
    expect(withRealismTail("   ", IMAGE_REALISM_TAIL)).toBe("");
  });

  it("does not append a byte-identical tail twice", () => {
    const once = withRealismTail("A woman.", IMAGE_REALISM_TAIL);
    expect(withRealismTail(once, IMAGE_REALISM_TAIL)).toBe(once);
  });
});

describe("generateSheet", () => {
  it("asks Nano Banana Pro for the sheet at 16:9", async () => {
    const transport: ImageTransport = vi.fn(async () => ({
      imageBase64: "aGk=",
      mediaType: "image/png",
    }));

    const sheet = await generateSheet(transport, { prompt: "a prompt" });

    expect(transport).toHaveBeenCalledWith({
      model: NANO_BANANA_PRO,
      prompt: "a prompt",
      aspectRatio: "16:9",
    });
    expect(sheet.imageBase64).toBe("aGk=");
    expect(sheet.model).toBe(DEFAULT_IMAGE_MODEL);
    // The prompt comes back with the image, because telling a bad prompt apart from a bad
    // render needs both.
    expect(sheet.prompt).toBe("a prompt");
  });
});

describe("authorActorPrompt", () => {
  it("runs Mentic's doctrine as the system prompt, on Mentic's model", async () => {
    const transport: TextTransport = vi.fn(async () => ({ text: "  an authored identity  " }));
    const doctrine = await loadMenticActorDoctrine();

    const authored = await authorActorPrompt(transport, { description: "a 29 year old woman" });

    expect(authored).toBe("an authored identity");
    expect(transport).toHaveBeenCalledWith({
      system: doctrine,
      user: "ACTOR DESCRIPTION\na 29 year old woman",
      // Not this repo's Opus: reproducing a call on a different model measures a step
      // that does not exist in production.
      model: MENTIC_TEXT_MODEL,
    });
  });

  it("passes a variation hint through, which is how four candidates become four people", async () => {
    const transport: TextTransport = vi.fn(async () => ({ text: "x" }));
    await authorActorPrompt(transport, { description: "a woman", variationHint: "vary the hair" });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ user: "ACTOR DESCRIPTION\na woman\n\nvary the hair" }),
    );
  });

  it("carries the doctrine file, and it is the one that names the sheet layout", async () => {
    const doctrine = await loadMenticActorDoctrine();
    expect(doctrine).toContain("COPIED VERBATIM");
    expect(doctrine).toContain("ACTOR'S VISUAL IDENTITY");
  });
});
