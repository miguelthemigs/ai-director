import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

export const DEFAULT_MODEL = "claude-opus-5";

export type ParseTransport = (args: {
  system: string;
  user: string;
  schema: ZodType;
}) => Promise<{ parsed_output: unknown }>;

// betas + fallbacks are beta-only request fields (confirmed against the installed
// SDK's own .d.ts: they exist on the beta MessageCreateParams, not on
// resources/messages/messages.d.ts's MessageCreateParamsBase), so this goes
// through client.beta.messages.parse rather than client.messages.parse.
export function createAnthropicTransport(model: string = DEFAULT_MODEL): ParseTransport {
  return async ({ system, user, schema }) => {
    // Read the key at call time so importing this module without one never throws.
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return { parsed_output: response.parsed_output };
  };
}
