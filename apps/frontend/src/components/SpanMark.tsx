import type { Band, CheckId } from "@ai-director/contract";

export type SpanMarkProps = {
  spanId: string;
  checkId: CheckId;
  checkTitle: string;
  text: string;
  band: Band;
  /** Lane index, used only to cycle the three `--span-N` ground tints — not the band colour. */
  lane: number;
  selected: boolean;
  /** 1-based position among this check's own spans, for the "fragment N of M" label. */
  index: number;
  total: number;
  onSelect: (checkId: CheckId) => void;
  /** Roving-tabindex target: `SpecimenView` is one tab stop; only one span button is ever
   *  reachable by Tab, and arrow keys move which one that is. */
  focused: boolean;
};

/**
 * The inline highlighted fragment. `--span-N` ground (cycled by lane, not by band — the band
 * colour lives only in the 2px underline, via `data-band`), `--mark-soft` ground plus a `--mark`
 * underline when selected. Renders `<mark><button>` so screen readers get both the highlight
 * semantics and an operable control (design doc §7).
 *
 * Selection here is plain CSS on `background-color` and `box-shadow` at 0.12s (motion spec §5) —
 * there is no Motion component in this file at all. A shared `layoutId` indicator was rejected in
 * the motion spec because a wrapped inline span has several client rects and the indicator smears.
 */
export function SpanMark({
  spanId,
  checkId,
  checkTitle,
  text,
  band,
  lane,
  selected,
  index,
  total,
  onSelect,
  focused,
}: SpanMarkProps): React.JSX.Element {
  return (
    <mark
      className="span-mark"
      data-span-id={spanId}
      data-check-id={checkId}
      data-lane={lane % 3}
      data-band={band}
      data-selected={selected || undefined}
    >
      <button
        type="button"
        className="span-mark__hit"
        tabIndex={focused ? 0 : -1}
        aria-label={`fragment ${index} of ${total}, ${checkTitle}, band ${band}`}
        aria-current={selected || undefined}
        onClick={() => onSelect(checkId)}
      >
        {text}
      </button>
    </mark>
  );
}
