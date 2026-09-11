import { CHECK_IDS, isScoredCheck, type CheckId, type CheckResultView } from "@ai-director/contract";
import { CHECK_TITLES } from "../domain/labels.js";
import { BandMark } from "./BandMark.js";

export type CheckStripProps = {
  results: CheckResultView[];
  selectedCheckId: CheckId | null;
  onSelectCheck: (checkId: CheckId) => void;
};

/**
 * Phone-only: nine band marks with their percentages in one 36px row — the whole result at a
 * glance, each cell tappable (design doc §4.1, §5 "Run screen"). Not wired into `RunScreen` in
 * this task; the phone breakpoint layout it belongs to is a later pass over the desktop-first
 * screen this task builds.
 */
export function CheckStrip({ results, selectedCheckId, onSelectCheck }: CheckStripProps): React.JSX.Element {
  const byId = new Map(results.map((r) => [r.checkId, r]));

  return (
    <div className="check-strip" role="group" aria-label="All nine checks">
      {CHECK_IDS.map((id) => {
        const result = byId.get(id) ?? null;
        const scored = result && isScoredCheck(result) ? result : null;
        const label = scored
          ? `${CHECK_TITLES[id]}, band ${scored.band}, ${scored.percent} percent`
          : `${CHECK_TITLES[id]}, not evaluated`;

        return (
          <button
            key={id}
            type="button"
            className="check-strip__cell"
            data-band={scored?.band ?? undefined}
            data-selected={selectedCheckId === id || undefined}
            onClick={() => onSelectCheck(id)}
            aria-label={label}
          >
            {scored ? (
              <BandMark band={scored.band} orientation="h" size={14} title={`band ${scored.band}`} />
            ) : null}
            <span className="check-strip__percent tnum" aria-hidden="true">
              {scored ? scored.percent : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
