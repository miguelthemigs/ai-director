import { describe, expect, it } from "vitest";
import { CLOSING_LINE } from "../../src/orchestrate/director/assemblePrompt/v2.js";
import { AssemblyInvariantError } from "../../src/orchestrate/director/assemble.js";
import { assembleTextPrompt, renderShotList } from "../../src/lab/assemble.js";
import { boardCameras, boardPlan } from "../orchestrate/director/planFixture.js";
import { labBrief } from "./labFixture.js";

const CHARACTER = "A young man in his mid-twenties with wavy brown hair, green eyes, light stubble.";

describe("assembleTextPrompt", () => {
  const { text, sha256 } = assembleTextPrompt({ plan: boardPlan(), cameras: boardCameras(), characterText: CHARACTER });

  it("names the product and the location in words, first", () => {
    expect(text.startsWith("Product (@product): the product bottle, front label to camera.\nLocation (@kitchen): a bright home kitchen with a wooden counter.")).toBe(true);
  });

  it("carries the style line and the character byte-identical", () => {
    expect(text).toContain("Warm handheld lifestyle ad, natural colour");
    expect(text).toContain(`HERO (@maya): ${CHARACTER}`);
  });

  it("writes every shot once and ends with the closing line", () => {
    for (const n of [1, 2, 3, 4]) expect(text.split(`Shot ${n}:`)).toHaveLength(2);
    expect(text.endsWith(CLOSING_LINE)).toBe(true);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a shot with no camera", () => {
    const cameras = boardCameras().filter((camera) => camera.shot !== 3);
    expect(() => assembleTextPrompt({ plan: boardPlan(), cameras, characterText: CHARACTER })).toThrow(AssemblyInvariantError);
  });

  it("refuses a plan with two locations", () => {
    const plan = boardPlan();
    plan.assets.push({ handle: "@garden", kind: "location", description: "a garden" });
    expect(() => assembleTextPrompt({ plan, cameras: boardCameras(), characterText: CHARACTER })).toThrow(AssemblyInvariantError);
  });
});

describe("renderShotList", () => {
  it("is a readable table with the planned length", () => {
    const md = renderShotList({ plan: boardPlan(), cameras: boardCameras(), characterText: CHARACTER, brief: labBrief() });
    expect(md.startsWith("# Shot list")).toBe(true);
    expect(md).toContain("15 s");
    expect(md).toContain("| # | What happens | Camera | Light | Sound |");
    expect(md.split("\n").filter((line) => /^\| [1-4] \|/.test(line))).toHaveLength(4);
  });
});
