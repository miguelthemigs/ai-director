import type { Transition } from "motion/react";

/** A cubic-bezier control-point tuple. Motion also exports `BezierDefinition` for this. */
export type Bezier = [number, number, number, number];

export const EASE = {
  /** ease-out-quart. Default for anything arriving on screen. */
  out: [0.165, 0.84, 0.44, 1] as Bezier,
  /** ease-out-cubic. Gentler; used for state changes that are not arrivals. */
  outSoft: [0.215, 0.61, 0.355, 1] as Bezier,
  /** ease-in-out-cubic. Only for a body travelling from A to B. */
  inOut: [0.645, 0.045, 0.355, 1] as Bezier,
};

export const DUR = {
  micro: 0.12,
  quick: 0.18,
  base: 0.24,
  slow: 0.3,
  /** Edge flow. Deliberately above the product-UI ceiling; justified in §7. */
  flow: 0.45,
  /** SVG line drawing. */
  draw: 0.5,
} as const;

/** Per-item offsets. Always multiplied by an index within the current batch, never a global index. */
export const STAGGER = {
  row: 0.04,
  fragment: 0.05,
  sparkline: 0.06,
  delta: 0.03,
} as const;

/** Index at which stagger stops growing, so a long batch cannot turn into a show. */
export const STAGGER_CAP = {
  row: 4,
  fragment: 5,
  sparkline: 7,
  delta: 8,
} as const;

export const T = {
  /** A check row's contents arriving. */
  reveal: { duration: DUR.quick, ease: EASE.out },
  /** A band meter travelling to its percentage. */
  meter: { duration: DUR.slow, ease: EASE.out },
  /** Selection, hover, any colour-only state change. */
  select: { duration: DUR.micro, ease: EASE.outSoft },
  /** Strike-through drawing across a replaced fragment. */
  strike: { duration: 0.14, ease: EASE.out },
  /** Replacement text fading in after the strike. */
  insert: { duration: DUR.quick, ease: EASE.out },
  /** Graph node state change. */
  node: { duration: DUR.quick, ease: EASE.out },
  /** Graph node entering `failed`. Faster, so it does not linger. */
  nodeFail: { duration: DUR.micro, ease: EASE.out },
  /** A light travelling one graph edge, once. `repeat: 0` is stated, not assumed. */
  flow: { duration: DUR.flow, ease: EASE.inOut, repeat: 0 },
  /** SVG path drawing. Linear: a pen moves at constant speed. */
  draw: { duration: DUR.draw, ease: "linear" },
  /** Inspector and compare panel opening. */
  panelIn: { duration: DUR.quick, ease: EASE.out },
  /** Every panel closing. Exits are faster than enters. */
  panelOut: { duration: DUR.micro, ease: EASE.out },
  /** Terminal banner. Identical for passed, improved_still_failing and no_improvement. */
  terminal: { duration: DUR.base, ease: EASE.out },
  /** The only transition used under reduced motion where a fade is still wanted. */
  fade: { duration: DUR.micro, ease: "linear" },
  /** Under reduced motion where nothing should move or fade. */
  none: { duration: 0 },
} satisfies Record<string, Transition>;

/**
 * The one spring in the app. `bounce: 0` everywhere, forever: there are no drag gestures in
 * Prompt Coach, and bounce on a click-triggered element reads as toy-like.
 * `visualDuration` is the perceived time to the target, which is what you tune against.
 */
export const SPRING = {
  /** Pass-stepper pill sliding between steps. Spring because it is interruptible. */
  pill: { type: "spring", visualDuration: 0.22, bounce: 0 },
} satisfies Record<string, Transition>;
