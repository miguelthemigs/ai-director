import type { CheckGroup } from "@ai-director/contract";
import { GROUP_LETTER } from "../domain/labels.js";
import { SectionLabel } from "./SectionLabel.js";

export type CheckGroupHeaderProps = {
  group: CheckGroup;
  label: string;
  /** Checks in this group. */
  total: number;
  /** Checks in this group that have a result attached — scored or `not_evaluated` — regardless of
   *  whether they passed. This is an arrival count, not a score. */
  arrivedCount: number;
};

/**
 * Header only. Renders a label and a count of checks. It must never render an aggregate band, an
 * average, or a progress bar (design doc §5, spec §9) — a mean hiding one failing check among
 * eight passing ones is the exact failure this product exists to prevent.
 */
export function CheckGroupHeader({
  group,
  label,
  total,
  arrivedCount,
}: CheckGroupHeaderProps): React.JSX.Element {
  return (
    <SectionLabel as="h3">
      <span className="check-group-header__letter">{GROUP_LETTER[group]}</span>
      <span className="check-group-header__label">{label}</span>
      <span className="check-group-header__count tnum">
        {arrivedCount === 0 ? "--" : arrivedCount} / {total}
      </span>
    </SectionLabel>
  );
}
