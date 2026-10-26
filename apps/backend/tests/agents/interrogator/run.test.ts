import type { FilledBrief } from "@ai-director/contract";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import {
  buildInterrogatorSystemPrompt,
  INTERROGATOR_PROMPT_VERSION,
} from "../../../src/agents/interrogator/prompt-v1.js";
import { interrogate } from "../../../src/agents/interrogator/run.js";
import { InterrogatorOutputSchema } from "../../../src/agents/interrogator/schema.js";

const BRIEF = "cool ad for my headphones, 15 seconds";

function cannedOutput(overrides: Record<string, unknown> = {}) {
  return {
    productKind: "wireless over-ear headphones",
    audience: "city renters in their twenties who sleep badly",
    tone: "calm, quietly confident",
    setting: "a small city apartment at dawn",
    character: "a man in his late twenties who works nights",
    suggestedSeconds: 15,
    ...overrides,
  };
}

describe("interrogate", () => {
  it("sends the brief once and returns a filled brief carrying the brief verbatim", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: cannedOutput() });
    const filled = await interrogate({ transport }, { brief: BRIEF });

    expect(filled).toEqual({ brief: BRIEF, ...cannedOutput() });
    expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0]![0] as { system: string; user: string; schema: unknown };
    expect(call.system).toBe(buildInterrogatorSystemPrompt());
    expect(call.user).toContain(BRIEF);
    expect(call.schema).toBe(InterrogatorOutputSchema);
  });

  it("takes the brief from the caller, never from the model", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue({ parsed_output: { ...cannedOutput(), brief: "a rewritten brief" } });
    const filled = await interrogate({ transport }, { brief: BRIEF });
    expect(filled.brief).toBe(BRIEF);
  });

  it("throws when the parse comes back empty", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(interrogate({ transport }, { brief: BRIEF })).rejects.toThrow(/interrogator/i);
  });

  it("throws when a field is missing", async () => {
    const { audience: _dropped, ...withoutAudience } = cannedOutput();
    const transport = vi.fn().mockResolvedValue({ parsed_output: withoutAudience });
    await expect(interrogate({ transport }, { brief: BRIEF })).rejects.toThrow();
  });

  it("throws when a field is blank, because the Interrogator decides and never leaves a gap", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: cannedOutput({ setting: "  " }) });
    await expect(interrogate({ transport }, { brief: BRIEF })).rejects.toThrow(/setting/);
  });

  it("keeps a suggested length Seedance can render and drops one it cannot", async () => {
    const keep = vi.fn().mockResolvedValue({ parsed_output: cannedOutput({ suggestedSeconds: 30 }) });
    expect((await interrogate({ transport: keep }, { brief: BRIEF })).suggestedSeconds).toBe(30);

    const tooLong = vi.fn().mockResolvedValue({ parsed_output: cannedOutput({ suggestedSeconds: 60 }) });
    expect((await interrogate({ transport: tooLong }, { brief: BRIEF })).suggestedSeconds).toBeNull();

    const none = vi.fn().mockResolvedValue({ parsed_output: cannedOutput({ suggestedSeconds: null }) });
    expect((await interrogate({ transport: none }, { brief: BRIEF })).suggestedSeconds).toBeNull();
  });
});

describe("interrogator prompt v1", () => {
  it("is version v1", () => {
    expect(INTERROGATOR_PROMPT_VERSION).toBe("v1");
  });

  it("decides the craft questions itself and never asks", () => {
    const prompt = buildInterrogatorSystemPrompt();
    expect(prompt).toMatch(/never ask/i);
    for (const field of ["audience", "tone", "setting", "character"]) expect(prompt).toContain(field);
  });

  it("fills productKind with what kind of thing the product is, never what it looks like", () => {
    const prompt = buildInterrogatorSystemPrompt();
    expect(prompt).toMatch(/what kind of thing/i);
    expect(prompt).toMatch(/never what it looks like/i);
  });

  it("allows no brand names", () => {
    expect(buildInterrogatorSystemPrompt()).toMatch(/no brand names/i);
  });
});

describe("interrogator schema", () => {
  it("parses to the contract's FilledBrief, less the brief that code carries", () => {
    expectTypeOf<z.infer<typeof InterrogatorOutputSchema>>().toEqualTypeOf<Omit<FilledBrief, "brief">>();
  });
});
