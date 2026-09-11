import { describe, expect, it } from "vitest";
import { hasNegativeConstraint, NEGATIVE_CONSTRAINT_PATTERNS } from "../../src/enforce/invariants.js";

describe("hasNegativeConstraint", () => {
  it("accepts the canonical continuity line", () => {
    expect(
      hasNegativeConstraint(
        "Male, 30, lean. Continuity: characters, props, environment identical across every cut. No identity drift.",
      ),
    ).toBe(true);
  });

  it("accepts the shorter form that names identity drift alone", () => {
    expect(hasNegativeConstraint("Male, 30, lean. No identity drift between shots.")).toBe(true);
  });

  it("is case and whitespace insensitive, because writers do not retype it exactly", () => {
    expect(hasNegativeConstraint("male, 30.  NO   IDENTITY   DRIFT.")).toBe(true);
  });

  it("rejects a description with no negative constraint at all", () => {
    expect(hasNegativeConstraint("Male, Latino, around 30, lean and tall.")).toBe(false);
  });

  it("does not accept the mere word continuity without the constraint", () => {
    expect(hasNegativeConstraint("He has continuity of style across his wardrobe.")).toBe(false);
  });

  it("exposes the patterns it matched on, so the UI can say which form it found", () => {
    expect(NEGATIVE_CONSTRAINT_PATTERNS.length).toBeGreaterThan(0);
  });
});
