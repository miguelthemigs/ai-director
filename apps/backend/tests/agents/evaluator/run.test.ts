import { describe, expect, it, vi } from "vitest";
import { evaluateAllGroups, evaluateGroup } from "../../../src/agents/evaluator/run.js";
import { loadRubric } from "../../../src/rubric/load.js";

const ok = (results: unknown) => vi.fn().mockResolvedValue({ parsed_output: { results } });

describe("evaluateGroup", () => {
  it("returns the parsed results", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([
      { checkId: "no_real_person", band: 5, reason: "No real person.", quotes: [] },
      { checkId: "no_brand_name", band: 5, reason: "No brand.", quotes: [] },
    ]);
    const out = await evaluateGroup({ transport }, { rubric, group: "safety", description: "x" });
    expect(out.results).toHaveLength(2);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("throws when parsing failed rather than returning null", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/parse failed/);
  });

  it("throws when the model scores a check outside the group", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([{ checkId: "hair_spec", band: 5, reason: "r", quotes: [] }]);
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/unexpected checkId hair_spec/);
  });

  it("throws when a check of the group is missing", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([{ checkId: "no_brand_name", band: 5, reason: "r", quotes: [] }]);
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/missing result for no_real_person/);
  });
});

describe("evaluateAllGroups", () => {
  it("runs three calls and returns nine results", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn(async ({ system }: { system: string }) => ({
      parsed_output: {
        results: rubric.checks
          .filter((check) => system.includes(`Check ${check.id} `))
          .map((check) => ({ checkId: check.id, band: 5, reason: "r", quotes: [] })),
      },
    }));
    const results = await evaluateAllGroups({ transport }, { rubric, description: "x" });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(9);
  });

  const passingResultsFor = (rubric: Awaited<ReturnType<typeof loadRubric>>, system: string) =>
    rubric.checks
      .filter((check) => system.includes(`Check ${check.id} `))
      .map((check) => ({ checkId: check.id, band: 5, reason: "r", quotes: [] }));

  it("survives a rejecting transport for one group: other groups stay scored, the failed group is not_evaluated", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn(async ({ system }: { system: string }) => {
      if (system.includes("Check no_real_person ")) {
        throw new Error("network error");
      }
      return { parsed_output: { results: passingResultsFor(rubric, system) } };
    });
    const results = await evaluateAllGroups({ transport }, { rubric, description: "x" });
    expect(results).toHaveLength(9);
    const safety = results.filter((r) => r.checkId === "no_real_person" || r.checkId === "no_brand_name");
    expect(safety.every((r) => r.status === "not_evaluated")).toBe(true);
    const others = results.filter((r) => r.checkId !== "no_real_person" && r.checkId !== "no_brand_name");
    expect(others).toHaveLength(7);
    expect(others.every((r) => r.status === "scored")).toBe(true);
  });

  it("survives a null parse for one group: other groups stay scored, the failed group is not_evaluated", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn(async ({ system }: { system: string }) => {
      if (system.includes("Check no_real_person ")) {
        return { parsed_output: null };
      }
      return { parsed_output: { results: passingResultsFor(rubric, system) } };
    });
    const results = await evaluateAllGroups({ transport }, { rubric, description: "x" });
    expect(results).toHaveLength(9);
    const safety = results.filter((r) => r.checkId === "no_real_person" || r.checkId === "no_brand_name");
    expect(safety.every((r) => r.status === "not_evaluated")).toBe(true);
    expect(results.some((r) => r.status === "scored" && r.band < 4)).toBe(false);
  });

  it("marks a scored check with a failing band and no quotes as missingEvidence, not a failure", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn(async ({ system }: { system: string }) => {
      if (system.includes("Check wardrobe ")) {
        return {
          parsed_output: {
            results: rubric.checks
              .filter((check) => system.includes(`Check ${check.id} `))
              .map((check) =>
                check.id === "wardrobe"
                  ? { checkId: "wardrobe", band: 3, reason: "Footwear missing.", quotes: [] }
                  : { checkId: check.id, band: 5, reason: "r", quotes: [] },
              ),
          },
        };
      }
      return { parsed_output: { results: passingResultsFor(rubric, system) } };
    });
    const results = await evaluateAllGroups({ transport }, { rubric, description: "x" });
    expect(results).toHaveLength(9);
    const wardrobe = results.find((r) => r.checkId === "wardrobe");
    expect(wardrobe).toMatchObject({ status: "scored", band: 3, missingEvidence: true });
    expect(results.every((r) => r.status !== "not_evaluated")).toBe(true);
  });
});
