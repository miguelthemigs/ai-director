import Anthropic from "@anthropic-ai/sdk";
import {
  MENTIC_DESCRIBE_ACTOR_SYSTEM,
  MENTIC_DESCRIBE_ACTOR_USER,
  MENTIC_DESCRIBE_MAX_CHARS,
  MENTIC_DESCRIBE_MODEL,
} from "./prompt.js";

/** The image media types Anthropic's vision API accepts. Anything else is rejected at
 *  the boundary rather than forwarded and billed for. */
export const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(value: string): value is SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/**
 * The seam. Same shape and same reason as `ParseTransport` in `../api/client.ts`: every
 * test in this repo runs against a fake, and exactly one implementation talks to a
 * provider. Nothing above this line knows an SDK exists.
 */
export type VisionTransport = (args: {
  system: string;
  user: string;
  imageBase64: string;
  mediaType: SupportedMediaType;
}) => Promise<{ text: string }>;

/**
 * Mentic's call, reproduced.
 *
 * No `thinking`, no `output_config`, no structured output, and `claude-sonnet-5` rather
 * than Opus: Mentic's `describeActorFromPhoto` is a plain `generateText` with a system
 * prompt and an image, and every one of those differences would change what comes back.
 * The point of this call is to produce the string Mentic's users actually get, so it has
 * to be the call Mentic actually makes.
 *
 * `max_tokens` is 1000 rather than this repo's usual 16000. The prompt asks for one
 * sentence under 400 characters; a ceiling anywhere near that is enough, and a large one
 * only widens the blast radius of a model that decides to write an essay.
 */
export function createAnthropicVisionTransport(
  model: string = MENTIC_DESCRIBE_MODEL,
): VisionTransport {
  return async ({ system, user, imageBase64, mediaType }) => {
    // Read the key at call time so importing this module without one never throws.
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 1000,
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: user },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { text };
  };
}

/**
 * Trim to the cap WITHOUT cutting a word in half. Ported from Mentic's `trimToWhole`,
 * for the reason its own comment gives: a hard slice ended a live description at "cream
 * roller bli", and this string is spliced into a render prompt, so a severed word is a
 * severed word the video model has to interpret.
 */
export function trimToWhole(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf(", "));
  if (sentence > max * 0.6) return window.slice(0, sentence + 1).trimEnd();
  const space = window.lastIndexOf(" ");
  return space > 0 ? window.slice(0, space).trimEnd() : window;
}

export type DescribeResult = {
  /** What Mentic would store on `UgcActor.description` and splice into every render. */
  description: string;
  /** The raw model output before trimming. Kept because the difference between the two
   *  is itself evidence: a description that had to be trimmed is one the 400-character
   *  instruction failed to hold, which is the conflict this whole path exists to expose. */
  raw: string;
  /** True when the cap actually cut something. Surfaced in the UI, never inferred from
   *  a length comparison by a caller that might use a different cap. */
  trimmed: boolean;
  model: string;
};

/**
 * One image in, one description out, exactly as Mentic writes it.
 *
 * Unlike Mentic's version this THROWS on failure rather than returning null. Mentic
 * degrades to a generic person because it has a render to get out and a missing
 * description is better than a failed job. Here the description IS the job: returning
 * nothing and calling it a result would put an empty string through the nine checks and
 * report a score for it.
 */
export async function describeImage(
  transport: VisionTransport,
  args: { imageBase64: string; mediaType: SupportedMediaType; model?: string },
): Promise<DescribeResult> {
  const { text } = await transport({
    system: MENTIC_DESCRIBE_ACTOR_SYSTEM,
    user: MENTIC_DESCRIBE_ACTOR_USER,
    imageBase64: args.imageBase64,
    mediaType: args.mediaType,
  });

  // Mentic strips a wrapping pair of quotes, because the model sometimes returns the
  // sentence quoted despite being told not to.
  const raw = text.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new Error("the model returned no description");

  const description = trimToWhole(raw, MENTIC_DESCRIBE_MAX_CHARS);
  return {
    description,
    raw,
    trimmed: description !== raw,
    model: args.model ?? MENTIC_DESCRIBE_MODEL,
  };
}
