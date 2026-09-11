import { memo } from "react";
import { motion } from "motion/react";
import { CHECK_IDS, type CheckId, type Percent } from "@ai-director/contract";
import { CHECK_TITLES } from "../domain/labels.js";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

export type CheckProfileSparklineProps = {
  /** Null until a run has scored against this version (contract's own comment on
   *  `VersionRow.profile`). Never a flat line at zero — that would read as nine failures. */
  profile: Record<CheckId, Percent> | null;
  width?: number;
  height?: number;
  /**
   * True only when this row's profile arrived after the list had already painted (motion spec
   * §11.1). Defaults to false because, in this app, a version's row never mounts before its data
   * exists — versions resolve once from `listVersions()` and rows render already-scored, so "data
   * I already had" (which does not draw) is the only case that occurs today.
   */
  draw?: boolean;
};

/** Percent axis: 20 at the bottom, 100 at the top. The pass threshold sits at 80. */
const THRESHOLD_PERCENT = 80;

function pointsFor(profile: Record<CheckId, Percent>, width: number, height: number): string {
  return CHECK_IDS.map((id, i) => {
    const x = (i / (CHECK_IDS.length - 1)) * width;
    const y = height - (profile[id] / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

/** The nine values as real text, so the profile is never conveyed by shape alone (design doc §7). */
function summaryText(profile: Record<CheckId, Percent>): string {
  return CHECK_IDS.map((id) => `${CHECK_TITLES[id]} ${profile[id]} percent`).join(", ");
}

function CheckProfileSparklineImpl({
  profile,
  width = 104,
  height = 20,
  draw = false,
}: CheckProfileSparklineProps): React.JSX.Element {
  const { t, reduce } = useMotionPrefs();

  if (profile === null) {
    return <p className="check-profile-sparkline check-profile-sparkline--empty">not scored yet</p>;
  }

  const thresholdY = height - (THRESHOLD_PERCENT / 100) * height;
  const shouldDraw = draw && !reduce;

  return (
    <span className="check-profile-sparkline">
      <svg
        className="check-profile-sparkline__svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        <line
          className="check-profile-sparkline__threshold"
          x1={0}
          y1={thresholdY}
          x2={width}
          y2={thresholdY}
        />
        {/* `initial={false}` when not drawing places the polyline at its final shape with no
         *  animation at all — the row stays safe to re-render without replaying the draw. */}
        <motion.polyline
          className="check-profile-sparkline__line"
          points={pointsFor(profile, width, height)}
          initial={shouldDraw ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={t(T.draw)}
        />
      </svg>
      <span className="sr-only">
        Nine-check profile, rubric order, pass threshold 80 percent: {summaryText(profile)}.
      </span>
    </span>
  );
}

export const CheckProfileSparkline = memo(CheckProfileSparklineImpl);
