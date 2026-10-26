import { describe, expect, it } from "vitest";
import { MICRO_USD_PER_IMAGE, tokenMicroUsd } from "../../src/api/pricing.js";

describe("pricing", () => {
  it("an unknown model costs null, never 0", () => {
    expect(tokenMicroUsd("not-a-model", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it("prices claude-opus-5 at $5 in / $25 out per million tokens", () => {
    expect(tokenMicroUsd("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(30_000_000);
  });
  it("prices a date-suffixed served id at its model's rate", () => {
    const usage = { inputTokens: 1_000, outputTokens: 1_000 };
    expect(tokenMicroUsd("claude-opus-5-20261001", usage)).toBe(tokenMicroUsd("claude-opus-5", usage));
    expect(tokenMicroUsd("claude-sonnet-5-20260915", usage)).toBe(tokenMicroUsd("claude-sonnet-5", usage));
  });
  it("strips only a trailing eight-digit date", () => {
    expect(tokenMicroUsd("claude-opus-5-2026", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(tokenMicroUsd("claude-opus-5-20261001-x", { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
  it("records a per-image rate for gemini-3-pro-image", () => {
    expect(MICRO_USD_PER_IMAGE["gemini-3-pro-image"]).toBeGreaterThan(0);
  });
});
