export type SpecimenLineProps = {
  n: number;
  children: React.ReactNode;
  /** `SpecimenView` measures this element's box (not any child) to place the coverage gutter's
   *  rules — a wrapped, taller row must still report its true height. */
  rowRef?: (el: HTMLDivElement | null) => void;
};

/**
 * One numbered source line at `--pitch` rhythm. A visually wrapped continuation row carries no
 * number, as in a script — that falls out of plain CSS (the number sits in its own grid cell,
 * top-aligned, while the text cell grows to however many visual rows the wrap needs), so this
 * component never has to know whether its text wrapped.
 */
export function SpecimenLine({ n, children, rowRef }: SpecimenLineProps): React.JSX.Element {
  return (
    <div className="spec-line" data-line={n} ref={rowRef}>
      <span className="spec-line__num tnum" aria-hidden="true">
        {n}
      </span>
      <span className="spec-line__lane-space" aria-hidden="true" />
      <span className="spec-line__text">{children}</span>
    </div>
  );
}
