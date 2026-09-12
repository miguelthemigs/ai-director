import { useCallback } from "react";
import { useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { T } from "./tokens";

export type MotionPrefs = {
  reduce: boolean;
  /** Pick a transition. Defaults to no transition at all when reduced. */
  t: (full: Transition, reduced?: Transition) => Transition;
  /** Pick a target. Use it to strip transform values while keeping opacity values. */
  v: (full: TargetAndTransition, reduced: TargetAndTransition) => TargetAndTransition;
};

export function useMotionPrefs(): MotionPrefs {
  // useReducedMotion() returns boolean | null, not boolean: it is null until the media query has
  // been read on the client. Coalescing null to false is deliberate — treating null as "reduced"
  // would freeze the first paint for everyone, per motion spec §2.1.
  const reduce = useReducedMotion() ?? false;

  const t = useCallback(
    (full: Transition, reduced: Transition = T.none) => (reduce ? reduced : full),
    [reduce],
  );
  const v = useCallback(
    (full: TargetAndTransition, reduced: TargetAndTransition) => (reduce ? reduced : full),
    [reduce],
  );

  return { reduce, t, v };
}
