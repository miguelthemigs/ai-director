import { describe, expect, it } from "vitest";
import { cohensKappa } from "../../src/agreement/kappa.js";

describe("cohensKappa", () => {
  it("is 1 for perfect agreement", () => {
    const pairs = [
      { human: true, agent: true },
      { human: false, agent: false },
      { human: true, agent: true },
      { human: false, agent: false },
    ];
    expect(cohensKappa(pairs).kappa).toBeCloseTo(1, 10);
  });

  it("is 0 when agreement is only what chance predicts", () => {
    const pairs = [
      { human: true, agent: true },
      { human: true, agent: false },
      { human: false, agent: true },
      { human: false, agent: false },
    ];
    expect(cohensKappa(pairs).kappa).toBeCloseTo(0, 10);
  });

  it("is negative when agreement is worse than chance", () => {
    const pairs = [
      { human: true, agent: false },
      { human: true, agent: false },
      { human: false, agent: true },
      { human: false, agent: true },
    ];
    expect(cohensKappa(pairs).kappa).toBeLessThan(0);
  });

  it("reports the confusion table and n", () => {
    const out = cohensKappa([
      { human: true, agent: true },
      { human: true, agent: false },
      { human: false, agent: false },
    ]);
    expect(out.n).toBe(3);
    expect(out.table).toEqual({
      bothPass: 1,
      bothFail: 1,
      humanPassAgentFail: 1,
      humanFailAgentPass: 0,
    });
  });

  it("throws on an empty sample instead of returning NaN", () => {
    expect(() => cohensKappa([])).toThrow(/no pairs/);
  });
});
