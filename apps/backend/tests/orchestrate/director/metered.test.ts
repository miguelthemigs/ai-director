import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ParseTransport } from "../../../src/api/client.js";
import { tokenMicroUsd } from "../../../src/api/pricing.js";
import { meter } from "../../../src/orchestrate/director/metered.js";

const args = { system: "s", user: "u", schema: z.object({}) };
const usage = { inputTokens: 100, outputTokens: 50 };

describe("meter", () => {
  it("records model, tokens, version and latency for each call", async () => {
    let t = 0;
    const fake: ParseTransport = async () => ({ parsed_output: {}, usage, model: "claude-opus-5" });
    const m = meter(fake, "v1", () => (t += 25));
    await m.transport(args);
    expect(m.calls()).toEqual([
      { model: "claude-opus-5", promptVersion: "v1", inputTokens: 100, outputTokens: 50,
        microUsd: tokenMicroUsd("claude-opus-5", usage), latencyMs: 25 },
    ]);
  });
  it("a served fallback model is logged as what actually served it", async () => {
    const fake: ParseTransport = async () => ({ parsed_output: {}, usage, model: "claude-sonnet-5" });
    const m = meter(fake, "v1", () => 0);
    await m.transport(args);
    expect(m.calls()[0]?.model).toBe("claude-sonnet-5");
  });
  it("a date-suffixed served id is priced, and logged as the id that served it", async () => {
    const fake: ParseTransport = async () => ({ parsed_output: {}, usage, model: "claude-opus-5-20261001" });
    const m = meter(fake, "v1", () => 0);
    await m.transport(args);
    expect(m.calls()[0]).toMatchObject({
      model: "claude-opus-5-20261001",
      microUsd: tokenMicroUsd("claude-opus-5", usage),
    });
  });
  it("a transport that reports nothing logs unknown model and null tokens and cost", async () => {
    const m = meter(async () => ({ parsed_output: {} }), "v1", () => 0);
    await m.transport(args);
    expect(m.calls()[0]).toMatchObject({ model: "unknown", inputTokens: null, outputTokens: null, microUsd: null });
  });
  it("a throwing transport is still logged, and the original error propagates", async () => {
    let t = 0;
    const boom = new Error("boom");
    const m = meter(async () => { throw boom; }, "v1", () => (t += 40));
    await expect(m.transport(args)).rejects.toBe(boom);
    expect(m.calls()).toEqual([
      { model: "unknown", promptVersion: "v1", inputTokens: null, outputTokens: null, microUsd: null, latencyMs: 40 },
    ]);
  });
});
