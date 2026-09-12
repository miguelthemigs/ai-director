export type DeltaBadgeProps = {
  /** `null` when there is nothing to compare against — the first version of the list, or a check
   *  where either side is unmeasured. Never coerced to zero. */
  delta: number | null;
  unit?: "%" | "pt";
  /**
   * Visible replacement for the compact dash shown when `delta` is null. A bare "—" reads fine as
   * "no earlier version to compare" (`VersionRow`'s own Δ column, the first row in the list), but
   * that phrase is wrong for `CheckDeltaTable`, where a null delta usually means one side of the
   * pair simply hasn't been scored yet — pass e.g. "not comparable" there instead.
   */
  unmeasuredLabel?: string;
};

/** A 16×16 authored triangle, `currentColor` — never the literal `▲`/`▼` characters (design doc §7:
 *  "no emoji, no Unicode glyph substitutes"). */
function Arrow({ direction }: { direction: "up" | "down" }): React.JSX.Element {
  const d = direction === "up" ? "M8 3 L13 12 L3 12 Z" : "M8 13 L13 4 L3 4 Z";
  return (
    <svg className="delta-badge__arrow" width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/**
 * `+8.9 ▲` / `−1.2 ▼` / `0.0 =`, drawn rather than typed (design doc §5 "Versions screen"). Three
 * signals in order — arrow, then the literal signed number, then colour — so the value survives
 * `grayscale(1)` (design doc §7).
 */
export function DeltaBadge({ delta, unit = "pt", unmeasuredLabel }: DeltaBadgeProps): React.JSX.Element {
  if (delta === null) {
    if (unmeasuredLabel) {
      return (
        <span className="delta-badge delta-badge--unmeasured" data-sign="none">
          {unmeasuredLabel}
        </span>
      );
    }
    return (
      <span className="delta-badge tnum" data-sign="none" aria-label="no previous version">
        &mdash;
      </span>
    );
  }

  const rounded = Math.round(delta * 10) / 10;
  const magnitude = Math.abs(rounded).toFixed(1);
  const unitSuffix = unit === "%" ? "%" : "";

  if (rounded > 0) {
    return (
      <span className="delta-badge tnum" data-sign="up" aria-label={`up ${magnitude}${unit}`}>
        <Arrow direction="up" />
        <span className="delta-badge__value">
          +{magnitude}
          {unitSuffix}
        </span>
      </span>
    );
  }
  if (rounded < 0) {
    return (
      <span className="delta-badge tnum" data-sign="down" aria-label={`down ${magnitude}${unit}`}>
        <Arrow direction="down" />
        <span className="delta-badge__value">
          &minus;{magnitude}
          {unitSuffix}
        </span>
      </span>
    );
  }
  return (
    <span className="delta-badge tnum" data-sign="flat" aria-label={`unchanged, ${magnitude}${unit}`}>
      <span className="delta-badge__value">
        0.0
        {unitSuffix}
      </span>
      <span className="delta-badge__eq" aria-hidden="true">
        =
      </span>
    </span>
  );
}
