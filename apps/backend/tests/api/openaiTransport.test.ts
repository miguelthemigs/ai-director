import { describe, expect, it } from "vitest";
import { EvaluatorGroupOutputSchema } from "../../src/agents/evaluator/schema.js";
import { createOpenAiTransport, type ResponsesParseClient } from "../../src/api/openaiTransport.js";

// No network anywhere in this file: every test injects a fake satisfying
// `ResponsesParseClient` (just `responses.parse`) as the transport's second
// constructor argument, instead of a real `OpenAI()` client. The real Zod
// schema (not a placeholder object) is used deliberately, so the schema ->
// JSON Schema conversion inside the transport is actually exercised, not
// bypassed -- a fake that ignored the schema entirely would let a broken
// conversion pass silently.

describe("createOpenAiTransport", () => {
  it("returns the same parsed shape as the anthropic transport", async () => {
    const fake: ResponsesParseClient = {
      responses: {
        parse: async () => ({
          output_parsed: { results: [{ checkId: "wardrobe", band: 4, reason: "ok", quotes: [] }] },
        }),
      },
    };
    const transport = createOpenAiTransport("gpt-5.1", fake);
    const out = await transport({ system: "s", user: "u", schema: EvaluatorGroupOutputSchema });
    expect(out.parsed_output).toEqual({
      results: [{ checkId: "wardrobe", band: 4, reason: "ok", quotes: [] }],
    });
  });

  it("returns parsed_output null on a refusal instead of throwing", async () => {
    const fake: ResponsesParseClient = {
      responses: { parse: async () => ({ output_parsed: null, refusal: "no" }) },
    };
    const transport = createOpenAiTransport("gpt-5.1", fake);
    await expect(
      transport({ system: "s", user: "u", schema: EvaluatorGroupOutputSchema }),
    ).resolves.toEqual({ parsed_output: null });
  });

  it("returns parsed_output null when output_parsed is missing (structurally invalid, no refusal)", async () => {
    const fake: ResponsesParseClient = {
      responses: { parse: async () => ({ output_parsed: undefined }) },
    };
    const transport = createOpenAiTransport("gpt-5.1", fake);
    await expect(
      transport({ system: "s", user: "u", schema: EvaluatorGroupOutputSchema }),
    ).resolves.toEqual({ parsed_output: null });
  });

  it("passes the system and user strings through to the client unchanged", async () => {
    let seen: { instructions?: unknown; input?: unknown } = {};
    const fake: ResponsesParseClient = {
      responses: {
        parse: async (params) => {
          seen = params as { instructions?: unknown; input?: unknown };
          return { output_parsed: { results: [] } };
        },
      },
    };
    const transport = createOpenAiTransport("gpt-5.1", fake);
    await transport({
      system: "the system prompt",
      user: "the user description",
      schema: EvaluatorGroupOutputSchema,
    });
    expect(seen.instructions).toBe("the system prompt");
    expect(seen.input).toBe("the user description");
  });

  it("defaults to DEFAULT_OPENAI_MODEL and forwards a model override to the client", async () => {
    const seenModels: string[] = [];
    const fake: ResponsesParseClient = {
      responses: {
        parse: async (params) => {
          seenModels.push((params as { model: string }).model);
          return { output_parsed: { results: [] } };
        },
      },
    };
    await createOpenAiTransport(undefined, fake)({
      system: "s",
      user: "u",
      schema: EvaluatorGroupOutputSchema,
    });
    await createOpenAiTransport("gpt-5.1-mini", fake)({
      system: "s",
      user: "u",
      schema: EvaluatorGroupOutputSchema,
    });
    expect(seenModels).toEqual(["gpt-5.1", "gpt-5.1-mini"]);
  });

  it("never touches OPENAI_API_KEY or constructs a real client when a fake is injected", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const fake: ResponsesParseClient = {
        responses: { parse: async () => ({ output_parsed: { results: [] } }) },
      };
      const transport = createOpenAiTransport("gpt-5.1", fake);
      await expect(
        transport({ system: "s", user: "u", schema: EvaluatorGroupOutputSchema }),
      ).resolves.toEqual({ parsed_output: { results: [] } });
    } finally {
      if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    }
  });
});
