/**
 * The video comparison, as the wire carries it.
 *
 * ── Why a pure pricing formula sits in the contract package ─────────────────────────
 * `CLAUDE.md` makes this package the only definition of types that cross the network, and
 * these functions are not types. They are here anyway, for the reason Mentic split
 * `lib/openrouter/seedance-pricing.ts` out of its video client: the screen has to show an
 * estimate BEFORE anything is submitted, so the formula has to be loadable by a browser.
 * The only alternatives are a second copy of it in the frontend — the defect `CLAUDE.md`
 * names — or an HTTP round trip to multiply four numbers. This file imports nothing and
 * touches no network, so both sides can load it.
 *
 * ── The estimate is not the bill ────────────────────────────────────────────────────
 * `estimateMicroUsd` is a property of the REQUEST, computed from the published rate before
 * submitting. `RenderView.actualMicroUsd` is a property of the OUTCOME, reported by
 * OpenRouter as `usage.cost` on the terminal task. They are two fields and the estimate
 * never overwrites the bill, even when they agree.
 */

/** OpenRouter's model slug. The only video model this repo asks for. */
export const SEEDANCE_MODEL = "bytedance/seedance-2.5";

/**
 * The two sizes this repo offers, cheapest first. Both vertical, both on OpenRouter's
 * published list for this model.
 *
 * OpenRouter publishes twelve. Ten of them are absent deliberately: a size picker that
 * accepts a shape nobody has rendered here is a paid render finding out whether it works.
 * Adding a third is a one-line change plus a probe, in that order.
 */
export const VIDEO_SIZES = ["480x854", "720x1280"] as const;
export type VideoSize = (typeof VIDEO_SIZES)[number];

/** The cheapest usable vertical shape, and therefore the default. */
export const DEFAULT_VIDEO_SIZE: VideoSize = "480x854";

export function videoSizeDimensions(size: VideoSize): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  // Neither can be undefined for a member of VIDEO_SIZES; the guard exists so a future
  // entry typed with a comma or an "×" fails here rather than producing NaN micro-USD.
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`video size "${size}" is not <width>x<height>`);
  }
  return { width: width as number, height: height as number };
}

/** OpenRouter accepts an integer 4..30 for this model. */
export const MIN_VIDEO_SECONDS = 4;
export const MAX_VIDEO_SECONDS = 30;
/** The model's floor, which is also the cheapest clip that shows a face moving. */
export const DEFAULT_VIDEO_SECONDS = 4;

export function isValidVideoSeconds(seconds: number): boolean {
  return (
    Number.isInteger(seconds) && seconds >= MIN_VIDEO_SECONDS && seconds <= MAX_VIDEO_SECONDS
  );
}

/** Seedance renders at a fixed 24fps. The token count is derived from that, not from a
 *  per-request frame rate the API accepts. */
export const SEEDANCE_FPS = 24;

/**
 * Micro-USD per video token, from `GET /api/v1/videos/models`'s `pricing_skus.video_tokens`
 * for `bytedance/seedance-2.5`. $0.0000107 per token.
 */
export const MICRO_USD_PER_VIDEO_TOKEN = 10.7;

/** OpenRouter's own formula: `width * height * fps * seconds / 1024`. */
export function videoTokens(width: number, height: number, seconds: number): number {
  return (width * height * SEEDANCE_FPS * seconds) / 1024;
}

/**
 * Integer micro-USD for one clip, rounded once at the end. An ESTIMATE from the published
 * rate — never written into `actualMicroUsd`, which is the vendor's own figure.
 */
export function estimateMicroUsd(size: VideoSize, seconds: number): number {
  const { width, height } = videoSizeDimensions(size);
  return Math.round(videoTokens(width, height, seconds) * MICRO_USD_PER_VIDEO_TOKEN);
}

export const RENDER_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** Named `isRenderTerminal`, not `isTerminal`: `run.ts` already exports `isTerminal` for a
 *  run's status and both are re-exported from the same barrel. */
export function isRenderTerminal(status: RenderStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** The single place that decides whether the UI may show a clip as a win. `cancelled` is
 *  terminal and is not success — the same rule `isSuccess` encodes for a run. */
export function isRenderSuccess(status: RenderStatus): boolean {
  return status === "succeeded";
}

/** Which description produced this clip. "before" is the raw describe output; "after" is
 *  the text as it stood when the run finished repairing it. */
export type ComparisonSide = "before" | "after";

export const COMPARISON_SIDES = ["before", "after"] as const;

export type RenderView = {
  side: ComparisonSide;
  status: RenderStatus;
  /** Stamped before anything waits on it. Null only before the submit returned. */
  taskId: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
  /** Machine-readable, e.g. "OPENROUTER_FAILED" or "OPENROUTER_UNKNOWN_OUTCOME". */
  failureCode: string | null;
  failure: string | null;
  /** From the published rate, before submitting. Always present. */
  estimatedMicroUsd: number;
  /** OpenRouter's own `usage.cost`, x 1e6, rounded. Null — never 0 — when the terminal
   *  task reported no cost. */
  actualMicroUsd: number | null;
  /** This server's own path for the stored clip, never OpenRouter's content URL, which is
   *  ephemeral and needs a bearer token the browser must never hold. */
  clipUrl: string | null;
  /** The exact description sent, stored verbatim so the comparison is reproducible. */
  description: string;
  /**
   * The WHOLE prompt as it went on the wire: the shared shot wrapper with this side's
   * description spliced into it.
   *
   * Stored rather than re-derived for display. A screen that rebuilt this from
   * `description` would be showing what the wrapper says TODAY, which after a `v2.ts`
   * ships is not what this row was rendered from. The claim the whole screen makes is
   * "these two prompts differ in one place", and the only way to let someone check that
   * claim is to keep both prompts exactly as they were sent.
   */
  prompt: string;
  /** The discriminator that works without any version record: two descriptions from two
   *  prompt versions hash differently. */
  descriptionSha256: string;
  /** Off the run manifest. */
  rubricVersion: string;
  /** Off the run manifest when it records one, else null. Never guessed: null means "this
   *  run predates the record", which is a different thing from "v1". */
  repairerPromptVersion: string | null;
  /** How many status reads have been taken. The Compare screen shows this instead of a
   *  spinner, because a poll returning is a real state change and a spinner is not. */
  polls: number;
};

export type ComparisonView = {
  comparisonId: string;
  createdAt: string;
  finishedAt: string | null;
  /** Whose sheet the two clips are compared against. The sheet is shown on screen and is
   *  never sent to the video model. */
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  model: string;
  /** Which version of the shared shot wrapper both clips used. */
  shotPromptVersion: string;
  before: RenderView;
  after: RenderView;
};

/** What `GET /compare` can answer without reading a row's full body. */
export type ComparisonSummary = {
  comparisonId: string;
  createdAt: string;
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  beforeStatus: RenderStatus;
  afterStatus: RenderStatus;
  /** The pair's estimate: both sides summed. Always present. */
  estimatedMicroUsd: number;
  /** The pair's bill, summed. Null unless BOTH sides reported one — a half-known total is
   *  a wrong total, and rendering it as if it were the pair's cost would understate it. */
  actualMicroUsd: number | null;
};

/** The pair's bill, or null when either side has not reported one. Exported rather than
 *  inlined at each call site so the "both or nothing" rule has exactly one definition. */
export function pairActualMicroUsd(
  before: number | null,
  after: number | null,
): number | null {
  return before === null || after === null ? null : before + after;
}
