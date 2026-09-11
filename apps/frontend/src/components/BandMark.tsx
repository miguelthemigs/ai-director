import type { Band } from "@ai-director/contract";

export type BandMarkProps = {
  band: Band;
  orientation: "h" | "v";
  size?: number;
  title: string;
};

/**
 * The stroke pattern each band carries independent of colour — the signal the design doc says
 * "survives grayscale(1)". Shared with `CoverageRule`, which draws the same patterns at whatever
 * length its rule needs rather than this component's fixed icon size.
 */
export type BandStroke =
  | { kind: "sine"; period: number; amplitude: number; width: number }
  | { kind: "dash"; dasharray: string; width: number }
  | { kind: "solid"; width: number }
  | { kind: "double"; width: number; gap: number };

export function bandStroke(band: Band): BandStroke {
  switch (band) {
    case 1:
      return { kind: "sine", period: 4, amplitude: 1.5, width: 1 };
    case 2:
      return { kind: "dash", dasharray: "1 3", width: 1.5 };
    case 3:
      return { kind: "dash", dasharray: "4 3", width: 1.5 };
    case 4:
      return { kind: "solid", width: 1.5 };
    case 5:
      return { kind: "double", width: 1, gap: 2 };
  }
}

/** A sine path's `d` attribute, oscillating across `[0, length]` on the cross axis, centred at
 *  `length / 2` — used for both a small horizontal swatch and a tall vertical coverage rule. */
function sinePath(length: number, period: number, amplitude: number, vertical: boolean): string {
  const steps = Math.max(8, Math.round(length / 2));
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const along = (length * i) / steps;
    const cross = Math.sin((along / period) * Math.PI * 2) * amplitude;
    const [x, y] = vertical ? [amplitude + cross, along] : [along, amplitude + cross];
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

/** Renders one `bandStroke` pattern as SVG geometry along a run of the given length. */
export function renderBandStroke(
  stroke: BandStroke,
  length: number,
  vertical: boolean,
): React.JSX.Element {
  const crossSize = stroke.kind === "double" ? stroke.gap + stroke.width * 2 : stroke.width * 2 + 1;

  if (stroke.kind === "sine") {
    return (
      <path
        d={sinePath(length, stroke.period, stroke.amplitude, vertical)}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke.width}
        strokeLinecap="butt"
      />
    );
  }

  const line = (offset: number) =>
    vertical
      ? { x1: offset, y1: 0, x2: offset, y2: length }
      : { x1: 0, y1: offset, x2: length, y2: offset };

  if (stroke.kind === "double") {
    const a = stroke.width / 2;
    const b = a + stroke.gap + stroke.width;
    return (
      <g fill="none" stroke="currentColor" strokeLinecap="butt">
        <line {...line(a)} strokeWidth={stroke.width} />
        <line {...line(b)} strokeWidth={stroke.width} />
      </g>
    );
  }

  return (
    <line
      {...line(crossSize / 2)}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke.width}
      strokeDasharray={stroke.kind === "dash" ? stroke.dasharray : undefined}
      strokeLinecap="butt"
    />
  );
}

/**
 * The authored SVG stroke-pattern swatch: band 1 a soft sine wave, band 2 a fine dash, band 3 a
 * coarser dash, band 4 a solid stroke, band 5 a doubled stroke. `currentColor`, so it always takes
 * the band's ink colour from its CSS context.
 */
export function BandMark({ band, orientation, size = 16, title }: BandMarkProps): React.JSX.Element {
  const stroke = bandStroke(band);
  const vertical = orientation === "v";
  const width = vertical ? 8 : size;
  const height = vertical ? size : 8;
  const length = vertical ? height : width;

  return (
    <svg
      className="band-mark"
      data-band={band}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
    >
      {renderBandStroke(stroke, length, vertical)}
    </svg>
  );
}
