import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Generated avatars, on disk.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 * A rendered character sheet is a paid artefact. Before this it lived only in React
 * state, which meant it was gone on any reload, any dev-server restart, and any hot
 * module replacement: you paid for an image and then had nowhere to see it and no way to
 * get it back. Worse, the failure was silent — a sheet that vanished looked exactly like
 * a render that never happened.
 *
 * So every sheet is written to disk the moment it comes back from the provider, BEFORE
 * the route replies. If the response never reaches the browser the file is still there.
 *
 * The record grows in two steps, matching the two paid calls: the image and its prompts
 * are written when the sheet is rendered, and the description is written onto the same
 * record when it is read back off that sheet. That pairing is the useful unit of
 * evidence, because the question this whole repo asks is what the second step wrote about
 * the first.
 */

export type AvatarRecord = {
  id: string;
  createdAt: string;
  /** "generated" from a prompt, or "uploaded" from a sheet made elsewhere. */
  source: "generated" | "uploaded";
  mediaType: string;
  /** Absent on an uploaded sheet: nobody here wrote a prompt for it. */
  imageModel?: string;
  /** What the doctrine call wrote from the guided fields. */
  authoredPrompt?: string;
  /** That paragraph wrapped in the three-panel layout: the exact string sent to the image
   *  model. Kept because a bad prompt and a bad render are indistinguishable without it. */
  sheetPrompt?: string;
  /** The guided form's assembled sentence, the text the user actually composed. */
  seedDescription?: string;
  /** Written by the DESCRIBE step, later. This is the graded artefact. */
  description?: string;
  /** The describe model's untrimmed output. */
  descriptionRaw?: string;
  descriptionTrimmed?: boolean;
  describeModel?: string;
};

export interface AvatarStore {
  /** Writes the image and its record. Returns the new id. */
  save(args: {
    imageBase64: string;
    mediaType: string;
    source: "generated" | "uploaded";
    imageModel?: string;
    authoredPrompt?: string;
    sheetPrompt?: string;
    seedDescription?: string;
  }): Promise<AvatarRecord>;
  /** Merges the describe step's output onto an existing record. */
  attachDescription(
    id: string,
    fields: Pick<AvatarRecord, "description" | "descriptionRaw" | "descriptionTrimmed" | "describeModel">,
  ): Promise<AvatarRecord>;
  list(): Promise<AvatarRecord[]>;
  get(id: string): Promise<AvatarRecord | null>;
  /** The raw image bytes, for serving. */
  readImage(id: string): Promise<{ bytes: Buffer; mediaType: string } | null>;
}

const RECORD_FILE = "record.json";

function extensionFor(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  if (mediaType === "image/gif") return "gif";
  return "png";
}

export class FileAvatarStore implements AvatarStore {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    return path.join(this.root, id);
  }

  async save(args: Parameters<AvatarStore["save"]>[0]): Promise<AvatarRecord> {
    const id = randomUUID();
    const record: AvatarRecord = {
      id,
      createdAt: new Date().toISOString(),
      source: args.source,
      mediaType: args.mediaType,
      ...(args.imageModel === undefined ? {} : { imageModel: args.imageModel }),
      ...(args.authoredPrompt === undefined ? {} : { authoredPrompt: args.authoredPrompt }),
      ...(args.sheetPrompt === undefined ? {} : { sheetPrompt: args.sheetPrompt }),
      ...(args.seedDescription === undefined ? {} : { seedDescription: args.seedDescription }),
    };

    await mkdir(this.dir(id), { recursive: true });
    // The image first. A record with no image beside it is a lie about what was rendered;
    // an image with no record is recoverable by hand.
    await writeFile(
      path.join(this.dir(id), `sheet.${extensionFor(args.mediaType)}`),
      Buffer.from(args.imageBase64, "base64"),
    );
    await writeFile(path.join(this.dir(id), RECORD_FILE), JSON.stringify(record, null, 2), "utf8");
    return record;
  }

  async attachDescription(
    id: string,
    fields: Pick<AvatarRecord, "description" | "descriptionRaw" | "descriptionTrimmed" | "describeModel">,
  ): Promise<AvatarRecord> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`avatar ${id} not found`);
    const merged: AvatarRecord = { ...existing, ...fields };
    await writeFile(path.join(this.dir(id), RECORD_FILE), JSON.stringify(merged, null, 2), "utf8");
    return merged;
  }

  async get(id: string): Promise<AvatarRecord | null> {
    try {
      const raw = await readFile(path.join(this.dir(id), RECORD_FILE), "utf8");
      return JSON.parse(raw) as AvatarRecord;
    } catch {
      return null;
    }
  }

  async list(): Promise<AvatarRecord[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // The store was never written to. Empty, not an error.
      return [];
    }
    const records = await Promise.all(entries.map((id) => this.get(id)));
    return records
      .filter((record): record is AvatarRecord => record !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async readImage(id: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
    const record = await this.get(id);
    if (!record) return null;
    try {
      const bytes = await readFile(
        path.join(this.dir(id), `sheet.${extensionFor(record.mediaType)}`),
      );
      return { bytes, mediaType: record.mediaType };
    } catch {
      return null;
    }
  }
}
