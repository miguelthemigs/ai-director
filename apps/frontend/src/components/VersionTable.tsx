import type { VersionRow as VersionRowData } from "@ai-director/contract";
import { VersionRow } from "./VersionRow.js";

export type VersionTableProps = {
  /** Oldest sealed first — the order the revision-paper ramp and the history itself both read in. */
  versions: VersionRowData[];
  /** Capped at two by `VersionsScreen`; an array rather than a fixed tuple because "capped at two"
   *  is an invariant this component's caller maintains, not one the type needs to encode. */
  selected: readonly string[];
  onToggleSelect: (id: string) => void;
};

const COLUMN_LABELS = ["Select", "Ver", "Kind", "Sealed", "Mean", "Δ", "Check profile", "Note"];

/**
 * The rows (design doc §5 "Versions screen"). A `role="grid"` of CSS-grid rows rather than a
 * native `<table>` — §4.3's column pitch is shared with the phone layout's stacked blocks, which a
 * native table cannot become without a second markup tree.
 */
export function VersionTable({ versions, selected, onToggleSelect }: VersionTableProps): React.JSX.Element {
  return (
    <div className="vtable" role="grid" aria-label="Rubric and prompt version history">
      <div className="vtable__row vtable__row--head" role="row">
        {COLUMN_LABELS.map((label, i) => (
          <span
            key={label}
            className={i === 0 ? "vtable__head sr-only" : "vtable__head"}
            role="columnheader"
          >
            {label}
          </span>
        ))}
      </div>
      {versions.map((version, index) => (
        <VersionRow
          key={version.id}
          version={version}
          revisionIndex={index + 1}
          selected={selected.includes(version.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
