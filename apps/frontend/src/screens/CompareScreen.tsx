import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isRenderTerminal,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_SIZES,
  type ComparisonView,
  type VideoSize,
} from "@ai-director/contract";
import { ClipPair } from "../components/ClipPair.js";
import { avatarImageUrl, listAvatars, type AvatarRecord } from "../data/avatarApi.js";
import { formatMicroUsd, getComparison, startComparison } from "../data/compareApi.js";
import "../styles/compare-screen.css";

/**
 * The fourth screen: two clips from one avatar, where the only variable is the
 * description.
 *
 * ── This is the only screen in the app that spends a render credit ──────────────────
 * PRODUCT.md walls it off from the grading surface for exactly that reason. It scores
 * nothing, writes no rubric result and adds no event to the run stream. A reader who
 * distrusts the render numbers can discard this screen whole and every number on Run,
 * Architecture and Versions still stands.
 *
 * The estimate is on screen BEFORE the button that spends it, derived from the live
 * controls rather than written down, so changing the size changes the price in the same
 * frame. `estimateMicroUsd` is the same function the server prices the row with.
 *
 * ── Polling, not streaming ──────────────────────────────────────────────────────────
 * The contract's `EVENT_NAMES` enumerates the nine names spec §6 defines, and the
 * decision log (2026-09-11) records that adding a tenth is a spec change rather than a
 * bug fix. So this screen polls, and every poll that returns is a real state change it
 * may render. The interval stops the moment both sides are terminal, and on unmount.
 *
 * ── No fixture mode ─────────────────────────────────────────────────────────────────
 * Every other screen can be driven from fixtures so it can be built and shown with no
 * backend. A fixture here would mean inventing two plausible-looking video clips, which
 * is precisely the artefact this product refuses to fabricate. So in fixture mode the
 * screen says it needs the real backend and offers no button at all.
 */

/** Between status reads. A pair takes one to three minutes; a tighter interval buys
 *  requests rather than information. */
const POLL_MS = 4000;

type RunRow = {
  runId: string;
  rubricVersion: string;
  status: string;
  startedAt: string;
  passes: number;
};

function bothSidesTerminal(row: ComparisonView): boolean {
  return isRenderTerminal(row.before.status) && isRenderTerminal(row.after.status);
}

export function CompareScreen({ live }: { live: boolean }): React.JSX.Element {
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [avatarId, setAvatarId] = useState<string>("");
  const [runId, setRunId] = useState<string>("");
  const [seconds, setSeconds] = useState<number>(DEFAULT_VIDEO_SECONDS);
  const [size, setSize] = useState<VideoSize>(DEFAULT_VIDEO_SIZE);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!live) return;
    void listAvatars()
      .then(setAvatars)
      .catch(() => setAvatars([]));
    void fetch("/runs")
      .then((res) => (res.ok ? (res.json() as Promise<RunRow[]>) : []))
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [live]);

  // Derived, never stored. Changing a control changes the price in the same frame, and
  // the figure beside the button is always the figure the server will charge against.
  const pairEstimate = useMemo(
    () => estimateMicroUsd(size, seconds) * 2,
    [size, seconds],
  );

  const selectedAvatar = avatars.find((a) => a.id === avatarId) ?? null;

  const poll = useCallback(async (comparisonId: string) => {
    try {
      const next = await getComparison(comparisonId);
      setComparison(next);
      return next;
    } catch {
      // A failed poll is not a failed render. The row on the server is the truth; the
      // next tick re-reads it.
      return null;
    }
  }, []);

  useEffect(() => {
    if (!comparison || bothSidesTerminal(comparison)) return;
    const id = window.setInterval(() => {
      void poll(comparison.comparisonId);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [comparison, poll]);

  async function submit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const row = await startComparison({ avatarId, runId, seconds, size });
      setComparison(row);
    } catch (err) {
      // The server's own words. It refuses for reasons a person needs to read: a run that
      // repaired nothing, a run that is not this avatar's, a missing key.
      setError(err instanceof Error ? err.message : String(err));
      setComparison(null);
    } finally {
      setSubmitting(false);
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

      <fieldset className="compare-controls">
        <legend className="sr-only">Comparison settings</legend>

        <div className="compare-field" role="radiogroup" aria-label="Avatar">
          <label htmlFor="compare-avatar">Avatar</label>
          <div id="compare-avatar" className="compare-avatars">
            {avatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                role="radio"
                aria-checked={avatar.id === avatarId}
                aria-label={avatar.id}
                className="compare-avatar"
                data-selected={avatar.id === avatarId || undefined}
                onClick={() => setAvatarId(avatar.id)}
              >
                {avatar.id}
              </button>
            ))}
            {avatars.length === 0 ? (
              <span className="compare-estimate">No stored avatars yet.</span>
            ) : null}
          </div>
        </div>

        <div className="compare-field">
          <label htmlFor="compare-run">Run</label>
          <select
            id="compare-run"
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="">Choose a run</option>
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.runId} · {run.status} · {run.passes} passes
              </option>
            ))}
          </select>
        </div>

        <div className="compare-field">
          <label htmlFor="compare-seconds">Seconds</label>
          <input
            id="compare-seconds"
            type="number"
            min={MIN_VIDEO_SECONDS}
            max={MAX_VIDEO_SECONDS}
            step={1}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
          />
        </div>

        <div className="compare-field">
          <label htmlFor="compare-size">Size</label>
          <select
            id="compare-size"
            value={size}
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
            Two clips, <strong>{formatMicroUsd(pairEstimate)}</strong>. Pressing this spends
            it.
          </span>
          <button
            type="button"
            className="compare-submit"
            disabled={!avatarId || !runId || submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Submitting…" : "Render both"}
          </button>
        </div>
      </fieldset>

      {selectedAvatar ? (
        <section className="compare-reference">
          <img
            className="compare-reference__sheet"
            src={avatarImageUrl(selectedAvatar.id)}
            alt={`Character sheet for ${selectedAvatar.id}`}
          />
          <div className="compare-reference__body">
            <h2>The reference</h2>
            <p>
              This sheet is what the two clips are judged against, and it is never sent to
              the video model. Seedance refuses a human likeness in any input image, which
              is the whole reason the person has to survive as prose.
            </p>
            {selectedAvatar.description ? (
              <p className="specimen">{selectedAvatar.description}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="compare-message" data-tone="alarm" role="alert">
          {error}
        </p>
      ) : null}

      {comparison ? <ClipPair comparison={comparison} /> : null}
    </div>
  );
}
