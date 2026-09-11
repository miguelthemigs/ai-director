import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Band, Percent } from "@ai-director/contract";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";
import { BandMark } from "./BandMark.js";

export type BandMeterProps = {
  /** `null` before this check has a result at all — the pre-run and awaiting-group states. */
  band: Band | null;
  /** Always the contract's own `percent`; never recomputed here. `null` alongside `band === null`. */
  percent: Percent | null;
  width?: number;
  showThreshold?: boolean;
  /** Supplied by `CheckRow`'s reveal batching. Always 0 for a row that has already been scored. */
  delay?: number;
};

const TICKS = [20, 40, 60, 80, 100] as const;

function BandMeterImpl({
  band,
  percent,
  width = 72,
  showThreshold = true,
  delay = 0,
}: BandMeterProps): React.JSX.Element {
  const { t } = useMotionPrefs();
  const fraction = (percent ?? 0) / 100;

  return (
    <span
      className="band-meter"
      data-band={band ?? undefined}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? 0}
      aria-valuetext={band === null ? "not scored" : `band ${band} of 5, ${percent} percent`}
      style={{ width }}
    >
      <span className="band-meter__track" aria-hidden="true">
        {TICKS.map((tick) => (
          <span
            key={tick}
            className="band-meter__tick"
            data-tick={tick}
            data-threshold={showThreshold && tick === 80 ? true : undefined}
          />
        ))}
        <motion.span
          className="band-meter__fill"
          data-band={band ?? undefined}
          style={{ transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: fraction }}
          transition={t({ ...T.meter, delay })}
        />
      </span>
      {/*
       * The check-reveal contract (motion spec §3): keyed on the band value itself, so an
       * unchanged score has an unchanged key and cannot animate — no `if (bandChanged)` branch
       * anywhere. The fill above is a separate, permanently-mounted element that transitions its
       * own `scaleX` target continuously; only this numeral swaps.
       */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={band ?? "unscored"}
          className="band-meter__percent tnum"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(T.select, T.fade)}
        >
          {percent === null ? "—" : `${percent}%`}
        </motion.span>
      </AnimatePresence>
      {band === null ? null : (
        <BandMark band={band} orientation="h" size={16} title={`band ${band} stroke pattern`} />
      )}
    </span>
  );
}

export const BandMeter = memo(BandMeterImpl);
