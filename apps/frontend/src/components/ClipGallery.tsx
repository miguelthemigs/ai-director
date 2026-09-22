import { useMemo, useState } from "react";
import type { ClipSummary } from "@ai-director/contract";
import { formatMicroUsd } from "../data/compareApi.js";

/**
 * Every clip ever rendered, all at once.
 *
 * ── Why this is not the history table ───────────────────────────────────────────────
 * The history answers "what comparisons have I run" and opens one at a time, which is
 * right for reading a single comparison. This answers a different question: "what have I
 * actually produced". Five renders of one byte-identical prompt only look like five
 * different faces when they are beside each other, and on the pair pages they are five
 * pages apart.
 *
 * That difference is the whole identity question this project exists to ask, so it gets a
 * surface where it is visible rather than one where it is reconstructable.
 *
 * ── Every tile holds a real clip ────────────────────────────────────────────────────
 * The route only returns sides with bytes on disk. A render that succeeded and whose
 * download failed is real and is reported on its own pair's page; an empty tile here would
 * be a gallery lying about what it holds.
 *
 * ── No autoplay ─────────────────────────────────────────────────────────────────────
 * A wall of looping video is ambient motion, which PRODUCT.md rules out, and ten clips
 * playing at once is unreadable besides. `preload="metadata"` gets a poster frame without
 * fetching the whole file.
 */

type Filter = "all" | "before" | "after";

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "before", label: "Before only" },
  { id: "after", label: "After only" },
];

export function ClipGallery({
  clips,
  onOpenPair,
}: {
  clips: ClipSummary[];
  onOpenPair: (comparisonId: string) => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(
    () => (filter === "all" ? clips : clips.filter((clip) => clip.side === filter)),
    [clips, filter],
  );

  const billed = useMemo(
    () => clips.reduce((sum, clip) => sum + (clip.actualMicroUsd ?? 0), 0),
    [clips],
  );
  const anyUnbilled = clips.some((clip) => clip.actualMicroUsd === null);

  if (clips.length === 0) {
    return <p className="compare-empty">No clips rendered yet.</p>;
  }

  return (
    <div className="gallery">
      <div className="gallery__bar">
        <div className="gallery__filters" role="group" aria-label="Which clips to show">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="gallery__filter"
              aria-pressed={filter === option.id}
              data-active={filter === option.id || undefined}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="gallery__total tnum">
          {shown.length} of {clips.length} clips
          {/* A total that silently skipped an unreported clip would read as the whole
              bill. It says so instead. */}
          {anyUnbilled
            ? ` · ${formatMicroUsd(billed)} billed across the clips that reported one`
            : ` · ${formatMicroUsd(billed)} billed`}
        </p>
      </div>

      <ul className="gallery__grid">
        {shown.map((clip) => (
          <li key={`${clip.comparisonId}-${clip.side}`} className="gallery__item">
            <video
              className="gallery__video"
              src={clip.clipUrl}
              controls
              playsInline
              preload="metadata"
              data-testid="gallery-clip"
            />
            <div className="gallery__meta">
              <span className="gallery__side" data-side={clip.side}>
                {clip.side === "before" ? "before the passes" : "after the passes"}
              </span>
              <span className="gallery__version" data-known={Boolean(clip.repairerPromptVersion) || undefined}>
                {clip.repairerPromptVersion
                  ? `repairer ${clip.repairerPromptVersion}`
                  : "repairer not recorded"}
              </span>
            </div>
            <p className="gallery__shape tnum">
              {clip.size} · {clip.seconds}s · {formatMicroUsd(clip.actualMicroUsd)}
            </p>
            {/* The text this clip was rendered from, clamped. Two tiles that look like two
                people are only evidence if you can see whether they were told the same
                thing. */}
            <p className="gallery__description" title={clip.description}>
              {clip.description}
            </p>
            <button
              type="button"
              className="gallery__open"
              onClick={() => onOpenPair(clip.comparisonId)}
            >
              Open pair {clip.comparisonId.slice(0, 8)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
