import {
  DIRECTOR_CHECK_LABELS,
  LENGTH_TOLERANCE_SECONDS,
  SHOT_WEIGHT_SECONDS,
  type CheckOutcome,
  type FilledBrief,
  type GateAAnswers,
  type Plan,
} from "@ai-director/contract";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import {
  buildDirectorPatchSystemPrompt,
  buildDirectorSystemPrompt,
  DIRECTOR_EXAMPLE_PLAN,
  DIRECTOR_EXAMPLE_SECONDS,
  DIRECTOR_PROMPT_VERSION,
  DIRECTOR_V1_CHECK_LABELS,
  renderDirectorRequest,
} from "../../../src/agents/director/prompt-v1.js";
import { direct, patchPlan, PlanPatchError } from "../../../src/agents/director/run.js";
import { DirectorPlanSchema } from "../../../src/agents/director/schema.js";
import { runPlanChecks } from "../../../src/orchestrate/director/checks.js";
import { boardPlan } from "../../orchestrate/director/planFixture.js";

const brief: FilledBrief = {
  brief: "cool ad for my sparkling water",
  productKind: "a glass bottle of sparkling water",
  audience: "people who work from home",
  tone: "warm and unhurried",
  setting: "a bright home kitchen in the morning",
  character: "a woman in her thirties starting her day",
  suggestedSeconds: null,
};
const answers: GateAAnswers = {
  productPhotoAsset: "product-photo.png",
  productKind: "a can of sparkling water",
  seconds: 15,
  mustNotAppear: ["dogs", "coffee"],
  cast: { kind: "avatar", avatarId: "avatar-1" },
};

function fakeReturning(plan: unknown) {
  return vi.fn().mockResolvedValue({ parsed_output: plan });
}

describe("direct", () => {
  it("returns the plan the model wrote", async () => {
    const transport = fakeReturning(boardPlan());
    expect(await direct({ transport }, { brief, answers })).toEqual(boardPlan());
    const call = transport.mock.calls[0]![0] as { system: string; schema: unknown };
    expect(call.system).toBe(buildDirectorSystemPrompt());
    expect(call.schema).toBe(DirectorPlanSchema);
  });

  it("tells the model the brief, the owner's product kind, the length, what is ruled out and the cast", async () => {
    const transport = fakeReturning(boardPlan());
    await direct({ transport }, { brief, answers });
    const { user } = transport.mock.calls[0]![0] as { user: string };
    for (const text of [brief.brief, brief.audience, brief.tone, brief.setting, brief.character]) {
      expect(user).toContain(text);
    }
    // Gate A's product kind is the owner's word on it, and wins over the Interrogator's.
    expect(user).toContain(answers.productKind);
    expect(user).not.toContain(brief.productKind);
    expect(user).toContain("15");
    expect(user).toContain("dogs");
    expect(user).toContain("coffee");
    expect(user).toMatch(/existing/i);
  });

  it("says when a new person is to be cast from the plan's description", async () => {
    const transport = fakeReturning(boardPlan());
    await direct({ transport }, { brief, answers: { ...answers, mustNotAppear: [], cast: { kind: "new" } } });
    const { user } = transport.mock.calls[0]![0] as { user: string };
    expect(user).toMatch(/new person/i);
    expect(user).toMatch(/nothing is ruled out/i);
  });

  it("throws when the parse comes back empty", async () => {
    await expect(direct({ transport: fakeReturning(null) }, { brief, answers })).rejects.toThrow(/director/i);
  });

  it("throws on a weight outside short, normal and long", async () => {
    const plan = boardPlan() as unknown as { shots: Array<{ weight: string }> };
    plan.shots[0]!.weight = "medium";
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).rejects.toThrow();
  });

  it("throws unless there is exactly one product, one location and one character", async () => {
    const twoLocations = boardPlan();
    twoLocations.assets.push({ handle: "@garden", kind: "location", description: "a small garden" });
    await expect(direct({ transport: fakeReturning(twoLocations) }, { brief, answers })).rejects.toThrow(
      /location/,
    );

    const noProduct = boardPlan();
    noProduct.assets = noProduct.assets.filter((asset) => asset.kind !== "product");
    await expect(direct({ transport: fakeReturning(noProduct) }, { brief, answers })).rejects.toThrow(
      /product/,
    );
  });

  it("lower-cases an upper-case handle and every mention of it, instead of failing", async () => {
    const plan = boardPlan();
    plan.assets[1]!.handle = "@Kitchen";
    plan.scene = "@maya in @KITCHEN on a quiet morning, @product on the counter.";
    plan.shots[0]!.action = "@maya walks into @Kitchen and reaches for @product";
    plan.shots[3]!.sound = "the hum of @kitchen";
    const result = await direct({ transport: fakeReturning(plan) }, { brief, answers });
    expect(result.assets[1]!.handle).toBe("@kitchen");
    expect(result.scene).toBe("@maya in @kitchen on a quiet morning, @product on the counter.");
    expect(result.shots[0]!.action).toBe("@maya walks into @kitchen and reaches for @product");
    expect(result.shots[3]!.sound).toBe("the hum of @kitchen");
  });

  it("leaves an undeclared mention alone and touches only whole handles", async () => {
    const plan = boardPlan();
    plan.assets[1]!.handle = "@Kitchen";
    plan.shots[1]!.action = "She lifts @product near @Kitchenette and @Dog";
    const result = await direct({ transport: fakeReturning(plan) }, { brief, answers });
    expect(result.shots[1]!.action).toBe("She lifts @product near @Kitchenette and @Dog");
  });

  it("still throws on a handle with characters other than letters, digits or _", async () => {
    const plan = boardPlan();
    plan.assets[1]!.handle = "@my-kitchen";
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).rejects.toThrow(/@my-kitchen/);
  });

  it("throws on a handle declared twice", async () => {
    const plan = boardPlan();
    plan.assets[2]!.handle = "@kitchen";
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).rejects.toThrow(/@kitchen/);
  });

  it("throws on a character with no description, which no plan check covers", async () => {
    const plan = boardPlan();
    plan.assets[2]!.description = " ";
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).rejects.toThrow(/@maya/);
  });

  it("throws on a plan with no shots", async () => {
    const plan = { ...boardPlan(), shots: [] };
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).rejects.toThrow(/shot/);
  });

  it("leaves what the code checks route back (an undeclared handle, a timestamp) to the checks", async () => {
    const plan = boardPlan();
    plan.shots[1]!.action = "She lifts @bottle for 2 seconds";
    await expect(direct({ transport: fakeReturning(plan) }, { brief, answers })).resolves.toEqual(plan);
  });
});

const failures: CheckOutcome[] = [
  {
    id: "no_timestamps",
    passed: false,
    owner: "director",
    detail: "timestamps or seconds in shot 2",
    shots: [2],
  },
];

describe("patchPlan", () => {
  it("returns the patched plan when every asset is untouched", async () => {
    const patched = boardPlan();
    patched.shots[1]!.action = "She lifts @product and reads the label slowly";
    const transport = fakeReturning(patched);
    expect(await patchPlan({ transport }, { plan: boardPlan(), failures, brief, answers })).toEqual(patched);

    const call = transport.mock.calls[0]![0] as { system: string; user: string };
    expect(call.system).toBe(buildDirectorPatchSystemPrompt());
    expect(call.user).toContain("timestamps or seconds in shot 2");
    expect(call.user).toContain(boardPlan().shots[1]!.action);
    expect(call.user).toContain(answers.productKind);
  });

  it("accepts a patch that rewrites an asset's description", async () => {
    const patched = boardPlan();
    patched.assets[1]!.description = "a dark industrial kitchen";
    expect(
      await patchPlan({ transport: fakeReturning(patched) }, { plan: boardPlan(), failures, brief, answers }),
    ).toEqual(patched);
  });

  it("compares handles after lower-casing, so a capitalised copy of a handle is not a change", async () => {
    const patched = boardPlan();
    patched.assets[1]!.handle = "@Kitchen";
    const result = await patchPlan({ transport: fakeReturning(patched) }, { plan: boardPlan(), failures, brief, answers });
    expect(result.assets[1]!.handle).toBe("@kitchen");
  });

  it("refuses a patch that changes an asset's handle or kind", async () => {
    const renamed = boardPlan();
    renamed.assets[0]!.handle = "@can";
    await expect(
      patchPlan({ transport: fakeReturning(renamed) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toBeInstanceOf(PlanPatchError);

    const rekinded = boardPlan();
    rekinded.assets[2]!.kind = "product";
    await expect(
      patchPlan({ transport: fakeReturning(rekinded) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toBeInstanceOf(PlanPatchError);
  });

  it("refuses a patch that adds, removes or reorders an asset", async () => {
    const added = boardPlan();
    added.assets.push({ handle: "@mug", kind: "product", description: "a mug" });
    await expect(
      patchPlan({ transport: fakeReturning(added) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toBeInstanceOf(PlanPatchError);

    const removed = boardPlan();
    removed.assets.pop();
    await expect(
      patchPlan({ transport: fakeReturning(removed) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toBeInstanceOf(PlanPatchError);

    const reordered = boardPlan();
    reordered.assets.reverse();
    await expect(
      patchPlan({ transport: fakeReturning(reordered) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toBeInstanceOf(PlanPatchError);
  });

  it("names the asset that changed", async () => {
    const patched = boardPlan();
    patched.assets[1]!.kind = "product";
    await expect(
      patchPlan({ transport: fakeReturning(patched) }, { plan: boardPlan(), failures, brief, answers }),
    ).rejects.toThrow(/@kitchen/);
  });
});

describe("director prompt v1", () => {
  it("is version v1", () => {
    expect(DIRECTOR_PROMPT_VERSION).toBe("v1");
  });

  it("allows no timestamps or seconds, only the three weights", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toMatch(/never write seconds|no timestamps/i);
    for (const weight of ["short", "normal", "long"]) expect(prompt).toContain(`"${weight}"`);
  });

  // v1's numbers and labels are literal text. If a contract constant changes, these
  // fail: the prompt no longer agrees with the code, so ship prompt-v2.
  it("counts each weight, as literal text, exactly as the length check in code does", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toContain("A short counts 2, normal counts 3, long counts 4.");
    expect(SHOT_WEIGHT_SECONDS).toEqual({ short: 2, normal: 3, long: 4 });
    expect(prompt).toContain("give or take 2.");
    expect(LENGTH_TOLERANCE_SECONDS).toBe(2);
  });

  it("states the count range, with v1's literal tolerance, in the request", () => {
    expect(renderDirectorRequest({ brief, answers })).toContain(
      `between ${15 - LENGTH_TOLERANCE_SECONDS} and ${15 + LENGTH_TOLERANCE_SECONDS}.`,
    );
  });

  it("shows the check labels as literal text that still matches the contract", () => {
    expect(DIRECTOR_V1_CHECK_LABELS).toEqual(DIRECTOR_CHECK_LABELS);
  });

  it("freezes the example plan, so nothing can change what v1 says", () => {
    expect(Object.isFrozen(DIRECTOR_EXAMPLE_PLAN)).toBe(true);
    expect(Object.isFrozen(DIRECTOR_EXAMPLE_PLAN.shots)).toBe(true);
    expect(Object.isFrozen(DIRECTOR_EXAMPLE_PLAN.assets[0])).toBe(true);
    expect(() => {
      DIRECTOR_EXAMPLE_PLAN.shots[0]!.weight = "short";
    }).toThrow(TypeError);
  });

  it("asks for ages and decades in words, because the timestamp check reads digits and s as seconds", () => {
    expect(buildDirectorSystemPrompt()).toMatch(/ages and decades in words, never digits/i);
    expect(buildDirectorSystemPrompt()).toContain('"eighties", not "80s"');
    const plan = boardPlan();
    plan.shots[3]!.action = "@maya sets down @product to a song from the 80s";
    const outcome = runPlanChecks(plan, 15, []).find((o) => o.id === "no_timestamps")!;
    expect(outcome.passed).toBe(false);
  });

  it("plans one take, with no 15-second blocks and no cuts across generations", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toMatch(/one take/i);
    expect(prompt).toMatch(/no 15-second blocks/i);
    expect(prompt).toMatch(/no cuts to another generation/i);
  });

  it("writes sound per shot in Seedance syntax", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toMatch(/<[^>]+>/);
    expect(prompt).toMatch(/\([^)]+\)/);
    expect(prompt).toMatch(/\{[^}]+\}/);
    expect(prompt).toMatch(/sound effects in angle brackets/i);
  });

  it("declares one product, one location and one character, with lowercase handles", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toMatch(/one product, one location, one character/i);
    expect(prompt).toMatch(/lowercase/i);
  });

  it("asks for behaviour shown in the body, never stated, and no brand names", () => {
    const prompt = buildDirectorSystemPrompt();
    expect(prompt).toMatch(/shown in the body, never stated/i);
    expect(prompt).toMatch(/no brand names/i);
  });

  it("shows an example plan that passes every plan check in code", () => {
    expect(buildDirectorSystemPrompt()).toContain(DIRECTOR_EXAMPLE_PLAN.styleLine);
    const outcomes = runPlanChecks(DIRECTOR_EXAMPLE_PLAN, DIRECTOR_EXAMPLE_SECONDS, []);
    expect(outcomes.filter((outcome) => !outcome.passed)).toEqual([]);
  });

  it("tells a patch to keep every asset's handle, kind and order, and lets it fix a description", () => {
    const prompt = buildDirectorPatchSystemPrompt();
    expect(prompt.startsWith(buildDirectorSystemPrompt())).toBe(true);
    expect(prompt).toMatch(/never add, remove, reorder or rename an asset/i);
    expect(prompt).toMatch(/rewrite an asset's description only when a failure names it/i);
    expect(prompt).not.toMatch(/never add, remove or change an asset/i);
  });
});

describe("director schema", () => {
  it("parses to the contract's Plan", () => {
    expectTypeOf<z.infer<typeof DirectorPlanSchema>>().toEqualTypeOf<Plan>();
  });
});
