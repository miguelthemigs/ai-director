import { UTApi } from "uploadthing/server";

/**
 * Where reference pictures live so OpenRouter can fetch them by public URL.
 * Ported from Mentic: `lib/uploadthing-url.ts` (the host check) and `lib/media-mirror.ts`
 * (`uploadFiles` -> `data.ufsUrl`). Read, not imported.
 */
export type ReferenceHost = {
  publish(bytes: Buffer, name: string, mediaType: string): Promise<{ url: string }>;
};

export class ReferenceHostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceHostConfigError";
  }
}

/** Is this URL one of UploadThing's? https, and `utfs.io` or a `*.ufs.sh` host. */
export function isUploadThingUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return parsed.hostname === "utfs.io" || parsed.hostname.endsWith(".ufs.sh");
}

/** The one method of `UTApi` this file uses, so a test can fake the client. */
export type UploadClient = Pick<UTApi, "uploadFiles">;

/**
 * Throws `ReferenceHostConfigError` without `UPLOADTHING_TOKEN`, at construction. A client
 * may be injected (tests do, and then no token is needed); with none, a real `UTApi` is built.
 */
export function createUploadThingHost(client?: UploadClient): ReferenceHost {
  if (!client && !process.env.UPLOADTHING_TOKEN) {
    throw new ReferenceHostConfigError("UPLOADTHING_TOKEN missing, required to host reference images");
  }
  const utapi: UploadClient = client ?? new UTApi();
  return {
    async publish(bytes, name, mediaType) {
      const file = new File([new Uint8Array(bytes)], name, { type: mediaType });
      const result = await utapi.uploadFiles(file);
      if (result.error) throw new Error(`UploadThing upload failed: ${result.error.message}`);
      const url = result.data.ufsUrl;
      if (!isUploadThingUrl(url)) throw new Error(`UploadThing returned a URL that is not an UploadThing URL`);
      return { url };
    },
  };
}
