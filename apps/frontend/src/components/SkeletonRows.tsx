/**
 * Pitch-aligned placeholder rules. Used instead of spinners inside content (design doc §5
 * "Shared"). `height` is caller-supplied layout, not a design token, so it is the one legitimate
 * inline style in this component.
 */
export function SkeletonRows({ rows, height }: { rows: number; height: number }): React.JSX.Element {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-rows__row" style={{ height }} />
      ))}
    </div>
  );
}
