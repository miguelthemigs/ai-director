import { describe, expect, it } from "vitest";
import { checksForGroup, loadRubric } from "../../src/rubric/load.js";

describe("rubric v1", () => {
  it("loads and validates", async () => {
    const rubric = await loadRubric("v1");
    expect(rubric.version).toBe("v1");
    expect(rubric.checks).toHaveLength(9);
  });

  it("gives every check five bands and a source", async () => {
    const rubric = await loadRubric("v1");
    for (const check of rubric.checks) {
      expect(Object.keys(check.bands)).toEqual(["1", "2", "3", "4", "5"]);
      expect(check.source.length).toBeGreaterThan(0);
      expect(check.passTest.length).toBeGreaterThan(0);
    }
  });

  it("splits into 5 look, 2 safety, 2 drawable checks", async () => {
    const rubric = await loadRubric("v1");
    expect(checksForGroup(rubric, "look").map((c) => c.id)).toEqual([
      "age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker",
    ]);
    expect(checksForGroup(rubric, "safety").map((c) => c.id)).toEqual([
      "no_real_person", "no_brand_name",
    ]);
    expect(checksForGroup(rubric, "drawable").map((c) => c.id)).toEqual([
      "drawable_only", "no_cross_slot",
    ]);
  });

  it("rejects an unknown version rather than inventing one", async () => {
    await expect(loadRubric("v99")).rejects.toThrow(/rubric v99 not found/);
  });
});
