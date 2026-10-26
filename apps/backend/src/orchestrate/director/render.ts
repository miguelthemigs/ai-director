import {
  DIRECTOR_VIDEO_SIZE,
  estimateMicroUsd,
  isRenderTerminal,
  SEEDANCE_MODEL,
  type AssembledPrompt,
  type Billing,
  type DirectorEvent,
  type DirectorEventBody,
  type RenderStatus,
} from "@ai-director/contract";
import { POLL_DEADLINE_MS, POLL_INTERVAL_MS } from "../../compare/runComparison.js";
import { isUploadThingUrl } from "../../images/referenceHost.js";
import type { DirectorRunStore } from "../../store/DirectorRunStore.js";
import {
  submitProvablyUnbilled,
  type VideoSubmitRequest,
  type VideoTaskResult,
  type VideoTransport,
} from "../../video/openrouterClient.js";

/**
 * One Seedance take of an assembled prompt, with its product and location references.
 *
 * ── The claim discipline, ported from `compare/runComparison.ts` ────────────────────
 *   1. `render.<attempt>.claim` is taken BEFORE the vendor is called, so two presses (or two
 *      processes) cannot both submit the same attempt.
 *   2. The task id is logged (`render.submitted`) BEFORE anything waits on it. A lost id is a
 *      paid render nobody can find.
 *   3. A claim with no `render.submitted` after a restart is an UNKNOWN outcome: OpenRouter
 *      has no endpoint that lists tasks by anything we hold. It is settled failed with
 *      billing `unknown`, never resubmitted.
 *   4. Nothing here retries a submit. "Render again" is a new press with the next attempt,
 *      its own claim and its own estimate.
 *
 * ── Attempts ────────────────────────────────────────────────────────────────────────
 * Every claimed attempt ends in exactly one `render.settled` (submit refused, submit failed,
 * polled to an end, or settled by the resume), so the attempt a press should claim is
 * {@link nextRenderAttempt}: one past the number of settlements. The resume relies on the
 * same rule to find the one attempt that can be unsettled.
 */

export type RenderDeps = {
  store: DirectorRunStore;
  video: VideoTransport;
  publish?: (ev: DirectorEvent) => void;
};

export type SettleRenderDeps = RenderDeps & {
  /** Defaults to a real timer. Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `Date.now`. */
  now?: () => number;
};

export type SubmitRenderOutcome = "submitted" | "already_claimed" | "submit_failed";

/** `${runId}:${attempt}` of every submit and settle running in this process. */
const submitting = new Set<string>();
const settling = new Set<string>();
const keyOf = (runId: string, attempt: number) => `${runId}:${attempt}`;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitter(deps: RenderDeps, runId: string) {
  return async (body: DirectorEventBody): Promise<DirectorEvent> => {
    const event = await deps.store.append(runId, body);
    deps.publish?.(event);
    return event;
  };
}

/** Ends an attempt that will never produce a clip: `render.settled` failed, then the run. */
async function settleFailed(
  emit: ReturnType<typeof emitter>,
  billing: Billing,
  failure: string,
): Promise<void> {
  await emit({ type: "render.settled", status: "failed", billing, actualMicroUsd: null, failure });
  await emit({ type: "run.finished", status: "render_failed", reason: failure });
}

/** The attempt the next render press claims: one past the number of settled attempts. */
export function nextRenderAttempt(events: DirectorEvent[]): number {
  return events.filter((event) => event.type === "render.settled").length + 1;
}

/**
 * Claims `attempt`, submits once, and logs the task id. Returns as soon as the task is known
 * (the caller fires {@link settleDirectorRender} without awaiting it). `"already_claimed"`
 * submits nothing (the route answers 409). `"submit_failed"` has already logged
 * `render.settled` failed and `run.finished render_failed`.
 */
export async function submitDirectorRender(
  deps: RenderDeps,
  args: { runId: string; attempt: number; prompt: AssembledPrompt; seconds: number },
): Promise<SubmitRenderOutcome> {
  const { runId, attempt, prompt, seconds } = args;
  if ((await deps.store.claimRender(runId, attempt)) === "already_claimed") return "already_claimed";

  const key = keyOf(runId, attempt);
  submitting.add(key);
  try {
    const emit = emitter(deps, runId);
    const references = [...prompt.references].sort((a, b) => a.slot - b.slot);

    // OpenRouter fetches each reference by URL. Only UploadThing's hosts are ones this repo
    // put there, so anything else is refused here, before any request leaves the process.
    const foreign = references.filter((reference) => !isUploadThingUrl(reference.url));
    if (foreign.length > 0) {
      await settleFailed(
        emit,
        "not_billed",
        `reference ${foreign.map((r) => r.handle).join(", ")} is not an UploadThing URL, so nothing was sent to OpenRouter`,
      );
      return "submit_failed";
    }

    const request: VideoSubmitRequest = {
      model: SEEDANCE_MODEL,
      prompt: prompt.text,
      duration: seconds,
      size: DIRECTOR_VIDEO_SIZE,
      generate_audio: true,
      ...(references.length > 0
        ? {
            input_references: references.map((reference) => ({
              type: "image_url" as const,
              image_url: { url: reference.url },
            })),
          }
        : {}),
    };

    let taskId: string;
    try {
      ({ taskId } = await deps.video.submit(request));
    } catch (err) {
      // Only a refusal OpenRouter answered (4xx) or a request never sent is provably free. A
      // timeout, a 5xx or an unreadable 2xx may have created a job: billing unknown.
      await settleFailed(emit, submitProvablyUnbilled(err) ? "not_billed" : "unknown", message(err));
      return "submit_failed";
    }

    // Before anything waits on it.
    await emit({
      type: "render.submitted",
      attempt,
      taskId,
      estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, seconds),
    });
    return "submitted";
  } finally {
    submitting.delete(key);
  }
}

/** The task id of `attempt`, or null when that attempt is already settled. */
function pendingTask(events: DirectorEvent[], runId: string, attempt: number): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "render.submitted" && event.attempt === attempt) {
      return events.slice(i + 1).some((later) => later.type === "render.settled") ? null : event.taskId;
    }
  }
  throw new Error(`render attempt ${attempt} of run ${runId} was never submitted`);
}

/** Logs a terminal read: the clip when it succeeded, then `render.settled` and the run. */
async function finish(
  deps: SettleRenderDeps,
  emit: ReturnType<typeof emitter>,
  runId: string,
  attempt: number,
  read: VideoTaskResult,
): Promise<void> {
  const billing: Billing =
    read.status === "succeeded" || typeof read.actualMicroUsd === "number" ? "billed" : "unknown";
  let failure = read.failure ?? (read.status === "succeeded" ? null : `OpenRouter reported the render ${read.status}`);
  let clipSaved = false;
  if (read.status === "succeeded") {
    try {
      const clip = await deps.video.fetchClip(read.taskId);
      await deps.store.saveAsset(runId, `clip.${attempt}.mp4`, clip.bytes);
      clipSaved = true;
    } catch (err) {
      // The render HAPPENED and was billed: it stays `succeeded` and `billed`. The run still
      // has no clip, so it does not finish as a success.
      failure = `the render succeeded and was billed, but its clip could not be downloaded and saved: ${message(err)}`;
    }
  }
  await emit({ type: "render.settled", status: read.status, billing, actualMicroUsd: read.actualMicroUsd, failure });
  await emit({
    type: "run.finished",
    status: clipSaved ? "rendered" : "render_failed",
    reason: clipSaved ? null : failure,
  });
}

async function poll(deps: SettleRenderDeps, runId: string, attempt: number): Promise<void> {
  const taskId = pendingTask(await deps.store.events(runId), runId, attempt);
  if (taskId === null) return;

  const emit = emitter(deps, runId);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let reads = 0;
  let last: RenderStatus | null = null;

  for (;;) {
    reads += 1;
    let read: VideoTaskResult | null = null;
    try {
      read = await deps.video.check(taskId);
    } catch {
      // A status read that throws is not a settled render — the work may well be running.
      // Count it and let the deadline decide.
    }
    if (read !== null) {
      if (isRenderTerminal(read.status)) return finish(deps, emit, runId, attempt, read);
      if (read.status !== last) {
        last = read.status;
        await emit({ type: "render.polled", status: read.status, reads });
      }
    }

    if (now() - startedAt >= POLL_DEADLINE_MS) {
      // The task id stays in `render.submitted`: the clip may still complete and still bill.
      await settleFailed(
        emit,
        "unknown",
        `task ${taskId} was still unfinished after ${Math.round(POLL_DEADLINE_MS / 1000)}s of polling; it may still complete and bill`,
      );
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Polls a submitted attempt until it ends (or the deadline passes) and logs the outcome.
 * Takes minutes; callers do not await it on a request path. A second call for the same
 * attempt while one is polling in this process returns at once; a call after it settled
 * appends nothing. Throws when the attempt was never submitted.
 */
export async function settleDirectorRender(
  deps: SettleRenderDeps,
  args: { runId: string; attempt: number },
): Promise<void> {
  const key = keyOf(args.runId, args.attempt);
  if (settling.has(key)) return;
  settling.add(key);
  try {
    await poll(deps, args.runId, args.attempt);
  } finally {
    settling.delete(key);
  }
}

async function resumeRun(deps: SettleRenderDeps, runId: string): Promise<void> {
  const events = await deps.store.events(runId);
  if (events.length === 0) return;
  const attempt = nextRenderAttempt(events);
  if (submitting.has(keyOf(runId, attempt))) return;
  if (!(await deps.store.hasRenderClaim(runId, attempt))) return;

  if (events.some((event) => event.type === "render.submitted" && event.attempt === attempt)) {
    await settleDirectorRender(deps, { runId, attempt });
    return;
  }
  await settleFailed(
    emitter(deps, runId),
    "unknown",
    `render attempt ${attempt} was claimed but no task id was ever recorded, so its outcome is unknown and it must not be resubmitted`,
  );
}

/**
 * After a restart, for every run: a claimed attempt with `render.submitted` and no settlement
 * is polled on; a claimed attempt with no `render.submitted` is settled failed, billing
 * `unknown`. Never submits. Awaits every poll it resumes, so the server boot need not await
 * it. Throws once, naming every run it could not resume.
 */
export async function resumeDirectorRenders(deps: SettleRenderDeps): Promise<void> {
  const ids = await deps.store.listIds();
  const results = await Promise.allSettled(ids.map((runId) => resumeRun(deps, runId)));
  const failed = results.flatMap((result, i) =>
    result.status === "rejected" ? [`${ids[i]}: ${message(result.reason)}`] : [],
  );
  if (failed.length > 0) throw new Error(`could not resume the render of ${failed.join("; ")}`);
}
