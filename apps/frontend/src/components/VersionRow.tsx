import type { VersionRow as VersionRowData } from "@ai-director/contract";
import { VERSION_KIND_TITLES } from "../domain/labels.js";
import { CheckProfileSparkline } from "./CheckProfileSparkline.js";
import { DeltaBadge } from "./DeltaBadge.js";
import { RevisionChip } from "./RevisionChip.js";

/**
 * A sealed date, not a machine timestamp.
 *
 * The stored value is a full ISO instant (`2026-09-10T00:00:00.000Z`). Every one of them is
 * midnight UTC, because sealing a version is a day rather than a moment, so the time half
 * carried no information and 24 characters of it were being printed into a 108px column —
 * where `white-space: nowrap` painted the overflow straight over the Mean cell beside it.
 *
 * `en-GB` explicitly rather than the machine's locale: this column is read next to a
 * version id and a note in a document, and a date that reorders itself depending on who
 * opened the app is worse than one that is always the same. Falls back to the raw string if
 * the value will not parse, because an unparseable date is a defect in the record and
 * hiding it behind "Invalid Date" would lose the evidence.
 */
function sealedDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

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
      <span className="vtable__cell tnum" role="gridcell" title={version.sealedAt}>
        {sealedDate(version.sealedAt)}
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
