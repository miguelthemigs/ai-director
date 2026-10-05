import type { TransportImage } from "../api/client.js";
import { isSupportedMediaType } from "../describe/describeImage.js";
import type { AvatarStore } from "../store/AvatarStore.js";
import { statedFactsFor } from "./statedFacts.js";

/**
 * What the Repairer is handed alongside the failing fragments: the avatar's character
 * sheet, and the brief it was rendered from when there is one. This is the whole of
 * prompt v2 (`agents/repairer/prompt-v2.ts`).
 */
export type RepairGrounding = { sheet: TransportImage; statedFacts: string | null };

/**
 * Every run starts from an avatar: render or upload the sheet, describe it, grade the
 * description, repair it. There is no run without one, so there is no run the Repairer
 * makes blind. A blind Repairer is prompt v1, the one that invented the hair length, the
 * height and the build on run `bee3bcd6` (`docs/repairer-cannot-see.md`).
 *
 * Null when the avatar does not exist or its sheet cannot be sent to the model. Callers
 * refuse the run on null rather than falling back to v1: a run that did not start is
 * better than one that quietly ran the prompt this pipeline was rebuilt to stop using.
 *
 * Shared by `server/routes/runs.ts` and `cli/score.ts`, which each used to assemble this
 * themselves.
 */
export async function loadGrounding(
  store: Pick<AvatarStore, "get" | "readImage">,
  avatarId: string,
): Promise<RepairGrounding | null> {
  const sheet = await store.readImage(avatarId);
  if (!sheet || !isSupportedMediaType(sheet.mediaType)) return null;
  const record = await store.get(avatarId);
  return {
    sheet: { imageBase64: sheet.bytes.toString("base64"), mediaType: sheet.mediaType },
    statedFacts: record ? statedFactsFor(record) : null,
  };
}
