import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import type { ParseTransport } from "./client.js";

// This is not the product's Evaluator. `claude-opus-5` (createAnthropicTransport
// in client.ts) remains the Evaluator everywhere else -- this transport exists
// only so `compareProviders` (cli/bias.ts) can run the same descriptions
// through an independent-lineage model as a bias check, never to serve a
// user-facing run. See docs/superpowers/specs/2026-09-10-character-description-agents-design.md §4.
export const DEFAULT_OPENAI_MODEL = "gpt-5.1";

// The transport only needs `responses.parse`, so a test fake has to implement
// exactly that one method to stand in for the real client -- not construct or
// extend the real `OpenAI` class.
export type ResponsesParseClient = {
  responses: {
    parse: (params: unknown) => Promise<{ output_parsed: unknown; refusal?: string | null }>;
  };
};

/**
 * Mirrors `createAnthropicTransport` (client.ts): same `ParseTransport` shape,
 * same "read the key at call time" rule so importing this module without
 * `OPENAI_API_KEY` set never throws, same "a failed parse comes back as
 * `{ parsed_output: null }`, never a throw" contract that `evaluateAllGroups`
 * (Task 6) already knows how to fold into `not_evaluated` checks.
 *
 * `client` is an optional second constructor argument, real production code
 * never passes it (a real `OpenAI()` is constructed per call, same as the
 * Anthropic transport), and tests inject a fake satisfying
 * `ResponsesParseClient` instead of the real SDK class.
 */
export function createOpenAiTransport(
  model: string = DEFAULT_OPENAI_MODEL,
  client?: ResponsesParseClient,
): ParseTransport {
  return async ({ system, user, schema }) => {
    const openai = client ?? (new OpenAI() as unknown as ResponsesParseClient);
    const response = await openai.responses.parse({
      model,
      instructions: system,
      input: user,
      reasoning: { effort: "high" },
      text: { format: zodTextFormat(schema as ZodType, "evaluator_output") },
    });
    // A refusal comes back as `output_parsed: null` with `refusal` set; a
    // structurally invalid completion comes back as `output_parsed: null`
    // with no refusal. Both are "this group failed to evaluate" to the
    // caller, exactly like a null parsed_output from the Anthropic
    // transport -- never a throw, so evaluateAllGroups's existing
    // not_evaluated handling applies unchanged to either provider.
    return { parsed_output: response.output_parsed ?? null };
  };
}
