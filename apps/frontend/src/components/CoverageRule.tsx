import type { Band } from "@ai-director/contract";
import { bandStroke, renderBandStroke } from "./BandMark.js";

export type CoverageRuleProps = {
  lane: number;
  top: number;
  height: number;
  band: Band;
  selected: boolean;
  label: string;
  onSelect: () => void;
};

/**
 * One vertical rule in its band's stroke pattern — the same geometry `BandMark` authors as a small
 * icon, drawn here to the rule's real, measured length. A 3-letter tab appears at its head only
 * when selected.
 */
export function CoverageRule({
  lane,
  top,
  height,
  band,
  selected,
  label,
  onSelect,
}: CoverageRuleProps): React.JSX.Element {
  const stroke = bandStroke(band);

  return (
    <button
      type="button"
      className="coverage-rule"
      data-band={band}
      data-selected={selected || undefined}
      data-lane={lane}
      style={{ top, height, insetInlineStart: `calc(var(--w-lane) * ${lane})` }}
      onClick={onSelect}
      aria-label={label}
      tabIndex={-1}
    >
      {selected ? <span className="coverage-rule__tab">{label.slice(0, 3).toUpperCase()}</span> : null}
      <svg className="coverage-rule__svg" width={8} height={Math.max(height, 1)} aria-hidden="true">
        {renderBandStroke(stroke, Math.max(height, 1), true)}
      </svg>
    </button>
  );
}
