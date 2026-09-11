import type { RunView } from "@ai-director/contract";

function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

/**
 * Run id, timestamp, rubric version, model. Present on all three screens, because a score with
 * no provenance is not evidence (design doc §5 "Shared").
 */
export function RunIdentityStrip({
  run,
  elapsedMs,
  compact = false,
}: {
  run: RunView | null;
  elapsedMs?: number;
  compact?: boolean;
}): React.JSX.Element {
  if (!run) {
    return (
      <div className="run-identity run-identity--empty" data-compact={compact || undefined}>
        <span className="run-identity__label">No run yet</span>
      </div>
    );
  }

  return (
    <dl className="run-identity" data-compact={compact || undefined}>
      <div className="run-identity__field">
        <dt className="run-identity__label">Run</dt>
        <dd className="run-identity__value tnum">{run.runId}</dd>
      </div>
      <div className="run-identity__field">
        <dt className="run-identity__label">Rubric</dt>
        <dd className="run-identity__value tnum">{run.rubricVersion}</dd>
      </div>
      <div className="run-identity__field">
        <dt className="run-identity__label">Model</dt>
        <dd className="run-identity__value">{run.model}</dd>
      </div>
      {elapsedMs !== undefined ? (
        <div className="run-identity__field">
          <dt className="run-identity__label">Elapsed</dt>
          <dd className="run-identity__value tnum">{formatElapsed(elapsedMs)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
