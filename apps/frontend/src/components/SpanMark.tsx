import type { Band, CheckId } from "@ai-director/contract";

/** One check's claim on a segment of text. A segment can be covered by more than one check at
 *  once (two checks legitimately quoting overlapping or nested text — see the task report) —
 *  `covering` on `SpanMarkProps` carries every one of them, never just the first. */
export type SpanMarkCoveringSpan = {
  spanId: string;
  checkId: CheckId;
  checkTitle: string;
  band: Band;
  /** 1-based position among this check's own spans (not this DOM segment's), for "fragment N of M". */
  index: number;
  total: number;
  /** This span's spanId can appear in more than one rendered segment — split by another check's
   *  overlap, or by a line break. 1-based occurrence index and the total count, for disambiguating
   *  otherwise-identical accessible names. `occurrenceTotal === 1` omits the qualifier entirely. */
  occurrenceIndex: number;
  occurrenceTotal: number;
  selected: boolean;
  /** Roving-tabindex target: `SpecimenView` is one tab stop; only one span button is ever
   *  reachable by Tab, and arrow keys move which one that is. */
  focused: boolean;
};

export type SpanMarkProps = {
  /** The segment's literal text — rendered exactly once, by the first (primary) covering span. */
  text: string;
  /** Lane index, used only to cycle the three `--span-N` ground tints — not the band colour. */
  lane: number;
  /** Every check covering this segment, sorted with the primary (text-bearing) entry first. */
  covering: SpanMarkCoveringSpan[];
  onSelect: (checkId: CheckId) => void;
};

function ariaLabelFor(c: SpanMarkCoveringSpan): string {
  const part = c.occurrenceTotal > 1 ? ` (part ${c.occurrenceIndex} of ${c.occurrenceTotal})` : "";
  return `fragment ${c.index} of ${c.total}, ${c.checkTitle}, band ${c.band}${part}`;
}

/**
 * The inline highlighted fragment. `--span-N` ground (cycled by lane, not by band — the band
 * colour lives only in the 2px underline, via `data-band`), `--mark-soft` ground plus a `--mark`
 * underline when selected. Renders `<mark>` wrapping one text-bearing `<button>` (the primary
 * covering span) so screen readers get both the highlight semantics and an operable control
 * (design doc §7).
 *
 * When more than one check covers the same text (nested or overlapping quotes — HTML cannot nest
 * two interactive elements around the same run of text), every check after the first renders as a
 * small sibling "chip" button instead of repeating the text: still independently focusable,
 * labelled, and clickable, so every covering check is reachable by mouse and by keyboard, and none
 * is silently dropped.
 *
 * Selection here is plain CSS on `background-color` and `box-shadow` at 0.12s (motion spec §5) —
 * there is no Motion component in this file at all. A shared `layoutId` indicator was rejected in
 * the motion spec because a wrapped inline span has several client rects and the indicator smears.
 */
export function SpanMark({ text, lane, covering, onSelect }: SpanMarkProps): React.JSX.Element {
  const [primary, ...secondary] = covering;
  if (!primary) return <>{text}</>;

  const anySelected = covering.some((c) => c.selected);

  return (
    <mark
      className="span-mark"
      data-check-ids={covering.map((c) => c.checkId).join(" ")}
      data-lane={lane % 3}
      data-band={primary.band}
      data-selected={anySelected || undefined}
      data-multi={covering.length > 1 || undefined}
    >
      <button
        type="button"
        className="span-mark__hit"
        data-span-id={primary.spanId}
        data-check-id={primary.checkId}
        tabIndex={primary.focused ? 0 : -1}
        aria-label={ariaLabelFor(primary)}
        aria-current={primary.selected || undefined}
        onClick={() => onSelect(primary.checkId)}
      >
        {text}
      </button>
      {secondary.map((cov) => (
        <button
          key={cov.spanId}
          type="button"
          className="span-mark__chip"
          data-span-id={cov.spanId}
          data-check-id={cov.checkId}
          data-band={cov.band}
          tabIndex={cov.focused ? 0 : -1}
          aria-label={ariaLabelFor(cov)}
          aria-current={cov.selected || undefined}
          onClick={() => onSelect(cov.checkId)}
        />
      ))}
    </mark>
  );
}
