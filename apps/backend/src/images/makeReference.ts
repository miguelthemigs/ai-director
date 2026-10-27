import type { ReferenceImage } from "@ai-director/contract";
import { DEFAULT_IMAGE_MODEL, type ImageTransport, type TransportImage } from "../avatar/generateSheet.js";
import type { DirectorRunStore } from "../store/DirectorRunStore.js";
import { locationPlateBrief, productShotBrief } from "./prompts/v1.js";

type Deps = { images: ImageTransport; store: DirectorRunStore };

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Render and keep it on disk in the run folder, like an avatar sheet. Nothing is hosted. */
async function render(
  deps: Deps,
  args: { runId: string; handle: string; kind: ReferenceImage["kind"]; slot: number; prompt: string; aspectRatio: string; referenceImages?: TransportImage[] },
): Promise<ReferenceImage> {
  const { imageBase64, mediaType } = await deps.images({
    model: DEFAULT_IMAGE_MODEL,
    prompt: args.prompt,
    aspectRatio: args.aspectRatio,
    ...(args.referenceImages ? { referenceImages: args.referenceImages } : {}),
  });
  const bytes = Buffer.from(imageBase64, "base64");
  // A plan handle is `@mug`; the store's asset names allow no `@`, so the file drops it.
  const name = `${args.kind}-${args.handle.replace(/^@/, "")}.${EXTENSION[mediaType] ?? "png"}`;
  const asset = await deps.store.saveAsset(args.runId, name, bytes);
  return { slot: args.slot, handle: args.handle, kind: args.kind, asset, mediaType };
}

export function makeProductPicture(
  deps: Deps,
  args: { runId: string; photo: TransportImage; productKind: string; handle: string },
): Promise<ReferenceImage> {
  return render(deps, {
    runId: args.runId,
    handle: args.handle,
    kind: "product",
    slot: 1,
    prompt: productShotBrief(args.productKind),
    aspectRatio: "1:1",
    referenceImages: [args.photo],
  });
}

export function makeLocationPicture(
  deps: Deps,
  args: { runId: string; description: string; styleLine: string; handle: string },
): Promise<ReferenceImage> {
  return render(deps, {
    runId: args.runId,
    handle: args.handle,
    kind: "location",
    slot: 2,
    prompt: locationPlateBrief(args.description, args.styleLine),
    aspectRatio: "9:16",
  });
}
