export type CueBadgeProps = {
  /** The SSE event id, e.g. `2-eval-A` — deep-linkable as `#cue=2-eval-A` (design doc §5). */
  cueId: string;
};

/** The visible form of the latest SSE event id, at `--fs-micro` in `--ink-3` (design doc §5). */
export function CueBadge({ cueId }: CueBadgeProps): React.JSX.Element {
  return (
    <span className="cue-badge tnum" aria-label={`cue ${cueId}`}>
      {cueId}
    </span>
  );
}
