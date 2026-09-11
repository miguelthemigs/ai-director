import type { CueEntry } from "../domain/derive.js";

export type CueLogProps = {
  entries: CueEntry[];
  onSelectCue?: (cueId: string) => void;
};

/**
 * The append-only audit record: every event received, in arrival order, never truncated within a
 * run (design doc §5 "Architecture screen"). This is the log an assessor falls back to when a
 * node's own state has moved on and they want to see exactly what happened, in order.
 */
export function CueLog({ entries, onSelectCue }: CueLogProps): React.JSX.Element {
  return (
    <section className="cue-log" aria-label="Cue log">
      <h2 className="section-label cue-log__heading">Cue log</h2>
      <ol className="cue-log__list">
        {entries.map((entry) => (
          <li key={entry.cueId} className="cue-log__entry">
            <button
              type="button"
              className="cue-log__row"
              data-state={entry.state}
              onClick={() => onSelectCue?.(entry.cueId)}
            >
              <span className="cue-log__cue tnum">{entry.cueId}</span>
              <span className="cue-log__label">{entry.label}</span>
              <span className="cue-log__state">{entry.state}</span>
              {entry.ms !== undefined ? (
                <span className="cue-log__ms tnum">{(entry.ms / 1000).toFixed(2)}s</span>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
