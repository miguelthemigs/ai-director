import type { RenderStatus } from "@ai-director/contract";

/**
 * Seedance 2.5 over OpenRouter's `/videos` endpoints.
 *
 * Ported from `lib/openrouter/video-client.ts` in the Mentic repo (read 2026-09-16), which
 * has run real paid renders through this exact call shape since 2026-09-15. Plain `fetch`,
 * because OpenRouter publishes no first-party Node SDK for `/videos`.
 *
 * ── What was NOT ported, and why ────────────────────────────────────────────────────
 * Mentic's `VideoTaskResult` re-exports Runway's own result type widened, so two
 * transports read through one shape, and carries `outputUrls`, `progress` and
 * `actualCredits`. This repo has one transport and no Runway client. All three fields
 * would be structurally dead here — `actualCredits` always null, `progress` always null
 * because OpenRouter reports no fraction, `outputUrls` a one-element array of a URL only
 * this server may fetch — so the type is written narrow rather than inherited wide.
 *
 * ── Nothing here decides what to render ─────────────────────────────────────────────
 * Same discipline as the file it came from: this module submits and polls once told to.
 * Which description, which size and which seconds are decided in `compare/runComparison.ts`,
 * and the claim discipline that keeps a submit from happening twice lives there too,
 * because it needs a store.
 *
 * ── Text only ───────────────────────────────────────────────────────────────────────
 * `VideoSubmitRequest` has no `input_references` and no `frame_images` field, so there is
 * no way to add one without editing this type. That is deliberate. Mentic's nine probe
 * calls on 2026-08-25 established that a human likeness in an input image is refused at
 * full latency on every render.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** `POST` here submits a render. Exported so a caller recording what it sent reads the
 *  endpoint off the one string this file actually posts to. */
export const OPENROUTER_VIDEOS_ENDPOINT = `${OPENROUTER_BASE_URL}/videos`;

/**
 * Per-request ceiling. 60s, not less, and the reasoning is Mentic's: a submit aborted
 * client-side AFTER OpenRouter accepted it is the expensive failure — a task that bills
 * with no id ever stored on our side. Nothing here runs anywhere a real Node timer cannot
 * fire.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Longest raw-body snippet an error message quotes, so an HTML gateway page cannot bloat
 *  what gets written onto a render row. */
const ERROR_BODY_SNIPPET_LENGTH = 200;

/** What a finished clip is assumed to be when the vendor names no type. */
const DEFAULT_CLIP_MEDIA_TYPE = "video/mp4";

/** The body this client posts. No image field exists, by construction. */
export type VideoSubmitRequest = {
  model: string;
  prompt: string;
  /** Integer seconds, 4..30 for this model. Validated by the caller. */
  duration: number;
  size: string;
  generate_audio: boolean;
};

export type VideoTaskResult = {
  taskId: string;
  status: RenderStatus;
  failureCode: string | null;
  failure: string | null;
  /** `usage.cost` x 1e6, rounded. Null — never 0 — when the terminal task reported none. */
  actualMicroUsd: number | null;
};

/**
 * The injected seam, following `ImageTransport` in `avatar/generateSheet.ts` and
 * `ParseTransport` in `api/client.ts`. Everything above it takes one of these, so no test
 * in this repo can spend money by accident.
 */
export type VideoTransport = {
  submit(req: VideoSubmitRequest): Promise<{ taskId: string }>;
  check(taskId: string): Promise<VideoTaskResult>;
  /** The clip bytes. Separate from `check` because it is only ever called once, on a
   *  succeeded task, and because the caller writes them to disk rather than holding them. */
  fetchClip(taskId: string): Promise<{ bytes: Buffer; mediaType: string }>;
};

/**
 * NOTHING LEFT THE PROCESS. Thrown before any `fetch`, so a call that fails this way
 * provably reached no vendor and provably billed nothing.
 */
export class OpenRouterConfigError extends Error {
  readonly name = "OpenRouterConfigError";
}

/**
 * OPENROUTER ANSWERED, and the answer was not a success. Carries the HTTP status, which is
 * the only evidence this client can offer about whether a job was created — precisely what
 * a timeout, an abort or a socket reset cannot tell us, which is why those keep throwing
 * their own raw types rather than this one.
 */
export class OpenRouterHttpError extends Error {
  readonly name = "OpenRouterHttpError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * CAN A FAILED SUBMIT BE RETRIED WITHOUT RISKING A SECOND CHARGE?
 *
 * True for exactly two shapes, and the burden of proof is entirely on true:
 *   1. {@link OpenRouterConfigError} — no request was made.
 *   2. {@link OpenRouterHttpError} with a 4xx — OpenRouter answered that it would not
 *      accept the request, and a rejected request creates no job.
 *
 * A TIMEOUT is billed until proven otherwise: an abort cancels our wait, not the vendor's
 * work, and there is no endpoint that lists jobs by anything we hold, so re-rendering
 * would charge twice for one clip and nobody would find out. Its transience is not the
 * question; whether a job exists is, and a timeout cannot answer it.
 *
 * A 5xx would qualify only if its body PROVED no job was created, and OpenRouter's error
 * envelope cannot distinguish "rejected before scheduling" from "scheduled, then failed
 * while answering". A 2xx with an unparseable body is the worst case of all: the job
 * almost certainly exists and what was lost is its id.
 *
 * Nothing in this repo retries a submit. This is here so the decision is auditable and so
 * the CLI can print it.
 */
export function submitProvablyUnbilled(err: unknown): boolean {
  if (err instanceof OpenRouterConfigError) return true;
  return err instanceof OpenRouterHttpError && err.status >= 400 && err.status < 500;
}

/** Read at call time, so importing this module without a key never throws. */
function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new OpenRouterConfigError(
      "OPENROUTER_API_KEY missing, required for OpenRouter video generation",
    );
  }
  return key;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}` };
}

/** OpenRouter's own URL for the finished clip. EPHEMERAL, and it requires the bearer
 *  token, which is why the browser is never given it. */
export function openrouterContentUrl(taskId: string): string {
  return `${OPENROUTER_BASE_URL}/videos/${taskId}/content?index=0`;
}

/** OpenRouter's task status vocabulary. */
type UpstreamStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type UpstreamStatusResponse = {
  id: string;
  status: UpstreamStatus;
  usage?: { cost?: number | null } | null;
  error?: { code?: string | null; message?: string | null } | null;
};

/**
 * Reads `error.message` off a non-2xx body, falling back to a status line with a truncated
 * snippet of the raw body attached rather than discarding text already read for nothing.
 * This is what gets written onto a render row, so it must never be empty.
 */
async function upstreamErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string | null } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON, or not the documented shape — fall through to the status line.
  }
  const snippet =
    text.length > ERROR_BODY_SNIPPET_LENGTH
      ? `${text.slice(0, ERROR_BODY_SNIPPET_LENGTH)}…`
      : text;
  return snippet
    ? `OpenRouter request failed with status ${res.status}: ${snippet}`
    : `OpenRouter request failed with status ${res.status}`;
}

/**
 * Maps one `GET /videos/{id}` body onto a {@link VideoTaskResult}.
 *
 * `expired` maps to FAILED: a render that timed out upstream is a failure from our side
 * too, not something to keep polling. An unrecognised status maps to FAILED rather than
 * falling through to `undefined` — `body.status` comes off a force-cast `res.json()` with
 * no runtime validation, so the six-way union it is typed as is not a guarantee. FAILED
 * and not a throw, because a caller that treats a thrown check as "unsettled, retry later"
 * would poll an unrecognised-forever status for the whole window instead of surfacing it.
 */
function classify(body: UpstreamStatusResponse): VideoTaskResult {
  const actualMicroUsd =
    typeof body.usage?.cost === "number" ? Math.round(body.usage.cost * 1_000_000) : null;
  const base = { taskId: body.id, failureCode: null, failure: null, actualMicroUsd };

  switch (body.status) {
    case "pending":
      return { ...base, status: "queued" };
    case "in_progress":
      return { ...base, status: "running" };
    case "completed":
      return { ...base, status: "succeeded" };
    case "cancelled":
      return { ...base, status: "cancelled" };
    case "failed":
    case "expired":
      return {
        ...base,
        status: "failed",
        failureCode: body.error?.code ?? "OPENROUTER_FAILED",
        failure: body.error?.message ?? null,
      };
    default:
      return {
        ...base,
        status: "failed",
        failureCode: "OPENROUTER_UNKNOWN_STATUS",
        failure: `OpenRouter reported an unrecognised status "${String(body.status)}" for task ${body.id}.`,
      };
  }
}

/** The one implementation that talks to OpenRouter. Constructed in `server.ts` and in the
 *  comparison CLI, and nowhere else. */
export function createOpenRouterVideoTransport(): VideoTransport {
  return {
    async submit(req) {
      const res = await fetch(OPENROUTER_VIDEOS_ENDPOINT, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Typed, because the STATUS is evidence: see `submitProvablyUnbilled`.
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      let body: { id?: string };
      try {
        body = (await res.json()) as { id?: string };
      } catch (err) {
        throw new Error(
          `OpenRouter returned an unparseable response for the video submit: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (typeof body.id !== "string" || body.id.length === 0) {
        // A 2xx with no id is the one outcome that is certainly billed and certainly
        // unrecoverable. It has to fail loudly rather than return an undefined id that a
        // caller would happily write to disk.
        throw new Error(
          "OpenRouter accepted the video submit but returned no task id, so the render cannot be tracked",
        );
      }
      return { taskId: body.id };
    },

    async check(taskId) {
      const res = await fetch(`${OPENROUTER_BASE_URL}/videos/${taskId}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      let body: UpstreamStatusResponse;
      try {
        body = (await res.json()) as UpstreamStatusResponse;
      } catch (err) {
        throw new Error(
          `OpenRouter returned an unparseable status response for task ${taskId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return classify(body);
    },

    async fetchClip(taskId) {
      const res = await fetch(openrouterContentUrl(taskId), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return {
        bytes,
        mediaType: res.headers.get("Content-Type") ?? DEFAULT_CLIP_MEDIA_TYPE,
      };
    },
  };
}
