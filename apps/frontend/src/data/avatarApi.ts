/**
 * The two Mentic-pipeline endpoints.
 *
 * Deliberately NOT on `RunClient`. That interface has two implementations, and the
 * fixture one exists so every screen can be built and tested with no backend at all.
 * Adding image generation to it would mean inventing a fake character sheet, and a
 * plausible-looking fake sheet is exactly the kind of thing this product is supposed to
 * refuse to produce. So these are plain functions, the pipeline tab calls them directly,
 * and in fixture mode it says it needs the real backend instead of pretending.
 *
 * Both calls spend money. `generateSheet` is a paid image, `describeSheet` a paid vision
 * call, and neither is made unless a person presses the button that makes it.
 */

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const message =
      parsed !== null && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `request to ${url} failed with status ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export type AvatarRecord = {
  id: string;
  createdAt: string;
  source: "generated" | "uploaded";
  mediaType: string;
  imageModel?: string;
  authoredPrompt?: string;
  sheetPrompt?: string;
  seedDescription?: string;
  description?: string;
  descriptionTrimmed?: boolean;
  describeModel?: string;
};

/** Where a stored avatar's bytes are served from. Never a data URL: the gallery would be
 *  tens of megabytes of JSON if the list carried the images. */
export function avatarImageUrl(id: string): string {
  return `/avatar/${id}/image`;
}

export type SheetResult = {
  /** The stored record's id, or null when the server has no avatar store wired. */
  id: string | null;
  imageBase64: string;
  mediaType: string;
  model: string;
  /** What the doctrine call wrote from the description. */
  authoredPrompt: string;
  /** That paragraph wrapped in the three-panel layout: the exact string sent to the
   *  image model. Shown because a bad sheet and a bad prompt look identical otherwise. */
  sheetPrompt: string;
};

export type DescribeResult = {
  /** What Mentic would store on `UgcActor.description` and send to the video model. */
  description: string;
  /** The model's untrimmed output. */
  raw: string;
  /** Whether the 900-character cap actually cut something. */
  trimmed: boolean;
  model: string;
};

export function generateSheet(
  description: string,
  variationHint?: string,
): Promise<SheetResult> {
  return post<SheetResult>("/avatar/sheet", {
    description,
    ...(variationHint ? { variationHint } : {}),
  });
}

export function describeSheet(
  imageBase64: string,
  mediaType: string,
  /** Links the description onto the stored avatar, so the image and the paragraph read off
   *  it are one record rather than two unrelated artefacts. */
  avatarId?: string | null,
): Promise<DescribeResult> {
  return post<DescribeResult>("/avatar/describe", {
    imageBase64,
    mediaType,
    ...(avatarId ? { avatarId } : {}),
  });
}

/** Stores a sheet rendered elsewhere, so the gallery is the whole set rather than only the
 *  half this server generated. */
export function uploadSheet(
  imageBase64: string,
  mediaType: string,
): Promise<{ id: string; mediaType: string }> {
  return post<{ id: string; mediaType: string }>("/avatar/upload", { imageBase64, mediaType });
}

export async function listAvatars(): Promise<AvatarRecord[]> {
  const res = await fetch("/avatar");
  if (!res.ok) throw new Error(`could not list avatars (status ${res.status})`);
  const body = (await res.json()) as { avatars: AvatarRecord[] };
  return body.avatars ?? [];
}

/** Splits a `data:` URL from a `FileReader` into the two fields the API wants. Returns null
 *  for anything that is not a base64 data URL, so an unreadable file is refused here rather
 *  than sent and billed for. */
export function splitDataUrl(dataUrl: string): { imageBase64: string; mediaType: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, mediaType, imageBase64] = match;
  if (!mediaType || !imageBase64) return null;
  return { mediaType, imageBase64 };
}
