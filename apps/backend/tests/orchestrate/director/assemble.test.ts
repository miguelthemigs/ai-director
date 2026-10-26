import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Camera, CharacterOutcome, ReferenceImage } from "@ai-director/contract";
import { SEEDANCE_PROMPT_CHAR_CAP } from "@ai-director/contract";
import { AssemblyInvariantError, assembleSeedancePrompt } from "../../../src/orchestrate/director/assemble.js";
import {
  ASSEMBLE_PROMPT_VERSION,
  CLOSING_LINE,
} from "../../../src/orchestrate/director/assemblePrompt/v1.js";
import { boardCameras, boardPlan } from "./planFixture.js";

const references = (): ReferenceImage[] => [
  { slot: 1, handle: "@product", kind: "product", url: "https://x/p.png", asset: "product.png" },
  { slot: 2, handle: "@kitchen", kind: "location", url: "https://x/k.png", asset: "kitchen.png" },
];
const character = (description = "Maya, thirties, dark curly hair, linen shirt"): CharacterOutcome => ({
  avatarId: "maya",
  coachRunId: "run-1",
  status: "passed",
  description,
  passed: true,
});
const productRef = (): ReferenceImage => references()[0] as ReferenceImage;
const build = (over: Partial<Parameters<typeof assembleSeedancePrompt>[0]> = {}) =>
  assembleSeedancePrompt({
    plan: boardPlan(),
    cameras: boardCameras(),
    character: character(),
    references: references(),
    ...over,
  });

describe("assembleSeedancePrompt", () => {
  it("is version v1", () => expect(ASSEMBLE_PROMPT_VERSION).toBe("v1"));

  it("writes the six parts in order, joined by a blank line", () => {
    const plan = boardPlan();
    const { text } = build();
    const parts = text.split("\n\n");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe(
      [
        "The first reference image is the product (@product).",
        "The second reference image is the a bright home kitchen with a wooden counter (@kitchen).",
      ].join("\n"),
    );
    expect(parts[1]).toBe(plan.styleLine);
    expect(parts[2]).toBe("HERO (@maya): Maya, thirties, dark curly hair, linen shirt");
    expect(parts[3]).toBe(`Scene: ${plan.scene}`);
    expect(parts[4]?.split("\n")).toHaveLength(4);
    expect(parts[4]?.split("\n")[0]).toBe(
      "Shot 1: medium shot, 35mm, static, soft window light from the left. @maya walks into @kitchen and reaches for @product footsteps, a kettle",
    );
    expect(parts[5]).toBe(CLOSING_LINE);
    expect(CLOSING_LINE).toBe("Keep it subtitle-free, do not generate a logo or watermark.");
    expect(text.indexOf(plan.styleLine)).toBeGreaterThan(-1);
  });

  it("matches cameras by shot number, not array order", () => {
    const cameras = boardCameras().reverse();
    cameras[3] = { ...(cameras[3] as Camera), framing: "wide shot" }; // shot 1
    expect(build({ cameras }).text).toContain("Shot 1: wide shot,");
  });

  it("throws when a shot has no camera", () => {
    expect(() => build({ cameras: boardCameras().slice(0, 3) })).toThrow(AssemblyInvariantError);
  });

  it("throws on an over-long character description", () => {
    expect(() => build({ character: character("x".repeat(SEEDANCE_PROMPT_CHAR_CAP)) })).toThrow(
      AssemblyInvariantError,
    );
  });

  it("throws on more than five references or an unknown kind", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...productRef(), slot: i + 1 }));
    expect(() => build({ references: six })).toThrow(AssemblyInvariantError);
    const bad = [{ ...productRef(), kind: "character" as never }];
    expect(() => build({ references: bad })).toThrow(AssemblyInvariantError);
  });

  it("throws when a reference handle is not a plan asset", () => {
    expect(() => build({ references: [{ ...productRef(), handle: "@ghost" }] })).toThrow(
      AssemblyInvariantError,
    );
  });

  it("is deterministic and hashes the UTF-8 text", () => {
    const a = build();
    expect(build().sha256).toBe(a.sha256);
    expect(a.sha256).toBe(createHash("sha256").update(a.text, "utf8").digest("hex"));
    expect(a.references).toEqual(references());
  });
});
