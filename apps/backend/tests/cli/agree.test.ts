import { describe, expect, it } from "vitest";
import type { KappaResult } from "../../src/agreement/kappa.js";
import { formatCheckLine, formatOverallLine } from "../../src/cli/agree.js";

// A degenerate kappa (both raters agree on every item -- no variance to
// measure agreement over) must render distinguishably from a normal one:
// see kappa.ts's comment and agree.ts's own comment on why a bare "kappa
// 1.000" would overstate a 3-item no-variance check as reliable.
function kappaResult(overrides: Partial<KappaResult>): KappaResult {
  return {
    kappa: 0.72,
    observed: 0.9,
    expected: 0.64,
    n: 40,
    degenerate: false,
    table: { bothPass: 10, bothFail: 26, humanPassAgentFail: 2, humanFailAgentPass: 2 },
    ...overrides,
  };
}

describe("formatCheckLine", () => {
  it("prints n and no degeneracy marker for a normal result", () => {
    const line = formatCheckLine("wardrobe", kappaResult({ kappa: 0.72, n: 40, degenerate: false }));
    expect(line).toContain("n=40");
    expect(line).not.toContain("degenerate");
  });

  it("marks a degenerate result distinctly, including its n", () => {
    const line = formatCheckLine(
      "no_real_person",
      kappaResult({ kappa: 1, observed: 1, expected: 1, n: 3, degenerate: true }),
    );
    expect(line).toContain("n=3");
    expect(line).toContain("degenerate");
  });

  it("reports an unmeasured check as unmeasured, not as a fabricated result", () => {
    const line = formatCheckLine("hair_spec", undefined);
    expect(line).toContain("unmeasured");
    expect(line).not.toContain("degenerate");
  });
});

describe("formatOverallLine", () => {
  it("prints n and no degeneracy marker for a normal result", () => {
    const line = formatOverallLine(kappaResult({ kappa: 0.72, n: 120, degenerate: false }));
    expect(line).toContain("n=120");
    expect(line).not.toContain("degenerate");
  });

  it("marks a degenerate overall result distinctly", () => {
    const line = formatOverallLine(kappaResult({ kappa: 1, observed: 1, expected: 1, n: 3, degenerate: true }));
    expect(line).toContain("n=3");
    expect(line).toContain("degenerate");
  });
});
