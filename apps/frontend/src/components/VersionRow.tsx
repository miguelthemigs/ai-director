import type { VersionRow as VersionRowData } from "@ai-director/contract";
import { VERSION_KIND_TITLES } from "../domain/labels.js";
import { CheckProfileSparkline } from "./CheckProfileSparkline.js";
import { DeltaBadge } from "./DeltaBadge.js";
import { RevisionChip } from "./RevisionChip.js";

export type VersionRowProps = {
  version: VersionRowData;
  /** 1-9, this row's position in the revision-paper ramp — the sealed-chronological order
   *  `VersionTable` reads its rows in, not stored on the record itself. */
  revisionIndex: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
};

/**
 * One row of the version history: checkbox, revision chip, kind, sealed date, mean, delta badge,
 * check profile, note (design doc §5 "Versions screen"). Spec §7 makes the note required; a row
 * whose `why` arrives empty is a defect in the record, not a blank cell, so it renders as such
 * (design doc §6.4 "Missing note") rather than silently doing nothing.
 */
export function VersionRow({ version, revisionIndex, selected, onToggleSelect }: VersionRowProps): React.JSX.Element {
  const missingNote = version.why.trim().length === 0;

  return (
    <div className="vtable__row" role="row" aria-selected={selected} data-missing-note={missingNote || undefined}>
      <span className="vtable__cell" role="gridcell">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(version.id)}
          aria-label={`Select ${version.id} to compare`}
        />
      </span>
      <span className="vtable__cell" role="gridcell">
        <RevisionChip index={revisionIndex} versionId={version.id} />
      </span>
      <span className="vtable__cell vtable__cell--kind" role="gridcell">
        {VERSION_KIND_TITLES[version.kind]}
      </span>
      <span className="vtable__cell tnum" role="gridcell">
        {version.sealedAt}
      </span>
      <span className="vtable__cell tnum" role="gridcell">
        {version.meanPercent === null ? "not scored yet" : `${version.meanPercent.toFixed(1)}%`}
      </span>
      <span className="vtable__cell" role="gridcell">
        <DeltaBadge delta={version.deltaPercent} />
      </span>
      <span className="vtable__cell" role="gridcell">
        <CheckProfileSparkline profile={version.profile} />
      </span>
      <span
        className="vtable__cell vtable__cell--note"
        role="gridcell"
        data-missing={missingNote || undefined}
      >
        {missingNote ? "note required, not recorded" : version.why}
      </span>
    </div>
  );
}
