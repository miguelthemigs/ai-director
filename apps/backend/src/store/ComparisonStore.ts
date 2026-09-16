import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  isRenderTerminal,
  pairActualMicroUsd,
  type ComparisonSide,
  type ComparisonSummary,
  type ComparisonView,
  type RenderView,
  type VideoSize,
} from "@ai-director/contract";

/**
 * Video comparisons, on disk.
 *
 * ── Why the same shape as `FileAvatarStore` ─────────────────────────────────────────
 * Same reason, and it is a stronger one here. A rendered clip is a paid artefact that took
 * minutes to produce; a clip that lived only in a response body is one a reload destroys,
 * and a vanished clip looks exactly like a render that never happened. Everything is
 * written before the route replies.
 *
 * ── The claim file, and why it is never deleted ─────────────────────────────────────
 * `render-ugc.ts` in Mentic stamps `submitAttemptedAt` as a compare-and-swap before
 * calling the vendor, so two concurrent ticks cannot both submit. There is no database
 * here. `writeFile(..., { flag: "wx" })` fails with EEXIST when the file already exists,
 * and that check-and-create is one atomic filesystem operation — the same guarantee, from
 * the tool this repo has.
 *
 * The file is never removed. A claim that can be released is not a claim: the point is
 * that a second attempt finds evidence of the first, including after the process that made
 * the first attempt died mid-submit. A held claim with no task id beside it is exactly the
 * UNKNOWN outcome that must never be resubmitted.
 *
 * ── No ledger ───────────────────────────────────────────────────────────────────────
 * The estimate and the bill sit on the row and nowhere else. This repo has no billing
 * ledger and `avatar/generateSheet.ts` already says why half of one would be worse than
 * none.
 */

const ROW_FILE = "row.json";

/** Whether this caller is the one allowed to submit. */
export type ClaimResult = "claimed" | "already_claimed";

/** What each side needs before it has been submitted. */
export type ComparisonSource = {
  description: string;
  descriptionSha256: string;
};

export type CreateComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  model: string;
  shotPromptVersion: string;
  rubricVersion: string;
  /** Null when the run manifest records none. Never guessed. */
  repairerPromptVersion: string | null;
  /** Per clip, not per pair. */
  estimatedMicroUsd: number;
  sources: Record<ComparisonSide, ComparisonSource>;
};

/** The fields a poll or a settle may change. Deliberately narrow: nothing may rewrite a
 *  description, a hash, an estimate or a provenance field after the row is created. */
export type RenderPatch = Partial<
  Pick<
    RenderView,
    "status" | "failureCode" | "failure" | "actualMicroUsd" | "clipUrl" | "finishedAt" | "polls"
  >
>;

export interface ComparisonStore {
  create(args: CreateComparisonArgs): Promise<ComparisonView>;
  /** Atomic. `"claimed"` exactly once per (comparison, side), for all time. */
  claimSubmit(comparisonId: string, side: ComparisonSide): Promise<ClaimResult>;
  /** Called the instant a submit returns, before anything waits on the task. */
  stampTaskId(comparisonId: string, side: ComparisonSide, taskId: string): Promise<void>;
  patchRender(
    comparisonId: string,
    side: ComparisonSide,
    patch: RenderPatch,
  ): Promise<ComparisonView>;
  get(comparisonId: string): Promise<ComparisonView | null>;
  list(): Promise<ComparisonSummary[]>;
  writeClip(
    comparisonId: string,
    side: ComparisonSide,
    bytes: Buffer,
    mediaType: string,
  ): Promise<void>;
  readClip(
    comparisonId: string,
    side: ComparisonSide,
  ): Promise<{ bytes: Buffer; mediaType: string } | null>;
}

function emptyRender(
  side: ComparisonSide,
  args: CreateComparisonArgs,
  source: ComparisonSource,
): RenderView {
  return {
    side,
    status: "queued",
    taskId: null,
    submittedAt: null,
    finishedAt: null,
    failureCode: null,
    failure: null,
    estimatedMicroUsd: args.estimatedMicroUsd,
    actualMicroUsd: null,
    clipUrl: null,
    description: source.description,
    descriptionSha256: source.descriptionSha256,
    rubricVersion: args.rubricVersion,
    repairerPromptVersion: args.repairerPromptVersion,
    polls: 0,
  };
}

/** The media type is stored beside the bytes rather than guessed from an extension, so a
 *  vendor that one day answers webm does not silently produce an unplayable `.mp4`. */
type ClipMeta = { mediaType: string; file: string };

export class FileComparisonStore implements ComparisonStore {
  constructor(private readonly root: string) {}

  private dir(comparisonId: string): string {
    return path.join(this.root, comparisonId);
  }

  private async write(row: ComparisonView): Promise<void> {
    await writeFile(
      path.join(this.dir(row.comparisonId), ROW_FILE),
      JSON.stringify(row, null, 2),
      "utf8",
    );
  }

  private async require(comparisonId: string): Promise<ComparisonView> {
    const row = await this.get(comparisonId);
    if (!row) throw new Error(`comparison ${comparisonId} not found`);
    return row;
  }

  async create(args: CreateComparisonArgs): Promise<ComparisonView> {
    const comparisonId = randomUUID();
    const row: ComparisonView = {
      comparisonId,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      avatarId: args.avatarId,
      runId: args.runId,
      seconds: args.seconds,
      size: args.size,
      model: args.model,
      shotPromptVersion: args.shotPromptVersion,
      before: emptyRender("before", args, args.sources.before),
      after: emptyRender("after", args, args.sources.after),
    };
    await mkdir(this.dir(comparisonId), { recursive: true });
    await this.write(row);
    return row;
  }

  async claimSubmit(comparisonId: string, side: ComparisonSide): Promise<ClaimResult> {
    const claim = path.join(this.dir(comparisonId), `${side}.claim`);
    try {
      // "wx" is the whole mechanism: create-if-absent, atomically, or EEXIST.
      await writeFile(claim, new Date().toISOString(), { flag: "wx" });
      return "claimed";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return "already_claimed";
      throw err;
    }
  }

  async stampTaskId(comparisonId: string, side: ComparisonSide, taskId: string): Promise<void> {
    const row = await this.require(comparisonId);
    await this.write({
      ...row,
      [side]: { ...row[side], taskId, submittedAt: new Date().toISOString() },
    } as ComparisonView);
  }

  async patchRender(
    comparisonId: string,
    side: ComparisonSide,
    patch: RenderPatch,
  ): Promise<ComparisonView> {
    const row = await this.require(comparisonId);
    const merged = { ...row, [side]: { ...row[side], ...patch } } as ComparisonView;
    // The comparison finishes when both of its renders have, and not before. A pair with
    // one clip still running is not a finished comparison however good the other one is.
    const bothDone = isRenderTerminal(merged.before.status) && isRenderTerminal(merged.after.status);
    merged.finishedAt = bothDone ? (merged.finishedAt ?? new Date().toISOString()) : null;
    await this.write(merged);
    return merged;
  }

  async get(comparisonId: string): Promise<ComparisonView | null> {
    try {
      const raw = await readFile(path.join(this.dir(comparisonId), ROW_FILE), "utf8");
      return JSON.parse(raw) as ComparisonView;
    } catch {
      return null;
    }
  }

  async list(): Promise<ComparisonSummary[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // The store was never written to. Empty, not an error.
      return [];
    }
    const rows = await Promise.all(entries.map((id) => this.get(id)));
    return rows
      .filter((row): row is ComparisonView => row !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        comparisonId: row.comparisonId,
        createdAt: row.createdAt,
        avatarId: row.avatarId,
        runId: row.runId,
        seconds: row.seconds,
        size: row.size,
        beforeStatus: row.before.status,
        afterStatus: row.after.status,
        estimatedMicroUsd: row.before.estimatedMicroUsd + row.after.estimatedMicroUsd,
        actualMicroUsd: pairActualMicroUsd(row.before.actualMicroUsd, row.after.actualMicroUsd),
      }));
  }

  private clipMetaPath(comparisonId: string, side: ComparisonSide): string {
    return path.join(this.dir(comparisonId), `${side}.clip.json`);
  }

  async writeClip(
    comparisonId: string,
    side: ComparisonSide,
    bytes: Buffer,
    mediaType: string,
  ): Promise<void> {
    const file = `${side}.${mediaType === "video/webm" ? "webm" : "mp4"}`;
    // The bytes first. Metadata pointing at a file that is not there is a lie about what
    // was rendered; bytes with no metadata are recoverable by hand.
    await writeFile(path.join(this.dir(comparisonId), file), bytes);
    const meta: ClipMeta = { mediaType, file };
    await writeFile(this.clipMetaPath(comparisonId, side), JSON.stringify(meta), "utf8");
  }

  async readClip(
    comparisonId: string,
    side: ComparisonSide,
  ): Promise<{ bytes: Buffer; mediaType: string } | null> {
    try {
      const meta = JSON.parse(
        await readFile(this.clipMetaPath(comparisonId, side), "utf8"),
      ) as ClipMeta;
      const bytes = await readFile(path.join(this.dir(comparisonId), meta.file));
      return { bytes, mediaType: meta.mediaType };
    } catch {
      return null;
    }
  }
}
