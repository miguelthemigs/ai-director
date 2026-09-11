import { describe, expect, it } from "vitest";
import { cohensKappa } from "../../src/agreement/kappa.js";

describe("cohensKappa", () => {
  it("is 1 for perfect agreement, and is not marked degenerate", () => {
    const pairs = [
      { human: true, agent: true },
      { human: false, agent: false },
      { human: true, agent: true },
      { human: false, agent: false },
    ];
    const out = cohensKappa(pairs);
    expect(out.kappa).toBeCloseTo(1, 10);
    expect(out.degenerate).toBe(false);
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

  it("marks the degenerate case when both raters agree on everything and expected is 1", () => {
    // Both raters pass every item: no variance to measure agreement over,
    // so expected == 1 and the usual division would be 0/0.
    const out = cohensKappa([
      { human: true, agent: true },
      { human: true, agent: true },
      { human: true, agent: true },
    ]);
    expect(out.expected).toBe(1);
    expect(out.kappa).toBe(1);
    expect(out.degenerate).toBe(true);

    // Both raters fail every item is the same degenerate case from the
    // other side.
    const bothFail = cohensKappa([
      { human: false, agent: false },
      { human: false, agent: false },
    ]);
    expect(bothFail.expected).toBe(1);
    expect(bothFail.degenerate).toBe(true);
  });
});
