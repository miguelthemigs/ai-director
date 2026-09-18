import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isRenderTerminal,
  isValidVideoSeconds,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_SIZES,
  type ComparisonSummary,
  type ComparisonView,
  type RunSummary,
  type VideoSize,
} from "@ai-director/contract";
import { AvatarPicker } from "../components/AvatarPicker.js";
import { ClipPair } from "../components/ClipPair.js";
import { ComparisonHistory } from "../components/ComparisonHistory.js";
import { RunEventFeed } from "../components/RunEventFeed.js";
import { PromptPreview, type ComparisonPreview } from "../components/PromptPreview.js";
import { RunPicker } from "../components/RunPicker.js";
import { WireInspector } from "../components/WireInspector.js";
import { listAvatars, type AvatarRecord } from "../data/avatarApi.js";
import {
  formatMicroUsd,
  getComparison,
  listComparisons,
  previewComparison,
  refreshComparison,
  startComparison,
} from "../data/compareApi.js";
import type { RunClient } from "../data/RunClient.js";
import { useRunStream } from "../hooks/useRunStream.js";
import "../styles/compare-screen.css";

/**
 * The fourth screen, end to end: pick a person, grade and repair them, render both
 * descriptions, and watch every step of it happen.
 *
 * ── Everything happens here ─────────────────────────────────────────────────────────
 * The first version of this screen could only render runs that already existed, which
 * meant producing a v2 run was a trip to a different screen and back. Grading is now step
 * two of three, in place, with the run's own event stream on screen while it happens. The
 * command line still works and is still how a paid render is made without a browser, but
 * nothing here requires it.
 *
 * ── Transparency is the feature, not a debug mode ───────────────────────────────────
 * This screen exists to answer a question about a repair, and the last defect it found
 * was a repair that satisfied the rubric by inventing a hair length. That was catchable
 * only by reading what the Repairer was handed and what it gave back. So the run's
 * events, both prompts as sent, the task ids, the poll counts, the estimate and the bill
 * are all on screen. Nothing here is behind a flag.
 *
 * ── The one thing that spends money ─────────────────────────────────────────────────
 * "Render both", with the price beside it. Grading costs Anthropic tokens and is cheap;
 * rendering costs about $0.82 and says so before it is pressed.
 */

/** Between status reads of a running pair. Seedance takes one to three minutes at these
 *  sizes, so tighter buys requests rather than information. */
const POLL_MS = 4000;

function bothSidesTerminal(row: ComparisonView): boolean {
  return isRenderTerminal(row.before.status) && isRenderTerminal(row.after.status);
}

/**
 * A side that rendered and whose clip is not on disk yet.
 *
 * `succeeded` is not the end of the story. The bytes are fetched in a separate step after
 * the status read, so there is a window where OpenRouter says done and this server has
 * nothing to play. `CLIP_DOWNLOAD_FAILED` means that fetch was tried and failed, which IS
 * the end of the story, and is excluded so a genuinely missing clip does not poll forever.
 */
function awaitingClip(render: ComparisonView["before"]): boolean {
  return (
    render.status === "succeeded" &&
    render.clipUrl === null &&
    render.failureCode !== "CLIP_DOWNLOAD_FAILED"
  );
}

/**
 * Whether there is still anything to wait for.
 *
 * Deliberately NOT `bothSidesTerminal`. Stopping there was a real defect: once both sides
 * settled the interval was cleared, and any clip that had not landed by that exact tick
 * never appeared. The screen sat on "Rendered, but the clip is not on disk" for a clip
 * that was downloaded seconds later, with no way back except knowing to press a button.
 * A pair is finished when it is PLAYABLE, not when the vendor stopped working.
 */
function stillSettling(row: ComparisonView): boolean {
  return !bothSidesTerminal(row) || awaitingClip(row.before) || awaitingClip(row.after);
}

export function CompareScreen({
  live,
  client,
}: {
  live: boolean;
  client: RunClient;
}): React.JSX.Element {
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [history, setHistory] = useState<ComparisonSummary[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number>(DEFAULT_VIDEO_SECONDS);
  const [size, setSize] = useState<VideoSize>(DEFAULT_VIDEO_SIZE);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** What would be sent for the current (avatar, run). Fetched free, before spending. */
  const [preview, setPreview] = useState<ComparisonPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** The grading run this screen started, if any. Streams live into `RunEventFeed`. */
  const [gradingRunId, setGradingRunId] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const grade = useRunStream(client, gradingRunId, { live });

  const loadRuns = useCallback(async () => {
    const res = await fetch("/runs");
    if (res.ok) setRuns((await res.json()) as RunSummary[]);
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await listComparisons());
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    void listAvatars()
      .then(setAvatars)
      .catch(() => setAvatars([]));
    void loadRuns().catch(() => setRuns([]));
    void loadHistory();
  }, [live, loadRuns, loadHistory]);

  // A grading run that reaches a terminal state refreshes the run list and selects
  // itself, so the thing just produced is the thing about to be rendered.
  useEffect(() => {
    if (!gradingRunId) return;
    if (grade.status === "streaming" || grade.status === "running") return;
    setGrading(false);
    void loadRuns().then(() => setRunId(gradingRunId));
  }, [grade.status, gradingRunId, loadRuns]);

  const secondsValid = isValidVideoSeconds(seconds);
  const pairEstimate = useMemo(
    () => (secondsValid ? estimateMicroUsd(size, seconds) * 2 : null),
    [size, seconds, secondsValid],
  );

  // The preview is the answer to "what am I about to pay for", so it is fetched the moment
  // both halves of that question are known and never on a button press.
  useEffect(() => {
    if (!live || !avatarId || !runId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    void previewComparison(avatarId, runId)
      .then((next) => {
        if (!cancelled) setPreview(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview(null);
        // The same refusals POST would give, arriving free and before the money.
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [live, avatarId, runId]);

  const selectedAvatar = avatars.find((a) => a.id === avatarId) ?? null;
  const selectedRun = runs.find((r) => r.runId === runId) ?? null;

  /**
   * One tick.
   *
   * `getComparison` only READS the row; the clip download lives in `refreshComparison`,
   * server-side. So a tick that finds a succeeded side with no clip has to ask for the
   * refresh, or the bytes are never fetched and the player never appears. Both are free —
   * a status read costs nothing and a download costs nothing — and neither can submit.
   */
  const poll = useCallback(async (comparisonId: string, fetchClips = false) => {
    try {
      setComparison(
        fetchClips ? await refreshComparison(comparisonId) : await getComparison(comparisonId),
      );
    } catch {
      // A failed poll is not a failed render. The row on the server is the truth and the
      // next tick re-reads it.
    }
  }, []);

  useEffect(() => {
    if (!comparison || !stillSettling(comparison)) return;
    const needsClips = awaitingClip(comparison.before) || awaitingClip(comparison.after);
    const id = window.setInterval(
      () => void poll(comparison.comparisonId, needsClips),
      POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [comparison, poll]);

  async function startGrading(): Promise<void> {
    if (!avatarId || !selectedAvatar?.description) return;
    setError(null);
    setGrading(true);
    try {
      // The avatar id is what makes this a v2 run: the server hands the Repairer that
      // avatar's sheet and brief, so a repair can only claim what it can see.
      const { runId: newRunId } = await client.startRun(selectedAvatar.description, avatarId);
      setGradingRunId(newRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGrading(false);
    }
  }

  /**
   * A comparison is IN FLIGHT: submitted and not yet settled on both sides.
   *
   * This is what the spend button is disabled on, and `submitting` is not. `submitting`
   * is only true while the POST itself is in the air, which is about 200 milliseconds,
   * because the route answers 202 the moment the row is written and the render runs for
   * minutes afterwards. So the button went live again almost immediately with two paid
   * renders still running behind it, and five clicks in two and a half seconds bought five
   * pairs. Found the hard way on 2026-09-18; it cost about $4.15.
   */
  const inFlight = comparison !== null && stillSettling(comparison);

  async function render(): Promise<void> {
    // Belt as well as braces. The disabled attribute is the affordance; this is the
    // guarantee, because a disabled button is a rendering decision and a double submit is
    // money.
    if (!avatarId || !runId || submitting || inFlight) return;
    setError(null);
    setSubmitting(true);
    try {
      const row = await startComparison({ avatarId, runId, seconds, size });
      setComparison(row);
      await loadHistory();
    } catch (err) {
      // The server's own words: a run that repaired nothing, a run that is not this
      // avatar's, a missing key. Each needs reading rather than summarising.
      setError(err instanceof Error ? err.message : String(err));
      setComparison(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!comparison) return;
    setRefreshing(true);
    try {
      setComparison(await refreshComparison(comparison.comparisonId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  if (!live) {
    return (
      <div className="compare">
        <h1 className="compare__title">Compare</h1>
        <p className="compare-message">
          This screen needs the real backend. Every other screen runs on fixtures so it can
          be built and shown without one, but a fixture here would mean two invented video
          clips, and an invented artefact is the one thing this tool will not put on screen.
        </p>
      </div>
    );
  }

  return (
    <div className="compare">
      <header>
        <h1 className="compare__title">Compare</h1>
        <p className="compare__lede">
          One avatar, two clips, one variable. The left clip is rendered from the
          description as the describe step wrote it; the right from the same description
          after the Repairer finished with it. Size, seconds, model and shot wrapper are
          held identical, so anything you can see is the words.
        </p>
      </header>

      {/* ── 1 ───────────────────────────────────────────────────────────────────── */}
      <section className="step">
        <h2 className="step__title">
          <span className="step__num tnum">1</span> Who
        </h2>
        <AvatarPicker
          avatars={avatars}
          selectedId={avatarId}
          disabled={grading || submitting}
          onSelect={(id) => {
            setAvatarId(id);
            setRunId(null);
            setComparison(null);
            setGradingRunId(null);
          }}
        />
        {selectedAvatar?.description ? (
          <figure className="step__specimen">
            <figcaption>What the describe step wrote off this sheet. Never sent as an image.</figcaption>
            <blockquote className="quoted-text">{selectedAvatar.description}</blockquote>
          </figure>
        ) : null}
      </section>

      {/* ── 2 ───────────────────────────────────────────────────────────────────── */}
      <section className="step">
        <h2 className="step__title">
          <span className="step__num tnum">2</span> Grade and repair
        </h2>
        <p className="step__note">
          Grading costs Anthropic tokens, not a render credit. Naming the avatar is what
          gets this run Repairer v2, which is shown the character sheet and may only write
          what it can see there.
        </p>
        <button
          type="button"
          className="compare-secondary"
          disabled={!selectedAvatar?.description || grading || submitting}
          onClick={() => void startGrading()}
        >
          {grading ? "Grading…" : "Grade and repair with v2"}
        </button>

        {gradingRunId ? (
          <div className="step__feed">
            <p className="step__note tnum" data-testid="grading-status">
              run {gradingRunId.slice(0, 8)} · {grade.status}
            </p>
            <RunEventFeed events={grade.events} />
          </div>
        ) : null}

        <h3 className="step__sub">Or pick a run already graded</h3>
        <RunPicker
          runs={runs}
          avatarId={avatarId}
          selectedId={runId}
          disabled={grading || submitting}
          onSelect={(id) => {
            setRunId(id);
            setComparison(null);
          }}
        />
      </section>

      {/* ── 3 ───────────────────────────────────────────────────────────────────── */}
      <section className="step">
        <h2 className="step__title">
          <span className="step__num tnum">3</span> Render both
        </h2>

        <fieldset className="compare-controls">
          <legend className="sr-only">Render settings</legend>

          <div className="compare-field">
            <label htmlFor="compare-seconds">Seconds</label>
            <input
              id="compare-seconds"
              type="number"
              min={MIN_VIDEO_SECONDS}
              max={MAX_VIDEO_SECONDS}
              step={1}
              value={seconds}
              disabled={submitting}
              onChange={(event) => setSeconds(Number(event.target.value))}
            />
          </div>

          <div className="compare-field">
            <label htmlFor="compare-size">Size</label>
            <select
              id="compare-size"
              value={size}
              disabled={submitting}
              onChange={(event) => setSize(event.target.value as VideoSize)}
            >
              {VIDEO_SIZES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="compare-field">
            <span className="compare-estimate" data-testid="pair-estimate">
              {pairEstimate === null ? (
                <>
                  Seconds must be a whole number from {MIN_VIDEO_SECONDS} to{" "}
                  {MAX_VIDEO_SECONDS}.
                </>
              ) : (
                <>
                  Two clips, <strong>{formatMicroUsd(pairEstimate)}</strong>. Pressing this
                  spends it.
                </>
              )}
            </span>
            <button
              type="button"
              className="compare-submit"
              disabled={!avatarId || !runId || !secondsValid || submitting || inFlight}
              onClick={() => void render()}
            >
              {submitting ? "Submitting…" : inFlight ? "Rendering…" : "Render both"}
            </button>
          </div>
        </fieldset>

        {inFlight && comparison ? (
          <p className="compare-inflight" role="status" data-testid="in-flight">
            Two clips are rendering now, submitted{" "}
            {comparison.before.submittedAt
              ? new Date(comparison.before.submittedAt).toLocaleTimeString()
              : "just now"}
            . Seedance takes one to three minutes. Status reads so far:{" "}
            <span className="tnum">
              {comparison.before.polls} and {comparison.after.polls}
            </span>
            . This button stays disabled until both sides finish, so a second click cannot
            buy a second pair.
          </p>
        ) : null}

        {preview ? <PromptPreview preview={preview} /> : null}
        {previewError ? (
          <p className="compare-message" data-tone="alarm" data-testid="preview-error">
            {previewError}
          </p>
        ) : null}

        {selectedRun ? (
          <p className="step__note" data-testid="render-source">
            Rendering run {selectedRun.runId.slice(0, 8)}, repaired by{" "}
            {selectedRun.repairerPromptVersion
              ? `repairer ${selectedRun.repairerPromptVersion}`
              : "a repairer whose version was not recorded"}
            .
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="compare-message" data-tone="alarm" role="alert">
          {error}
        </p>
      ) : null}

      {comparison ? (
        <>
          <div className="compare-actions">
            <button
              type="button"
              className="compare-secondary"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Reading…" : "Re-read status from OpenRouter"}
            </button>
            <span className="compare-estimate">
              One status read per unfinished side. Never resubmits, so it cannot spend.
            </span>
          </div>
          <ClipPair comparison={comparison} />
          <WireInspector comparison={comparison} />
        </>
      ) : null}

      <section className="step">
        <h2 className="step__title">Everything rendered so far</h2>
        <ComparisonHistory
          rows={history}
          selectedId={comparison?.comparisonId ?? null}
          onOpen={(id) => void poll(id)}
        />
      </section>
    </div>
  );
}
