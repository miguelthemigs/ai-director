import { describe, expect, it } from "vitest";
import { CAMERA_MOVES, DIRECTOR_CHECK_IDS, DIRECTOR_CHECK_LABELS, DIRECTOR_RECIPE_EDGES,
  SHOT_WEIGHT_SECONDS, plannedSeconds, type Plan } from "../src/index.js";

const plan = (weights: Array<"short" | "normal" | "long">): Plan => ({
  styleLine: "s", scene: "x", assets: [],
  shots: weights.map((weight) => ({ action: "a", weight, sound: "" })),
});

describe("director contract", () => {
  it("weights are 2, 3 and 4 seconds", () => {
    expect(SHOT_WEIGHT_SECONDS).toEqual({ short: 2, normal: 3, long: 4 });
    expect(plannedSeconds(plan(["normal", "long", "long", "long"]))).toBe(15);
  });
  it("camera moves are the closed list from the design", () => {
    expect(CAMERA_MOVES).toEqual(["static", "slow push-in", "pull-out", "tracking", "orbit", "crane up", "handheld"]);
  });
  it("every check has a label", () => {
    for (const id of DIRECTOR_CHECK_IDS) expect(DIRECTOR_CHECK_LABELS[id]).toBeTruthy();
  });
  it("the four branches all hang off gate B and all feed the assembler", () => {
    const fromB = DIRECTOR_RECIPE_EDGES.filter((e) => e.from === "B").map((e) => e.to);
    expect(fromB).toEqual(["product", "location", "character", "cinematographer"]);
    const intoAssembler = DIRECTOR_RECIPE_EDGES.filter((e) => e.to === "assembler").map((e) => e.from);
    expect(intoAssembler).toEqual(["product", "location", "character", "cinematographer"]);
  });
});
