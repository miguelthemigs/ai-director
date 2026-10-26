import type { AvatarRecord, AvatarStore } from "../store/AvatarStore.js";
import {
  describeImage,
  isSupportedMediaType,
  type DescribeResult,
  type SupportedMediaType,
  type VisionTransport,
} from "../describe/describeImage.js";
import { authorActorPrompt, type TextTransport } from "./authorPrompt.js";
import { generateSheet, type GeneratedSheet, type ImageTransport } from "./generateSheet.js";
import { actorSheetBrief } from "./sheetBrief.js";

/**
 * The Mentic pipeline as callable steps: author -> sheet brief -> render -> save, then
 * describe -> attach. `POST /avatar/sheet` and `POST /avatar/describe` call the two halves
 * separately (they are two routes on purpose, see `server/routes/avatar.ts`); the
 * Director's character step calls `makeCharacter`, which runs both.
 */
export type MakeCharacterDeps = {
  text: TextTransport;
  images: ImageTransport;
  vision: VisionTransport;
  avatars: AvatarStore;
};

export type RenderedSheet = {
  authoredPrompt: string;
  sheetPrompt: string;
  sheet: GeneratedSheet;
  /** Absent when no store was given. */
  record: AvatarRecord | undefined;
};

/**
 * Author the prompt, render the sheet, and write it to the store before returning. Null
 * when the authoring step returned nothing: a real outcome (Mentic's own authoring slots
 * return "" on failure), not an edge case, so the caller decides how to report it.
 */
export async function renderSheet(
  deps: { text: TextTransport; images: ImageTransport; avatars?: AvatarStore },
  args: { description: string; variationHint?: string },
): Promise<RenderedSheet | null> {
  const authoredPrompt = await authorActorPrompt(deps.text, {
    description: args.description,
    ...(args.variationHint === undefined ? {} : { variationHint: args.variationHint }),
  });
  if (!authoredPrompt) return null;

  const sheetPrompt = actorSheetBrief(authoredPrompt);
  const sheet = await generateSheet(deps.images, { prompt: sheetPrompt });

  // Written to disk BEFORE replying. A paid image that only ever existed in the
  // response body is one a dropped connection or a browser reload destroys, and a
  // vanished sheet looks exactly like a render that never happened.
  const record = await deps.avatars?.save({
    imageBase64: sheet.imageBase64,
    mediaType: sheet.mediaType,
    source: "generated",
    imageModel: sheet.model,
    authoredPrompt,
    sheetPrompt,
    seedDescription: args.description,
  });
  return { authoredPrompt, sheetPrompt, sheet, record };
}

/**
 * Describe an image and, when an avatar id is given, write the result back onto that
 * record. Best effort, as the route always was: the description has been paid for and is
 * in hand, so a failed attach is reported through `onAttachError` rather than thrown.
 */
export async function describeAndAttach(
  deps: { vision: VisionTransport; avatars?: AvatarStore },
  args: { avatarId?: string; imageBase64: string; mediaType: SupportedMediaType },
  onAttachError?: (err: unknown) => void,
): Promise<DescribeResult> {
  const result = await describeImage(deps.vision, {
    imageBase64: args.imageBase64,
    mediaType: args.mediaType,
  });
  if (deps.avatars && args.avatarId) {
    try {
      await deps.avatars.attachDescription(args.avatarId, {
        description: result.description,
        descriptionRaw: result.raw,
        descriptionTrimmed: result.trimmed,
        describeModel: result.model,
      });
    } catch (err) {
      onAttachError?.(err);
    }
  }
  return result;
}

/** One description in, one stored avatar out, carrying its sheet and the paragraph read off it. */
export async function makeCharacter(
  deps: MakeCharacterDeps,
  args: { description: string },
): Promise<AvatarRecord> {
  const rendered = await renderSheet(deps, { description: args.description });
  if (!rendered?.record) throw new Error("the authoring step returned no prompt");
  const { sheet, record } = rendered;
  if (!isSupportedMediaType(sheet.mediaType)) {
    throw new Error(`the rendered sheet has an unsupported media type: ${sheet.mediaType}`);
  }
  const result = await describeImage(deps.vision, {
    imageBase64: sheet.imageBase64,
    mediaType: sheet.mediaType,
  });
  return deps.avatars.attachDescription(record.id, {
    description: result.description,
    descriptionRaw: result.raw,
    descriptionTrimmed: result.trimmed,
    describeModel: result.model,
  });
}
