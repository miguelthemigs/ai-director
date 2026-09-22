import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import type { SupportedMediaType } from "../describe/describeImage.js";

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * An image travelling with a structured-output call.
 *
 * `VisionTransport` (describe/describeImage.ts) already carries an image, but it
 * returns free text and has no schema; `ParseTransport` had a schema and no way to
 * carry a picture. The Repairer needs both at once (see
 * `agents/repairer/prompt-v2.ts`), so the picture is added here as an optional
 * field rather than as a third transport type: one seam, and every existing caller
 * and every test fake keeps working untouched because omitting it is the old
 * behaviour exactly.
 */
export type TransportImage = { imageBase64: string; mediaType: SupportedMediaType };

export type ParseTransport = (args: {
  system: string;
  user: string;
  schema: ZodType;
  /** Absent on every text-only call, which is all of them except a v2 repair. */
  image?: TransportImage;
}) => Promise<{ parsed_output: unknown }>;

// betas + fallbacks are beta-only request fields (confirmed against the installed
// SDK's own .d.ts: they exist on the beta MessageCreateParams, not on
// resources/messages/messages.d.ts's MessageCreateParamsBase), so this goes
// through client.beta.messages.parse rather than client.messages.parse.
export function createAnthropicTransport(model: string = DEFAULT_MODEL): ParseTransport {
  return async ({ system, user, schema, image }) => {
    // Read the key at call time so importing this module without one never throws.
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      system,
      // The image goes FIRST, ahead of the text, which is the order
      // `describeImage`'s vision call already uses and the order Anthropic's own
      // guidance gives for a single image with a question about it.
      messages: [
        {
          role: "user",
          content: image
            ? [
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: image.mediaType,
                    data: image.imageBase64,
                  },
                },
                { type: "text" as const, text: user },
              ]
            : user,
        },
      ],
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return { parsed_output: response.parsed_output };
  };
}
