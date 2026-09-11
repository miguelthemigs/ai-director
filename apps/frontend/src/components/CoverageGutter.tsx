import type { Band, CheckId } from "@ai-director/contract";
import { CoverageRule } from "./CoverageRule.js";

export type CoverageRuleGeometry = {
  checkId: CheckId;
  lane: number;
  top: number;
  height: number;
  band: Band;
};

export type CoverageGutterProps = {
  lanes: CheckId[];
  rules: CoverageRuleGeometry[];
  selectedCheckId: CheckId | null;
  onSelectCheck: (checkId: CheckId) => void;
};

/**
 * The SVG lane layer: one absolutely positioned rule per check that has verified spans, drawn over
 * the reserved lane column. `SpecimenView` measures line geometry and supplies `rules`; this
 * component only lays them out.
 */
export function CoverageGutter({
  lanes,
  rules,
  selectedCheckId,
  onSelectCheck,
}: CoverageGutterProps): React.JSX.Element {
  return (
    <div className="coverage-gutter" aria-label={`Coverage gutter, ${lanes.length} lanes`}>
      {rules.map((rule) => (
        <CoverageRule
          key={rule.checkId}
          lane={rule.lane}
          top={rule.top}
          height={rule.height}
          band={rule.band}
          selected={selectedCheckId === rule.checkId}
          label={rule.checkId}
          onSelect={() => onSelectCheck(rule.checkId)}
        />
      ))}
    </div>
  );
}
