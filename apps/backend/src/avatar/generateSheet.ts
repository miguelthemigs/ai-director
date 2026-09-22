import { GoogleGenAI, Modality } from "@google/genai";
import { ACTOR_SHEET_ASPECT_RATIO } from "./sheetBrief.js";

/**
 * Nano Banana Pro (Gemini 3 Pro Image), the way Mentic calls it.
 *
 * Source: `lib/google-genai-client.ts` (`googleGenerateImage`) and `lib/ugc-lab/models.ts`
 * in the Mentic repo, read 2026-09-12. The call shape is theirs:
 *   ai.models.generateContent({ model, contents, config })
 *   config.responseModalities = [Modality.IMAGE]
 *   config.imageConfig = { aspectRatio, imageSize }
 *   image bytes come back base64 on candidates[0].content.parts[*].inlineData
 *
 * ── What is deliberately NOT reproduced ─────────────────────────────────────────
 * Mentic mirrors every generated image to UploadThing so the URL has a stable home it
 * owns, and writes a priced row to its AI usage ledger. Neither belongs here: this repo
 * has no object store and no billing ledger, and inventing half of either would be worse
 * than having none. The bytes are returned to the caller, and what happens to them is
 * the caller's problem.
 */
export const NANO_BANANA_PRO = "gemini-3-pro-image";

/** Mentic's registry default, and the only slug this repo asks for. */
export const DEFAULT_IMAGE_MODEL = NANO_BANANA_PRO;

export type ImageTransport = (args: {
  model: string;
  prompt: string;
  aspectRatio: string;
}) => Promise<{ imageBase64: string; mediaType: string }>;

export type GeneratedSheet = {
  imageBase64: string;
  mediaType: string;
  model: string;
  /** The exact prompt sent. Returned so the UI can show what produced the sheet, which
   *  is half of telling apart a bad prompt from a bad render. */
  prompt: string;
};

/**
 * The one implementation that talks to Google. Everything above it takes an
 * `ImageTransport`, so no test in this repo can spend money by accident.
 */
export function createGeminiImageTransport(): ImageTransport {
  return async ({ model, prompt, aspectRatio }) => {
    // Mentic prefers GOOGLE_AI_KEY (the Google AI Studio convention) and falls back to
    // GOOGLE_API_KEY for legacy setups. Read at call time so importing this module
    // without a key never throws.
    const apiKey = process.env.GOOGLE_AI_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_AI_KEY (or GOOGLE_API_KEY) missing, required for Nano Banana Pro");
    }
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.IMAGE],
        // "2K" rather than the 1K default, and it is free: the output token count is
        // fixed by the model, not by `imageSize`. Mentic's production path always takes
        // 2K for that reason.
        imageConfig: { aspectRatio, imageSize: "2K" },
      },
    });

    const candidates = response.candidates ?? [];
    if (candidates.length === 0) {
      throw new Error("Nano Banana Pro returned no candidates");
    }
    const parts = candidates[0]?.content?.parts ?? [];

    // Gemini 3 Pro Image with thinking enabled can emit interim "thought" images BEFORE
    // the final render. Walk the parts in reverse and take the LAST inline image that is
    // not flagged as a thought, so an intermediate thinking frame is never mistaken for
    // the result. Mentic learned this one the expensive way.
    const imagePart = [...parts]
      .reverse()
      .find((part) => !part.thought && Boolean(part.inlineData?.data));

    if (!imagePart?.inlineData?.data) {
      // Surface any text the model returned, so an unintelligible failure (a safety
      // filter, most often) is readable rather than a blank error.
      const said = parts.find((part) => typeof part.text === "string")?.text;
      throw new Error(
        `Nano Banana Pro returned no image part${said ? `, model said: "${said.slice(0, 200)}"` : ""}`,
      );
    }

    return {
      imageBase64: imagePart.inlineData.data,
      mediaType: imagePart.inlineData.mimeType ?? "image/png",
    };
  };
}

/** One authored identity paragraph in, one rendered character sheet out. */
export async function generateSheet(
  transport: ImageTransport,
  args: { prompt: string; model?: string },
): Promise<GeneratedSheet> {
  const model = args.model ?? DEFAULT_IMAGE_MODEL;
  const { imageBase64, mediaType } = await transport({
    model,
    prompt: args.prompt,
    aspectRatio: ACTOR_SHEET_ASPECT_RATIO,
  });
  return { imageBase64, mediaType, model, prompt: args.prompt };
}
