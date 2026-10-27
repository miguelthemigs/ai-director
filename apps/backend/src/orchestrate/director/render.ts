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
  reduceDirectorEvents,
} from "@ai-director/contract";
import { POLL_DEADLINE_MS, POLL_INTERVAL_MS } from "../../compare/runComparison.js";
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
  /** Where a paid task id is written before it is logged to the store. Defaults to stderr. */
  log?: (line: string) => void;
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
/** Runs between a gate C approval and the end of its submit in this process, with a count per run. */
const pressing = new Map<string, number>();

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
  attempt: { attempt: number; estimatedMicroUsd: number },
  billing: Billing,
  failure: string,
  actualMicroUsd: number | null = null,
): Promise<void> {
  await emit({ type: "render.settled", ...attempt, status: "failed", billing, actualMicroUsd, failure });
  await emit({ type: "run.finished", status: "render_failed", reason: failure });
}

/**
 * Runs `work` (approving gate C, then submitting) with the run marked as pressed, so the render
 * resume never mistakes the moment between the approval and the claim for an interrupted press.
 */
export async function whileRenderPressed<T>(runId: string, work: () => Promise<T>): Promise<T> {
  pressing.set(runId, (pressing.get(runId) ?? 0) + 1);
  try {
    return await work();
  } finally {
    const left = (pressing.get(runId) ?? 1) - 1;
    if (left === 0) pressing.delete(runId);
    else pressing.set(runId, left);
  }
}

/**
 * Ends an attempt that failed before any task id was logged (a store error, or a crash between
 * the gate C approval and the claim): `render.settled` failed, then `run.finished render_failed`,
 * so "render again" is reachable. Billing is `not_billed` when the attempt was never claimed
 * (nothing can have been sent) and `unknown` when it was. Appends only what is not yet logged;
 * leaves an attempt with a `render.submitted` to the poll.
 */
export async function settleUnsubmitted(
  deps: RenderDeps,
  args: { runId: string; attempt: number; seconds: number; failure: string },
): Promise<void> {
  const { runId, attempt, failure } = args;
  const emit = emitter(deps, runId);
  let events = await deps.store.events(runId);
  if (events.some((event) => event.type === "render.submitted" && event.attempt === attempt)) return;
  const isMine = (event: DirectorEvent) => event.type === "render.settled" && event.attempt === attempt;
  if (!events.some(isMine)) {
    const billing: Billing = (await deps.store.hasRenderClaim(runId, attempt)) ? "unknown" : "not_billed";
    const estimatedMicroUsd = estimateMicroUsd(DIRECTOR_VIDEO_SIZE, args.seconds);
    await emit({ type: "render.settled", attempt, estimatedMicroUsd, status: "failed", billing, actualMicroUsd: null, failure });
    events = await deps.store.events(runId);
  }
  const at = events.findLastIndex(isMine);
  const settled = events[at] as Extract<DirectorEvent, { type: "render.settled" }>;
  if (settled.status !== "failed") return;
  if (!events.slice(at + 1).some((event) => event.type === "run.finished")) {
    await emit({ type: "run.finished", status: "render_failed", reason: settled.failure ?? failure });
  }
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
  // Marked in flight BEFORE the claim exists, so the resume can never see this claim without
  // also seeing that its submit is still running.
  const key = keyOf(runId, attempt);
  const marked = !submitting.has(key);
  if (marked) submitting.add(key);
  try {
    if ((await deps.store.claimRender(runId, attempt)) === "already_claimed") return "already_claimed";

    const emit = emitter(deps, runId);
    const settledAs = { attempt, estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, seconds) };
    const references = [...prompt.references].sort((a, b) => a.slot - b.slot);

    // Each reference is read from the run folder and sent inline as a data URL: the pictures
    // live only on this machine, like the avatar sheets, and are never hosted anywhere.
    const inline: string[] = [];
    const unreadable: string[] = [];
    for (const reference of references) {
      try {
        const bytes = await deps.store.readAsset(runId, reference.asset);
        inline.push(`data:${reference.mediaType};base64,${bytes.toString("base64")}`);
      } catch {
        unreadable.push(reference.handle);
      }
    }
    if (unreadable.length > 0) {
      await settleFailed(
        emit,
        settledAs,
        "not_billed",
        `reference ${unreadable.join(", ")} could not be read from the run folder, so nothing was sent to OpenRouter`,
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
            input_references: inline.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          }
        : {}),
    };

    let taskId: string;
    try {
      ({ taskId } = await deps.video.submit(request));
    } catch (err) {
      // Only a refusal OpenRouter answered (4xx) or a request never sent is provably free. A
      // timeout, a 5xx or an unreadable 2xx may have created a job: billing unknown.
      await settleFailed(emit, settledAs, submitProvablyUnbilled(err) ? "not_billed" : "unknown", message(err));
      return "submit_failed";
    }

    // Written out first: if the append below fails, this line is the only record of a paid task.
    (deps.log ?? console.error)(
      `director render: run ${runId} attempt ${attempt} submitted as OpenRouter task ${taskId}`,
    );
    // Before anything waits on it.
    await emit({ type: "render.submitted", taskId, ...settledAs });
    return "submitted";
  } finally {
    if (marked) submitting.delete(key);
  }
}

type Submitted = Extract<DirectorEvent, { type: "render.submitted" }>;

/** The `render.submitted` of `attempt`, or null when that attempt is already settled. */
function pendingTask(events: DirectorEvent[], runId: string, attempt: number): Submitted | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "render.submitted" && event.attempt === attempt) {
      return events.slice(i + 1).some((later) => later.type === "render.settled") ? null : event;
    }
  }
  throw new Error(`render attempt ${attempt} of run ${runId} was never submitted`);
}

/** Logs a terminal read: the clip when it succeeded, then `render.settled` and the run. */
async function finish(
  deps: SettleRenderDeps,
  emit: ReturnType<typeof emitter>,
  runId: string,
  submitted: Submitted,
  read: VideoTaskResult,
): Promise<void> {
  const settledAs = { attempt: submitted.attempt, estimatedMicroUsd: submitted.estimatedMicroUsd };
  const billing: Billing =
    read.status === "succeeded" || typeof read.actualMicroUsd === "number" ? "billed" : "unknown";

  if (read.status === "succeeded") {
    try {
      const clip = await deps.video.fetchClip(read.taskId);
      await deps.store.saveAsset(runId, `clip.${submitted.attempt}.mp4`, clip.bytes);
    } catch (err) {
      // `succeeded` is never logged without a saved clip: the run would read as a success
      // with nothing to play. The render HAPPENED and was paid for, so it stays billed at the
      // actual cost.
      await settleFailed(emit, settledAs, "billed", `clip download failed: ${message(err)}`, read.actualMicroUsd);
      return;
    }
    await emit({ type: "render.settled", ...settledAs, status: "succeeded", billing, actualMicroUsd: read.actualMicroUsd, failure: null });
    await emit({ type: "run.finished", status: "rendered", reason: null });
    return;
  }

  const failure = read.failure ?? `OpenRouter reported the render ${read.status}`;
  await emit({ type: "render.settled", ...settledAs, status: read.status, billing, actualMicroUsd: read.actualMicroUsd, failure });
  await emit({ type: "run.finished", status: "render_failed", reason: failure });
}

async function poll(deps: SettleRenderDeps, runId: string, attempt: number): Promise<void> {
  const submitted = pendingTask(await deps.store.events(runId), runId, attempt);
  if (submitted === null) return;
  const { taskId } = submitted;

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
      if (isRenderTerminal(read.status)) return finish(deps, emit, runId, submitted, read);
      if (read.status !== last) {
        last = read.status;
        await emit({ type: "render.polled", status: read.status, reads });
      }
    }

    if (now() - startedAt >= POLL_DEADLINE_MS) {
      // The task id stays in `render.submitted`: the clip may still complete and still bill.
      await settleFailed(
        emit,
        { attempt, estimatedMicroUsd: submitted.estimatedMicroUsd },
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
  const seen = await deps.store.events(runId);
  if (seen.length === 0) return;
  const attempt = nextRenderAttempt(seen);
  if (!(await deps.store.hasRenderClaim(runId, attempt))) return resumeUnclaimed(deps, runId, attempt);
  // Checked AFTER the claim is seen: a submit marks itself in flight before it claims, so a
  // claim with no mark here belongs to a submit that has already returned (or died).
  if (submitting.has(keyOf(runId, attempt))) return;
  // Re-read: that submit may have logged `render.submitted` or a settlement meanwhile.
  const events = await deps.store.events(runId);
  if (nextRenderAttempt(events) !== attempt) return;

  if (events.some((event) => event.type === "render.submitted" && event.attempt === attempt)) {
    await settleDirectorRender(deps, { runId, attempt });
    return;
  }
  // What was asked for is unknown; the length approved at gate A is the best evidence.
  const { seconds } = reduceDirectorEvents(events);
  if (seconds === null) {
    throw new Error(`render attempt ${attempt} is claimed but the run has no approved length`);
  }
  await settleFailed(
    emitter(deps, runId),
    { attempt, estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, seconds) },
    "unknown",
    `render attempt ${attempt} was claimed but no task id was ever recorded, so its outcome is unknown and it must not be resubmitted`,
  );
}

/**
 * A run approved at gate C that never claimed its attempt was interrupted between the two (a
 * crash, or a store error nobody could record). Nothing reached OpenRouter: settled failed,
 * `not_billed`, never submitted. The checks run in this order so a press in this process that
 * starts, approves or claims meanwhile is always seen.
 */
async function resumeUnclaimed(deps: SettleRenderDeps, runId: string, attempt: number): Promise<void> {
  const events = await deps.store.events(runId);
  const view = reduceDirectorEvents(events);
  if (view.gates.C !== "done" || view.status !== "running" || nextRenderAttempt(events) !== attempt) return;
  // A press marks itself before it approves, so an approval seen above is either still pressing
  // here, or has ended and left its claim (or its settlement) behind.
  if (pressing.has(runId)) return;
  if (await deps.store.hasRenderClaim(runId, attempt)) return;
  if (view.seconds === null) {
    throw new Error(`run ${runId} was approved at gate C with no approved length`);
  }
  await settleUnsubmitted(deps, {
    runId,
    attempt,
    seconds: view.seconds,
    failure: "interrupted before the render was claimed",
  });
}

/**
 * After a restart, for every run: a claimed attempt with `render.submitted` and no settlement
 * is polled on; a claimed attempt with no `render.submitted` is settled failed, billing
 * `unknown`; a run approved at gate C with no claim is settled failed, `not_billed`. Never submits. Awaits every poll it resumes, so the server boot need not await
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
