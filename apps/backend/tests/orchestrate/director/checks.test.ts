import { describe, expect, it } from "vitest";
import { runPlanChecks, runPromptChecks } from "../../../src/orchestrate/director/checks.js";
import { boardCameras, boardPlan } from "./planFixture.js";

const byId = (outcomes: ReturnType<typeof runPlanChecks>, id: string) => {
  const found = outcomes.find((o) => o.id === id);
  if (!found) throw new Error(`no outcome ${id}`);
  return found;
};

describe("runPlanChecks", () => {
  it("passes the Gate B board example on every check", () => {
    const outcomes = runPlanChecks(boardPlan(), 15, []);
    expect(outcomes.map((o) => o.id)).toEqual([
      "length_fits",
      "handles_match",
      "references_within_cap",
      "no_timestamps",
      "nothing_ruled_out",
    ]);
    expect(outcomes.every((o) => o.passed && o.owner === "director")).toBe(true);
    expect(byId(outcomes, "length_fits").detail).toBe("3 + 4 + 4 + 4 = 15 s, you chose 15 s");
    expect(byId(outcomes, "handles_match").detail).toBeNull();
  });

  it("length_fits fails beyond the tolerance and passes at exactly it", () => {
    const failing = byId(runPlanChecks(boardPlan(), 20, []), "length_fits");
    expect(failing.passed).toBe(false);
    expect(failing.detail).toBe("3 + 4 + 4 + 4 = 15 s, you chose 20 s");
    expect(byId(runPlanChecks(boardPlan(), 17, []), "length_fits").passed).toBe(true);
    expect(byId(runPlanChecks(boardPlan(), 17.5, []), "length_fits").passed).toBe(false);
  });

  it("handles_match fails on an undeclared handle and names the shot", () => {
    const plan = boardPlan();
    plan.shots[1]!.action = "She lifts @bottle and reads the label";
    const outcome = byId(runPlanChecks(plan, 15, []), "handles_match");
    expect(outcome.passed).toBe(false);
    expect(outcome.shots).toEqual([2]);
    expect(outcome.detail).toContain("@bottle");
  });

  it("handles_match fails on an undeclared handle in the scene", () => {
    const plan = boardPlan();
    plan.scene = "@maya in @garden";
    expect(byId(runPlanChecks(plan, 15, []), "handles_match").passed).toBe(false);
  });

  it("handles_match fails when a declared non-character asset is never used", () => {
    const plan = boardPlan();
    plan.scene = "@maya in a quiet morning.";
    plan.shots = plan.shots.map((s) => ({ ...s, action: s.action.replaceAll("@kitchen", "the room") }));
    const outcome = byId(runPlanChecks(plan, 15, []), "handles_match");
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("@kitchen");
  });

  it("handles_match does not require a character to be used", () => {
    const plan = boardPlan();
    plan.scene = "@kitchen with @product.";
    plan.shots = plan.shots.map((s) => ({ ...s, action: s.action.replaceAll("@maya", "She") }));
    expect(byId(runPlanChecks(plan, 15, []), "handles_match").passed).toBe(true);
  });

  it("references_within_cap fails above 5 product and location assets", () => {
    const plan = boardPlan();
    for (let i = 0; i < 4; i++) plan.assets.push({ handle: `@extra${i}`, kind: "location", description: "x" });
    const outcome = byId(runPlanChecks(plan, 15, []), "references_within_cap");
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("6");
  });

  it("references_within_cap fails on an empty description", () => {
    const plan = boardPlan();
    plan.assets[0]!.description = "   ";
    expect(byId(runPlanChecks(plan, 15, []), "references_within_cap").passed).toBe(false);
  });

  it("references_within_cap does not count characters", () => {
    const plan = boardPlan();
    for (let i = 0; i < 3; i++) plan.assets.push({ handle: `@c${i}`, kind: "character", description: "" });
    expect(byId(runPlanChecks(plan, 15, []), "references_within_cap").passed).toBe(true);
  });

  it("no_timestamps fails on '(2–4s)' in shot 3", () => {
    const plan = boardPlan();
    plan.shots[2]!.action = "Close on her hands opening @product (2–4s)";
    const outcome = byId(runPlanChecks(plan, 15, []), "no_timestamps");
    expect(outcome.passed).toBe(false);
    expect(outcome.shots).toEqual([3]);
  });

  it("no_timestamps catches seconds words, clock times and sound lines", () => {
    for (const text of ["for 3 seconds", "hold 2.5 sec", "at 0:04", "for 4s"]) {
      const plan = boardPlan();
      plan.shots[0]!.sound = text;
      const outcome = byId(runPlanChecks(plan, 15, []), "no_timestamps");
      expect(outcome.passed, text).toBe(false);
      expect(outcome.shots).toEqual([1]);
    }
  });

  it("nothing_ruled_out fails on a whole-word, case-insensitive match and names the shot", () => {
    const plan = boardPlan();
    plan.shots[3]!.action = "@maya smiles and sets @product down in @kitchen beside a Dog";
    const outcome = byId(runPlanChecks(plan, 15, [" dog "]), "nothing_ruled_out");
    expect(outcome.passed).toBe(false);
    expect(outcome.shots).toEqual([4]);
  });

  it("nothing_ruled_out ignores partial words and checks style, scene and assets", () => {
    const plan = boardPlan();
    expect(byId(runPlanChecks(plan, 15, ["car"]), "nothing_ruled_out").passed).toBe(true);
    expect(byId(runPlanChecks(plan, 15, ["warm"]), "nothing_ruled_out").passed).toBe(false);
    expect(byId(runPlanChecks(plan, 15, ["quiet"]), "nothing_ruled_out").passed).toBe(false);
    expect(byId(runPlanChecks(plan, 15, ["wooden"]), "nothing_ruled_out").passed).toBe(false);
  });
});

describe("runPromptChecks", () => {
  it("passes the board example", () => {
    const outcomes = runPromptChecks(boardPlan(), boardCameras());
    expect(outcomes.map((o) => o.id)).toEqual(["camera_per_shot", "light_has_direction"]);
    expect(outcomes.every((o) => o.passed && o.owner === "cinematographer")).toBe(true);
  });

  it("camera_per_shot fails with shots [4] when 3 cameras cover 4 shots", () => {
    const outcome = runPromptChecks(boardPlan(), boardCameras().slice(0, 3))[0]!;
    expect(outcome.id).toBe("camera_per_shot");
    expect(outcome.passed).toBe(false);
    expect(outcome.shots).toEqual([4]);
  });

  it("camera_per_shot fails on a duplicate or an extra camera number", () => {
    const dup = boardCameras();
    dup[3]!.shot = 3;
    const dupOutcome = runPromptChecks(boardPlan(), dup)[0]!;
    expect(dupOutcome.passed).toBe(false);
    expect(dupOutcome.shots).toEqual([3, 4]);

    const extra = [...boardCameras(), { ...boardCameras()[0]!, shot: 5 }];
    const extraOutcome = runPromptChecks(boardPlan(), extra)[0]!;
    expect(extraOutcome.passed).toBe(false);
    expect(extraOutcome.shots).toEqual([5]);
  });

  it("light_has_direction fails on a light with no direction", () => {
    const cameras = boardCameras();
    cameras[1]!.light = "soft light";
    const outcome = runPromptChecks(boardPlan(), cameras)[1]!;
    expect(outcome.id).toBe("light_has_direction");
    expect(outcome.passed).toBe(false);
    expect(outcome.shots).toEqual([2]);
  });

  it("light_has_direction accepts each direction word", () => {
    for (const light of ["from the window", "overhead glow", "backlit haze", "lit from below"]) {
      const cameras = boardCameras();
      cameras[0]!.light = light;
      expect(runPromptChecks(boardPlan(), cameras)[1]!.passed, light).toBe(true);
    }
  });
});
