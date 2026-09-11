import { motion } from "motion/react";
import { SPRING, T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

export type PassStepState = "empty" | "running" | "done" | "terminated";

export type PassStepProps = {
  pass: number;
  /** `empty`: not yet run. `running`: this pass is in flight. `done`: closed frame. `terminated`:
   *  the cross-bar terminator a failed run's final pass takes instead of a closed frame. */
  state: PassStepState;
  /** Fragments this pass changed. Undefined for a pass that has not run. */
  changedCount?: number;
  /** The pass the rest of the screen is currently showing — carries `aria-current="step"`. */
  selected: boolean;
  onSelect: () => void;
  /** Roving-tabindex target: only the selected step is ever a tab stop. */
  active: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

/**
 * One take frame in the pass rail (design doc §5, §4.1). The pill behind the selected step's label
 * is the one `layoutId` animation in the app (motion spec §7, §13.2) — a single block-level box
 * moving between three fixed positions in a row that never wraps.
 */
export function PassStep({
  pass,
  state,
  changedCount,
  selected,
  onSelect,
  active,
  ref,
}: PassStepProps): React.JSX.Element {
  const { t } = useMotionPrefs();

  return (
    <button
      ref={ref}
      type="button"
      data-testid={`pass-step-${pass}`}
      className="pass-step"
      data-state={state}
      data-selected={selected || undefined}
      aria-current={selected ? "step" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
    >
      {selected ? (
        <motion.span
          layoutId="pass-stepper-pill"
          className="pass-step__pill"
          aria-hidden="true"
          style={{ borderRadius: 6 }}
          transition={t(SPRING.pill, T.none)}
        />
      ) : null}
      <span className="pass-step__frame" data-state={state} aria-hidden="true">
        {state === "terminated" ? <span className="pass-step__terminator" /> : null}
      </span>
      <span className="pass-step__label">Pass {pass}</span>
      {state === "empty" ? <span className="pass-step__status">not yet run</span> : null}
      {state === "running" ? <span className="pass-step__status">running</span> : null}
      {typeof changedCount === "number" ? (
        <span className="pass-step__count tnum">{changedCount} changed</span>
      ) : null}
    </button>
  );
}
