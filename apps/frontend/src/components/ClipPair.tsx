import {
  isRenderSuccess,
  isRenderTerminal,
  type ComparisonView,
  type RenderView,
} from "@ai-director/contract";
import { CostReadout } from "./CostReadout.js";

/**
 * The two clips, side by side.
 *
 * ── What the component is for ───────────────────────────────────────────────────────
 * One question: does a repaired description render a person who still looks like the
 * sheet? So the two panels are deliberately symmetrical and the only asymmetry on screen
 * is the text under each clip. Everything the two renders share is pulled OUT of the
 * panels and stated once, in `held-constant`, because a reader has to be able to see at a
 * glance that the size, the seconds, the model and the shot wrapper were identical. A
 * comparison whose controls are printed twice invites the reader to check they match; one
 * that prints them once asserts it.
 *
 * ── No success state for a render that did not succeed ──────────────────────────────
 * `isRenderSuccess` decides, and nothing else may. `cancelled` is terminal and is NOT a
 * win, the same rule the Run screen applies to `improved_still_failing`. `data-success`
 * is absent rather than false for a failure, so a CSS selector cannot accidentally style
 * one as the other.
 *
 * ── Progress is a poll count, not a spinner ─────────────────────────────────────────
 * PRODUCT.md: motion is tied to real state changes only, no ambient or looping animation.
 * A spinner spins whether or not anything is happening, which makes it a decoration that
 * looks like information. A status-read count only ever moves when a poll actually
 * returned, so it is the honest version of the same reassurance.
 *
 * ── A billed render with no clip is two facts, not one ──────────────────────────────
 * `CLIP_DOWNLOAD_FAILED` means the render happened, was billed, and the bytes could not
 * be fetched. Both halves are shown. Collapsing it to "failed" would misreport the money.
 */

function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}

const SIDE_LABEL: Record<RenderView["side"], string> = {
  before: "Before the passes",
  after: "After the passes",
};

const SIDE_NOTE: Record<RenderView["side"], string> = {
  before: "The description as the describe step wrote it",
  after: "The same description after the Repairer finished with it",
};

function RenderPanel({ render }: { render: RenderView }): React.JSX.Element {
  const succeeded = isRenderSuccess(render.status);
  const playable = succeeded && render.clipUrl !== null;

  return (
    <section
      className="clip-panel"
      data-testid={`render-${render.side}`}
      data-side={render.side}
      // Absent, never `false`, for anything that is not a success.
      data-success={succeeded || undefined}
      aria-label={SIDE_LABEL[render.side]}
    >
      <header className="clip-panel__head">
        <h3 className="clip-panel__title">{SIDE_LABEL[render.side]}</h3>
        <p className="clip-panel__note">{SIDE_NOTE[render.side]}</p>
      </header>

      <div className="clip-panel__stage">
        {playable ? (
          <video
            data-testid="clip-player"
            className="clip-panel__video"
            src={render.clipUrl ?? undefined}
            controls
            playsInline
            // No autoplay and no loop: a looping clip is ambient motion, and this screen
            // is read as evidence rather than watched as a reel.
            preload="metadata"
          />
        ) : (
          <p className="clip-panel__nostage">
            {succeeded
              ? "Rendered, but the clip is not on disk."
              : isRenderTerminal(render.status)
                ? "No clip: this render did not finish."
                : "No clip yet."}
          </p>
        )}
      </div>

      <dl className="clip-panel__state">
        <div className="clip-panel__pair">
          <dt>Status</dt>
          <dd className="clip-panel__status" data-status={render.status}>
            {render.status}
          </dd>
        </div>
        <div className="clip-panel__pair">
          <dt>Status reads</dt>
          <dd className="tnum">{render.polls} status reads</dd>
        </div>
      </dl>

      <CostReadout
        estimatedMicroUsd={render.estimatedMicroUsd}
        actualMicroUsd={render.actualMicroUsd}
      />

      {render.failure ? (
        <p
          className="clip-panel__failure"
          // A billed render whose clip failed to download is not an alarm: the render
          // worked. Only a render that did not succeed gets the reserved alarm treatment.
          data-tone={succeeded ? "note" : "alarm"}
        >
          {render.failureCode ? <span className="clip-panel__code">{render.failureCode}</span> : null}
          {render.failure}
        </p>
      ) : null}

      <figure className="clip-panel__description">
        <figcaption>
          Sent as text
          <span className="clip-panel__hash" title={render.descriptionSha256}>
            {shortHash(render.descriptionSha256)}
          </span>
        </figcaption>
        <blockquote className="quoted-text">{render.description}</blockquote>
      </figure>

      <p className="clip-panel__provenance">
        <span>rubric {render.rubricVersion}</span>
        <span>
          {render.repairerPromptVersion
            ? `repairer ${render.repairerPromptVersion}`
            : "repairer version not recorded"}
        </span>
      </p>
    </section>
  );
}

export function ClipPair({ comparison }: { comparison: ComparisonView }): React.JSX.Element {
  return (
    <div className="clip-pair">
      {/* Stated once rather than twice. See the header: printing the shared controls in
          both panels would invite a reader to verify they match instead of asserting it. */}
      <p className="held-constant" data-testid="held-constant">
        <span className="held-constant__label">Held identical</span>
        <span>{comparison.size}</span>
        <span className="tnum">{comparison.seconds} s</span>
        <span>{comparison.model}</span>
        <span>shot prompt {comparison.shotPromptVersion}</span>
        <span>text only, no image sent</span>
      </p>

      <div className="clip-pair__panels">
        <RenderPanel render={comparison.before} />
        <RenderPanel render={comparison.after} />
      </div>
    </div>
  );
}
