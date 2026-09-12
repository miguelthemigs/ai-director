import { describe, expect, it } from "vitest";
import { bandToPercent, isPass, PASS_BAND } from "../../src/enforce/score.js";

describe("band scoring", () => {
  it("maps every band to its fixed percentage", () => {
    expect([1, 2, 3, 4, 5].map((b) => bandToPercent(b as 1))).toEqual([20, 40, 60, 80, 100]);
  });

  it("passes at band 4 and above only", () => {
    expect(PASS_BAND).toBe(4);
    expect([1, 2, 3].every((b) => isPass(b))).toBe(false);
    expect(isPass(4)).toBe(true);
    expect(isPass(5)).toBe(true);
  });

  it("rejects a band outside 1 to 5", () => {
    expect(() => bandToPercent(0 as 1)).toThrow(/band must be 1-5/);
    expect(() => bandToPercent(6 as 1)).toThrow(/band must be 1-5/);
  });
});
