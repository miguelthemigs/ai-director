import { describe, expect, it } from "vitest";
import { buildAgreementReport } from "../../src/agreement/report.js";

const items = [
  { id: "d1", description: "x", marks: { wardrobe: true, drawable_only: false } },
  { id: "d2", description: "y", marks: { wardrobe: false, drawable_only: false } },
];

describe("buildAgreementReport", () => {
  it("reports kappa per check and overall", () => {
    const report = buildAgreementReport(
      items,
      {
        d1: { wardrobe: true, drawable_only: false },
        d2: { wardrobe: false, drawable_only: false },
      },
      ["wardrobe", "drawable_only"],
    );
    expect(report.perCheck.wardrobe!.kappa).toBeCloseTo(1, 10);
    expect(report.overall.n).toBe(4);
  });

  it("lists every disagreement with the item id and check", () => {
    const report = buildAgreementReport(
      items,
      {
        d1: { wardrobe: false, drawable_only: false },
        d2: { wardrobe: false, drawable_only: false },
      },
      ["wardrobe", "drawable_only"],
    );
    expect(report.disagreements).toEqual([
      { itemId: "d1", checkId: "wardrobe", human: true, agent: false },
    ]);
  });

  it("throws when an item was never scored by the agent", () => {
    expect(() => buildAgreementReport(items, { d1: { wardrobe: true } }, ["wardrobe"])).toThrow(
      /no agent marks for d2/,
    );
  });
});
