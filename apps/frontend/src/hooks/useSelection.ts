import { useCallback, useState } from "react";
import type { CheckId } from "@ai-director/contract";

export type UseSelectionResult = {
  selected: CheckId | null;
  select: (checkId: CheckId | null) => void;
  hoveredSpanId: string | null;
  hoverSpan: (spanId: string | null) => void;
};

/**
 * The one piece of state the check-to-fragment link runs on (motion spec §5: "one piece of state,
 * both directions, no separate selectedSpanId"). Deliberately tiny — both `CheckPanel` and
 * `SpecimenView` need it and neither owns it, so it lives here instead of inside either component.
 */
export function useSelection(): UseSelectionResult {
  const [selected, setSelected] = useState<CheckId | null>(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);

  const select = useCallback((checkId: CheckId | null) => setSelected(checkId), []);
  const hoverSpan = useCallback((spanId: string | null) => setHoveredSpanId(spanId), []);

  return { selected, select, hoveredSpanId, hoverSpan };
}
