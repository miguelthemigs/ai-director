import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
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
  /** The full wrapped prompt, built once at create time and sent unchanged. */
  prompt: string;
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
  /**
   * Whether a claim is already held, WITHOUT taking one.
   *
   * `claimSubmit` cannot answer this question: asking it takes the claim, which would
   * permanently block a submit that had every right to happen. `refreshComparison` needs
   * to tell "nobody ever tried to submit this side" from "somebody tried and we never
   * learned the outcome", and only the second of those is settled as failed.
   */
  isSubmitClaimed(comparisonId: string, side: ComparisonSide): Promise<boolean>;
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
    prompt: source.prompt,
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

  /**
   * One promise chain per comparison id, serialising every read-modify-write on that
   * row.
   *
   * ── The bug this exists to prevent, found by the Task 6 tests ───────────────────
   * `stampTaskId` and `patchRender` both read the whole row, merge one side into it and
   * write the whole row back. `driveComparison` runs BOTH sides concurrently on purpose
   * (they must queue at the vendor together), so without this the two sides interleave:
   * each reads the same row, each merges only its own side, and the second write
   * silently discards the first side's changes. Observed directly — `before` stayed
   * `queued` with a null `taskId` for an entire drive while `after` succeeded.
   *
   * A lost `status` is a wrong screen. A lost `taskId` is a PAID RENDER NOBODY CAN FIND,
   * which is the exact failure the claim discipline in `compare/runComparison.ts` exists
   * to prevent, arriving by a different door.
   *
   * In-process is the right scope. One server owns a row's polling, and the
   * cross-process case that actually matters — two attempts submitting the same side —
   * is held by the claim file, which is atomic at the filesystem.
   */
  private readonly rowLocks = new Map<string, Promise<unknown>>();

  private withRowLock<T>(comparisonId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.rowLocks.get(comparisonId) ?? Promise.resolve();
    // `.then` on a settled-or-rejected prior: a failed write must not wedge the row, so
    // the chain continues from a resolved link either way.
    const next = prior.then(fn, fn);
    this.rowLocks.set(
      comparisonId,
      next.catch(() => undefined),
    );
    return next;
  }

  private dir(comparisonId: string): string {
    return path.join(this.root, comparisonId);
  }

  /**
   * Write to a sibling temp file, then rename over the target.
   *
   * ── Why not a plain `writeFile` ────────────────────────────────────────────────
   * `writeFile` truncates and then writes, so for a moment the row on disk is empty or
   * half a JSON document. A concurrent reader that hits that moment throws in
   * `JSON.parse`, and `get` answers `null` for a row that exists. Found by the Task 6
   * tests, which failed about half the time until this landed.
   *
   * That null is not cosmetic. `applyCheck` in `compare/runComparison.ts` treats a row
   * it cannot read as "nothing to poll" and stops polling — so a torn read would
   * abandon a render that OpenRouter is still working on and still billing for. Both
   * sides of a comparison read and write this file concurrently by design, so the
   * window is hit often rather than rarely.
   *
   * `rename` within one directory is atomic on POSIX: a reader sees either the whole old
   * file or the whole new one, never a partial write. The temp name carries the pid and
   * a random suffix so two writers cannot collide on it.
   */
  private async write(row: ComparisonView): Promise<void> {
    const target = path.join(this.dir(row.comparisonId), ROW_FILE);
    const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, JSON.stringify(row, null, 2), "utf8");
    await rename(temp, target);
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

  async isSubmitClaimed(comparisonId: string, side: ComparisonSide): Promise<boolean> {
    try {
      await access(path.join(this.dir(comparisonId), `${side}.claim`));
      return true;
    } catch {
      return false;
    }
  }

  async stampTaskId(comparisonId: string, side: ComparisonSide, taskId: string): Promise<void> {
    await this.withRowLock(comparisonId, async () => {
      const row = await this.require(comparisonId);
      await this.write({
        ...row,
        [side]: { ...row[side], taskId, submittedAt: new Date().toISOString() },
      } as ComparisonView);
    });
  }

  async patchRender(
    comparisonId: string,
    side: ComparisonSide,
    patch: RenderPatch,
  ): Promise<ComparisonView> {
    return this.withRowLock(comparisonId, async () => {
      const row = await this.require(comparisonId);
      const merged = { ...row, [side]: { ...row[side], ...patch } } as ComparisonView;
      // The comparison finishes when both of its renders have, and not before. A pair
      // with one clip still running is not a finished comparison however good the other
      // one is.
      const bothDone =
        isRenderTerminal(merged.before.status) && isRenderTerminal(merged.after.status);
      merged.finishedAt = bothDone ? (merged.finishedAt ?? new Date().toISOString()) : null;
      await this.write(merged);
      return merged;
    });
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
    // Same atomic-rename discipline as `write`: `readClip` parses this, so a torn read
    // would report "no clip" for a clip that is sitting right beside it.
    const metaPath = this.clipMetaPath(comparisonId, side);
    const temp = `${metaPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, JSON.stringify(meta), "utf8");
    await rename(temp, metaPath);
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
