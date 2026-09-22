import { describe, expect, it } from "vitest";
import {
  AVATAR_FIELDS,
  assembleDescription,
  isFieldVisible,
  randomizeFields,
  resolveSuggestions,
} from "../../src/domain/avatarFields.js";

describe("assembleDescription", () => {
  it("builds one prose noun phrase, not Mentic's label block", () => {
    const text = assembleDescription({
      age: "29",
      ethnicity: "Latina American",
      gender: "woman",
      buildNote: "petite, about 1.60m",
      hair: "blonde bob, slightly messy",
      eyeColor: "hazel",
      wardrobe: "linen shirt, khaki chinos, canvas sneakers, no logos",
    });

    expect(text).toBe(
      "A 29-year-old Latina American woman, petite, about 1.60m, with blonde bob, slightly messy, " +
        "hazel eyes, in linen shirt, khaki chinos, canvas sneakers, no logos",
    );
    // The shape that reaches the video model is prose. A `Hair:` label would be an image brief.
    expect(text).not.toMatch(/Hair:|Eyes:|Wardrobe:/);
  });

  it("drops a blank field whole, leaving no dangling connective or double comma", () => {
    const text = assembleDescription({ age: "32", gender: "man", wardrobe: "linen shirt" });
    expect(text).toBe("A 32-year-old man, in linen shirt");
    expect(text).not.toMatch(/,\s*,|,\s*$|\bwith\s*,/);
  });

  it("invents nothing for a field the user left blank", () => {
    const text = assembleDescription({ gender: "man" });
    // No hair, no wardrobe, no marker: the omissions are exactly what the rubric must catch, so
    // this function must not paper over them.
    expect(text).toBe("A man");
  });

  it("degrades to a person rather than an empty string when nothing is set", () => {
    expect(assembleDescription({})).toBe("A person");
  });

  it("keeps free text as its own sentence, never spliced into the noun phrase", () => {
    const text = assembleDescription({ gender: "woman", extraNotes: "She is left-handed." });
    expect(text).toBe("A woman. She is left-handed.");
  });

  it("ignores whitespace-only values", () => {
    expect(assembleDescription({ gender: "man", hair: "   " })).toBe("A man");
  });
});

describe("the field set", () => {
  it("covers every look check the rubric scores", () => {
    const covered = new Set(AVATAR_FIELDS.flatMap((field) => field.checks));
    for (const checkId of ["age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker"]) {
      expect(covered.has(checkId as never), `no field feeds ${checkId}`).toBe(true);
    }
  });

  it("flags exactly the two fields Mentic has no counterpart for", () => {
    const flagged = AVATAR_FIELDS.filter((field) => field.notInMentic).map((field) => field.key);
    expect(flagged).toEqual(["faceSkin", "anchorMarker"]);
  });

  it("ends every wardrobe suggestion with `no logos`, which is what keeps no_brand_name passing", () => {
    const wardrobe = AVATAR_FIELDS.find((field) => field.key === "wardrobe");
    expect(wardrobe).toBeDefined();
    for (const suggestion of resolveSuggestions(wardrobe!, {})) {
      expect(suggestion, suggestion).toMatch(/no logos$/);
    }
  });

  it("switches the hair pool on gender, and blends the two while gender is unset", () => {
    const hair = AVATAR_FIELDS.find((field) => field.key === "hair");
    expect(hair).toBeDefined();
    const man = resolveSuggestions(hair!, { gender: "man" });
    const woman = resolveSuggestions(hair!, { gender: "woman" });
    const unset = resolveSuggestions(hair!, {});

    expect(man).not.toEqual(woman);
    // Unset must not silently pick one gender's styles for everybody.
    expect(unset).not.toEqual(man);
    expect(unset).not.toEqual(woman);
  });

  it("hides makeup until gender is woman", () => {
    const makeup = AVATAR_FIELDS.find((field) => field.key === "makeupLevel");
    expect(makeup).toBeDefined();
    expect(isFieldVisible(makeup!, {})).toBe(false);
    expect(isFieldVisible(makeup!, { gender: "man" })).toBe(false);
    expect(isFieldVisible(makeup!, { gender: "woman" })).toBe(true);
  });
});

describe("randomizeFields", () => {
  it("fills every visible non-free-text field", () => {
    const values = randomizeFields();
    for (const field of AVATAR_FIELDS) {
      if (field.freeText) continue;
      if (!isFieldVisible(field, values)) continue;
      expect(values[field.key], `${field.key} left blank`).toBeTruthy();
    }
  });

  it("picks hair from the pool that matches the gender it just rolled", () => {
    // Order is load-bearing: gender is resolved before hair, so hair must never come from the
    // blended unset pool once a gender has been picked in the same pass.
    for (let i = 0; i < 40; i += 1) {
      const values = randomizeFields();
      const hair = AVATAR_FIELDS.find((field) => field.key === "hair")!;
      expect(resolveSuggestions(hair, values)).toContain(values.hair);
    }
  });

  it("never leaves makeup set for a man", () => {
    for (let i = 0; i < 40; i += 1) {
      const values = randomizeFields();
      if (values.gender !== "woman") expect(values.makeupLevel).toBeUndefined();
    }
  });

  it("carries a hand-written note through untouched", () => {
    const kept = randomizeFields({ extraNotes: "She is left-handed." });
    expect(kept.extraNotes).toBe("She is left-handed.");
  });

  it("rerolls on an already-full form rather than filling gaps once", () => {
    // A reroll must do something new on the fifth click. Forty passes on a field with seven
    // values: all forty landing on the same value would be a 1-in-7^39 coincidence.
    const picks = new Set(Array.from({ length: 40 }, () => randomizeFields().ethnicity));
    expect(picks.size).toBeGreaterThan(1);
  });
});
