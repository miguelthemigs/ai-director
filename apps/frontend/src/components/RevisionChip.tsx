export type RevisionChipProps = {
  /** 1-9, this row's position in the revision-paper ramp. Clamped, not wrapped — a 10th version
   *  reuses `--rev-9-cherry` rather than silently rolling back to white. */
  index: number;
  versionId: string;
};

/**
 * The film industry's own revision-paper order (design doc §2, §4.3): white, blue, pink, yellow,
 * green, goldenrod, buff, salmon, cherry. Colour is identity here, never state — it never repeats
 * the band ramp's job of signalling pass/fail, and the numeral it carries is always immediately
 * followed by the version id in plain text, never relied on alone.
 */
export function RevisionChip({ index, versionId }: RevisionChipProps): React.JSX.Element {
  const rev = Math.min(Math.max(Math.round(index), 1), 9);

  return (
    <span className="revision-chip">
      <span className="revision-chip__swatch tnum" data-rev={rev} aria-hidden="true">
        {rev}
      </span>
      <span className="revision-chip__id" title={versionId}>
        {versionId}
      </span>
    </span>
  );
}
