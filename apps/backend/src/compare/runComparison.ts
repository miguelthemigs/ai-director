import {
  estimateMicroUsd,
  isRenderTerminal,
  SEEDANCE_MODEL,
  type ComparisonSide,
  type ComparisonView,
  type VideoSize,
} from "@ai-director/contract";
import type {
  ComparisonSource,
  ComparisonStore,
  RenderPatch,
} from "../store/ComparisonStore.js";
import { buildShotPrompt, SHOT_PROMPT_VERSION } from "../video/shotPrompt/v1.js";
import type { VideoTransport } from "../video/openrouterClient.js";

/**
 * One comparison, driven to two clips.
 *
 * ── The claim discipline, ported from `render-ugc.ts` ───────────────────────────────
 * Verbatim in shape, per side:
 *   1. The submit claim is taken as a compare-and-swap BEFORE the vendor is called, so two
 *      concurrent ticks cannot both submit.
 *   2. If the claim is held and `taskId` is still null, the previous attempt's outcome is
 *      UNKNOWN. OpenRouter has no endpoint that lists tasks by anything we hold, so that id
 *      is unrecoverable. NEVER resubmit: settle failed and say why.
 *   3. The task id is stamped BEFORE anything waits on it. A lost id is a paid render
 *      nobody can find.
 *
 * ── Why both sides submit before either is polled ───────────────────────────────────
 * They are one comparison. Submitting the second only after the first finished would put
 * minutes between them and confound the result with whatever changed at OpenRouter in
 * between — a queue, a region, a silent model update. `allSettled`, not `all`: one side
 * failing must not abandon the other, which has already been paid for.
 *
 * ── Why time is injected ────────────────────────────────────────────────────────────
 * So the deadline is exercised in microseconds rather than fifteen minutes. Both have real
 * defaults; no caller in production passes either.
 */

/** Between status reads. Seedance takes one to three minutes at these sizes, so a tighter
 *  interval buys nothing but requests. */
export const POLL_INTERVAL_MS = 5_000;

/** Fifteen minutes, then the side settles failed WITH ITS TASK ID KEPT — the clip may
 *  still complete and still bill, and `refreshComparison` is how it is picked up. Nothing
 *  here resubmits and nothing deletes a claim. */
export const POLL_DEADLINE_MS = 900_000;

export type RunComparisonDeps = {
  store: ComparisonStore;
  transport: VideoTransport;
  /** Defaults to a real timer. Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `Date.now`. */
  now?: () => number;
};

export type StartComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  rubricVersion: string;
  repairerPromptVersion: string | null;
  sources: Record<ComparisonSide, ComparisonSource>;
};

const SIDES: readonly ComparisonSide[] = ["before", "after"];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** This server's own path for a stored clip. Never OpenRouter's content URL, which is
 *  ephemeral and needs a bearer token the browser must never hold. */
function clipPath(comparisonId: string, side: ComparisonSide): string {
  return `/compare/${comparisonId}/${side}/clip`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Creates the row and returns immediately. Spends nothing: the estimate is derived from
 * the published rate and the vendor is not called.
 */
export async function startComparison(
  deps: RunComparisonDeps,
  args: StartComparisonArgs,
): Promise<ComparisonView> {
  return deps.store.create({
    avatarId: args.avatarId,
    runId: args.runId,
    seconds: args.seconds,
    size: args.size,
    model: SEEDANCE_MODEL,
    shotPromptVersion: SHOT_PROMPT_VERSION,
    rubricVersion: args.rubricVersion,
    repairerPromptVersion: args.repairerPromptVersion,
    estimatedMicroUsd: estimateMicroUsd(args.size, args.seconds),
    sources: args.sources,
  });
}

/**
 * Submits one side, or explains why it will not.
 *
 * Returns the task id to poll, or `null` when this side is already settled.
 */
async function submitSide(
  deps: RunComparisonDeps,
  row: ComparisonView,
  side: ComparisonSide,
): Promise<string | null> {
  const render = row[side];

  // Already in flight from an earlier attempt: poll it, never submit it again.
  if (render.taskId !== null) return render.taskId;

  const claim = await deps.store.claimSubmit(row.comparisonId, side);
  if (claim === "already_claimed") {
    // The claim is held and no id was ever stamped, so a previous attempt reached the
    // point of calling OpenRouter and we do not know what happened. There is no endpoint
    // that can tell us. Resubmitting would risk paying twice for one clip with nobody ever
    // finding out, so this settles rather than retries.
    await deps.store.patchRender(row.comparisonId, side, {
      status: "failed",
      failureCode: "OPENROUTER_UNKNOWN_OUTCOME",
      failure:
        "a previous attempt claimed this submit and never recorded a task id, so its outcome is unknown and it must not be resubmitted",
      finishedAt: new Date().toISOString(),
    });
    return null;
  }

  try {
    const { taskId } = await deps.transport.submit({
      model: row.model,
      prompt: buildShotPrompt(render.description),
      duration: row.seconds,
      size: row.size,
      generate_audio: false,
    });
    // Before anything waits on it.
    await deps.store.stampTaskId(row.comparisonId, side, taskId);
    await deps.store.patchRender(row.comparisonId, side, { status: "running" });
    return taskId;
  } catch (err) {
    await deps.store.patchRender(row.comparisonId, side, {
      status: "failed",
      failureCode: "OPENROUTER_SUBMIT_FAILED",
      failure: errorMessage(err),
      finishedAt: new Date().toISOString(),
    });
    return null;
  }
}

/** Writes one status read onto the row. Returns whether the side is now terminal. */
async function applyCheck(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
  polls: number,
): Promise<boolean> {
  const row = await deps.store.get(comparisonId);
  const taskId = row?.[side].taskId;
  if (!row || !taskId) return true;

  let patch: RenderPatch;
  try {
    const result = await deps.transport.check(taskId);
    patch = {
      status: result.status,
      failureCode: result.failureCode,
      failure: result.failure,
      actualMicroUsd: result.actualMicroUsd,
      polls,
      ...(isRenderTerminal(result.status) ? { finishedAt: new Date().toISOString() } : {}),
    };
  } catch {
    // A status read that throws is not a settled render — the work may well be running.
    // Count the poll, record nothing else, and let the deadline decide.
    await deps.store.patchRender(comparisonId, side, { polls });
    return false;
  }

  const next = await deps.store.patchRender(comparisonId, side, patch);
  return isRenderTerminal(next[side].status);
}

/** Downloads a succeeded clip and points the row at this server's own path. */
async function storeClip(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
): Promise<void> {
  const row = await deps.store.get(comparisonId);
  const taskId = row?.[side].taskId;
  if (!row || !taskId || row[side].status !== "succeeded") return;

  try {
    const clip = await deps.transport.fetchClip(taskId);
    await deps.store.writeClip(comparisonId, side, clip.bytes, clip.mediaType);
    await deps.store.patchRender(comparisonId, side, {
      clipUrl: clipPath(comparisonId, side),
    });
  } catch (err) {
    // The render HAPPENED and was billed. Marking it failed would misreport the money and
    // hide a real, separate problem: the clip could not be fetched. Both facts are kept.
    await deps.store.patchRender(comparisonId, side, {
      failureCode: "CLIP_DOWNLOAD_FAILED",
      failure: `the render succeeded and was billed, but its clip could not be downloaded: ${errorMessage(err)}`,
    });
  }
}

async function driveSide(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
): Promise<void> {
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);
  if (isRenderTerminal(row[side].status)) return;

  const taskId = await submitSide(deps, row, side);
  if (taskId === null) return;

  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let polls = 0;

  for (;;) {
    polls += 1;
    if (await applyCheck(deps, comparisonId, side, polls)) break;

    if (now() - startedAt >= POLL_DEADLINE_MS) {
      // Failed, but the task id STAYS. The clip may still complete and still bill, and a
      // row with no id is a paid render nobody can find.
      await deps.store.patchRender(comparisonId, side, {
        status: "failed",
        failureCode: "OPENROUTER_POLL_TIMEOUT",
        failure: `still unfinished after ${Math.round(POLL_DEADLINE_MS / 1000)}s of polling; the task id is kept, so this can be re-read later`,
        finishedAt: new Date().toISOString(),
        polls,
      });
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await storeClip(deps, comparisonId, side);
}

/**
 * Both sides, all the way. Takes minutes; callers do not await it on a request path.
 */
export async function driveComparison(
  deps: RunComparisonDeps,
  comparisonId: string,
): Promise<ComparisonView> {
  // allSettled, deliberately: one side failing must not abandon the other, which has
  // already been submitted and will be billed whether or not anyone is watching it.
  await Promise.allSettled(SIDES.map((side) => driveSide(deps, comparisonId, side)));
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);
  return row;
}

/**
 * ONE status read per unfinished side, for a row this process lost — a restart under `tsx
 * watch`, a laptop closing, a poll deadline that expired while the clip was still queued.
 * Never submits, whatever state the row is in.
 */
export async function refreshComparison(
  deps: RunComparisonDeps,
  comparisonId: string,
): Promise<ComparisonView> {
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);

  await Promise.allSettled(
    SIDES.filter((side) => row[side].taskId !== null).map(async (side) => {
      if (isRenderTerminal(row[side].status) && row[side].clipUrl !== null) return;
      await applyCheck(deps, comparisonId, side, row[side].polls + 1);
      await storeClip(deps, comparisonId, side);
    }),
  );

  const next = await deps.store.get(comparisonId);
  if (!next) throw new Error(`comparison ${comparisonId} not found`);
  return next;
}
