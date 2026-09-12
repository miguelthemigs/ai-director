/**
 * Alarm-outline panel. Names the failed cue and the recovery (design doc §5 "Shared").
 */
export function ErrorPanel({
  title,
  detail,
  cueId,
  onRetry,
  canResume,
}: {
  title: string;
  detail: string;
  cueId?: string;
  onRetry?: () => void;
  canResume: boolean;
}): React.JSX.Element {
  return (
    <div className="error-panel" role="alert">
      <p className="error-panel__title">{title}</p>
      <p className="error-panel__detail">{detail}</p>
      {cueId ? <p className="error-panel__cue tnum">{cueId}</p> : null}
      <p className="error-panel__resume">
        {canResume ? "This run can resume from where it stopped." : "This run cannot resume."}
      </p>
      {onRetry ? (
        <button type="button" className="error-panel__retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
