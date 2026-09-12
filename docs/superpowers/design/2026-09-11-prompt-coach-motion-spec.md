# Motion specification: Prompt Coach v1

Date: 2026-09-11
Owner: Miguel Roale
Status: ready to implement
Governs: `apps/frontend/src/motion/*` and every component in `apps/frontend/src/components/*`
Spec: `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`, section 9
Library: `motion` (React entry `motion/react`). Verified against the published type declarations of
`motion@13.2.0` → `framer-motion@13.2.0` → `motion-dom@13.2.0`. Never import from `framer-motion`.

## 0. The rule this document answers to

> Animation rules: motion is tied to real state changes only, specifically the checks revealing as
> scores land, flow along the graph edges between agents, and the fragment diff transitions. No
> looping or ambient motion, no animation of unchanged scores, none while typing.

Every decision below is derived from that sentence. Three consequences run through the whole spec:

1. **An animation needs an event behind it.** If you cannot name the SSE event or the user gesture
   that caused a frame to change, delete the animation.
2. **Unchanged data must produce zero frames.** This is enforced structurally — by React keys and by
   animating to targets that are equal when the data is equal — not by a developer remembering a
   conditional. Where a conditional is the only option, it is called out.
3. **`repeat: Infinity` does not appear anywhere in this codebase.** There is no legitimate use for
   it here. Treat it as a review failure.

Durations are in seconds because that is Motion's unit. The CSS token block in the UI design doc
carries the same values in milliseconds for the handful of transitions written in plain CSS.

---

## 1. Shared tokens

One file. Nothing in `components/` defines a duration, an easing or a spring inline. If a component
needs a value that is not here, the value is added here first.

```ts
// apps/frontend/src/motion/tokens.ts
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
```

---

## 2. Reduced motion

### 2.1 The pattern

`useReducedMotion()` returns `boolean | null`, not `boolean` — it is `null` until the media query has
been read. Coalescing to `false` is deliberate: treating `null` as "reduced" would freeze the first
paint for everyone.

```ts
// apps/frontend/src/motion/useMotionPrefs.ts
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
```

At the app root, as a backstop for anything a developer forgets to wrap:

```tsx
// apps/frontend/src/App.tsx
import { MotionConfig } from "motion/react";
import { T } from "./motion/tokens";

export function App() {
  return (
    <MotionConfig reducedMotion="user" transition={T.reveal}>
      {/* screens */}
    </MotionConfig>
  );
}
```

`reducedMotion="user"` disables transform and layout animations while preserving values like
`opacity` and `backgroundColor`. That is the right automatic behaviour for this app, but it is not
sufficient on its own — it cannot know that the band meter carries its information in `scaleX`, or
that the edge flow should disappear entirely rather than degrade. `useMotionPrefs` is the primary
mechanism; `MotionConfig` is the net underneath it.

### 2.2 Per-moment degradation

The governing constraint: **nothing in this app is legible only through motion.** Every animation
here decorates a value that is also rendered as text or as a static style. That is checked per
moment below, and it is why every degradation can be this blunt.

| Moment | Reduced-motion behaviour | What still carries the information |
|---|---|---|
| 1 Check row reveal | No stagger, no `y`. 120ms opacity fade only. | The percentage text and the row's `data-scored` style. |
| 2 Band meter | `scaleX` set instantly. | The `%` label and the five static tick marks. |
| 3 Check ↔ fragment | CSS transition removed. Scroll uses `behavior: "auto"`. | The `[data-selected]` background and underline. |
| 4 Fragment diff | Strike and replacement render immediately, no sequence. | `<del>` and `<ins>` semantics plus the diff colour tokens. |
| 5 Pass stepper | Pill jumps between steps (`T.none` overrides the spring). | `aria-selected` and the active step style. |
| 6 Graph node | Colour change only, no accent sweep, no progress travel. | The `state` text label inside every node and the elapsed counter. |
| 7 Edge flow | **Not rendered at all.** | Node states: the source is `done`, the target is `running`. The flow was always redundant; see §7. |
| 8 Inspector | Opacity only, no `x`. | The panel's presence. |
| 9 Sparkline | `pathLength: 1` from first paint, no draw. | The path itself, and the numeric delta badge beside it. |
| 10 Terminal banner | Opacity only, no `y`. | The banner copy and tone token. |

---

## 3. Moment 1 — a check row revealing as its score lands

**Trigger.** `evaluator.group.completed` for one group. The reducer writes bands for that group's
checks; rows in that group go from `band === null` to a `Band`. The three groups (`look` 5 rows,
`safety` 2, `drawable` 2) land independently and in any order.

**Stagger, and why it is indexed within the batch.** The reveal index is the row's position among
*the rows revealing in this event*, not its index among all nine and not its index within the group.
Two reasons. A global index would make `drawable` wait behind `look` rows that may not have landed.
And on a later pass, when only two of five rows change, a within-group index would give them delays
of 0 and 120ms for no reason — the batch index gives 0 and 40ms.

**What happens on a later pass when a score is unchanged.** Nothing, and it is structural rather than
conditional:

- The row mounts once, keyed `check.id`, and never unmounts for the life of the run. All nine are
  visible from first paint (the spec requires it), so a score landing is a fill-in, not an insertion.
  Nothing is inserted, so there is no layout animation anywhere in this moment.
- The reveal (`opacity`, `y`) fires exactly once per row, when `band` first stops being `null`.
  After that the `animate` target is constant, and Motion does not restart an animation whose target
  has not changed.
- The percentage swap is wrapped in `AnimatePresence` keyed on the band value. An unchanged band is
  an unchanged key, so there is no exit and no enter. A developer cannot accidentally animate an
  unchanged score without first changing the key, which would be a visible mistake in review.

```tsx
// apps/frontend/src/components/CheckRow.tsx
import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { bandToPercent, type Band } from "@prompt-coach/contract";
import { STAGGER, STAGGER_CAP, T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";
import { BandMeter } from "./BandMeter";

export type CheckRowProps = {
  checkId: string;
  title: string;
  band: Band | null;
  reason: string | null;
  /** Position among the rows revealing in THIS batch. 0 for a row that has already been scored. */
  revealIndex: number;
  selected: boolean;
  onSelect: (checkId: string) => void;
};

function CheckRowImpl(props: CheckRowProps) {
  const { checkId, title, band, reason, revealIndex, selected, onSelect } = props;
  const { t, v } = useMotionPrefs();

  const scored = band !== null;
  const delay = Math.min(revealIndex, STAGGER_CAP.row) * STAGGER.row;

  return (
    <li className="check-row" data-selected={selected || undefined} data-scored={scored || undefined}>
      <button type="button" className="check-row__hit" onClick={() => onSelect(checkId)}>
        {/* Always visible, never animated: the row must be readable before any score exists. */}
        <span className="check-row__title">{title}</span>

        <motion.span
          className="check-row__body"
          initial={{ opacity: 0, y: 6 }}
          animate={
            scored
              ? v({ opacity: 1, y: 0 }, { opacity: 1 })
              : v({ opacity: 0, y: 6 }, { opacity: 0 })
          }
          transition={t({ ...T.reveal, delay }, T.fade)}
        >
          {band === null ? (
            <span className="check-row__percent">—</span>
          ) : (
            /* initial={false}: the first band arrives with the reveal above and must not
               double-animate. Later band changes do animate, because the key changes. */
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={band}
                className="check-row__percent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t(T.select, T.fade)}
              >
                {bandToPercent(band)}%
              </motion.span>
            </AnimatePresence>
          )}

          <BandMeter band={band} delay={delay} />
        </motion.span>
      </button>

      <p className="check-row__reason">{reason ?? ""}</p>
    </li>
  );
}

export const CheckRow = memo(CheckRowImpl);
```

The parent computes `revealIndex` per event, not per render:

```ts
// inside the run reducer, handling evaluator.group.completed
const revealing = event.results.filter((r) => previous.get(r.checkId)?.band == null);
const revealIndex = new Map(revealing.map((r, i) => [r.checkId, i]));
// every other row keeps revealIndex 0 and animates nothing
```

**Timing.** 0.18s, `ease-out-quart` `[0.165, 0.84, 0.44, 1]`, stagger 0.04s capped at index 4.
Arrival motion, so ease-out: fast initial acceleration reads as responsive and the value settles
rather than stopping dead. 40ms is below the ~50ms point at which a cascade starts reading as a wave
travelling down the list rather than a group landing together; five rows at 40ms gives a 160ms tail,
so the whole group completes in 340ms and is perceived as one event, which is what it is.

**Must not animate alongside.** The description pane. The group headers. The other two groups' rows.
The pass stepper. The terminal banner (not known yet). The row's title, which was already on screen.
Any row whose band did not change. The row's height, ever.

---

## 4. Moment 2 — the band meter filling to its percentage

**Trigger.** Same event as moment 1: `band` becomes non-null, or changes on a later pass.

**Property.** `transform: scaleX` on a fill element inside a fixed-width track, with
`transform-origin: left center`. Not `width`: width is a layout property and nine of these animating
at once would run layout on every frame. The track has the border radius and `overflow: hidden`; the
fill has square corners, because `scaleX` on a rounded fill squashes the radius horizontally.

The track also renders five static tick marks at 20/40/60/80/100 with the pass threshold (band 4)
marked. This is what makes the whole meter safe to freeze under reduced motion — the position is
readable without the travel.

```tsx
// apps/frontend/src/components/BandMeter.tsx
import { memo } from "react";
import { motion } from "motion/react";
import { bandToPercent, type Band } from "@prompt-coach/contract";
import { T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

export type BandMeterProps = {
  band: Band | null;
  /** Supplied by CheckRow. Always 0 for a row that has already been scored. */
  delay?: number;
};

function BandMeterImpl({ band, delay = 0 }: BandMeterProps) {
  const { t } = useMotionPrefs();
  const percent = band === null ? 0 : bandToPercent(band);

  return (
    <span
      className="band-meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={band === null ? "not scored" : `band ${band} of 5, ${percent} percent`}
    >
      <span className="band-meter__ticks" aria-hidden="true" />
      <motion.span
        className="band-meter__fill"
        aria-hidden="true"
        style={{ transformOrigin: "left center" }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: percent / 100 }}
        transition={t({ ...T.meter, delay })}
      />
    </span>
  );
}

export const BandMeter = memo(BandMeterImpl);
```

**The same-value re-render case.** `animate={{ scaleX: percent / 100 }}` produces an identical target
when the band is identical, and Motion does not start an animation toward a value it is already at.
The only way to replay it is to remount the component, so two rules apply and both belong in review:

- The meter's identity is `checkId` and nothing else. Never key it by pass, by run, or by an SSE
  event id.
- It must not sit inside an `AnimatePresence` or a conditional subtree that a pass change unmounts.
  If the pass view ever needs to re-parent the rows, the meters must not go with them.

There is no `useRef` tracking "has filled". Mutating a ref during render misbehaves under StrictMode
and concurrent rendering; the parent already knows whether this is a reveal and passes `delay: 0`
when it is not.

**Timing.** 0.30s, `ease-out-quart`, delayed by the row's stagger. A note on the choice, because the
naive reading of a motion token table sends bars to `linear`: linear is for **time** — a progress bar
whose fill means elapsed duration. This bar is not time, it is a **value that has already been
decided** arriving at its position. A value arriving decelerates into place. 0.30s is longer than the
row's 0.18s deliberately: the bar travels further than the row fades, and it should still be moving
for a moment after the number is readable, which is what makes the number and the bar read as the
same fact rather than two.

**Must not animate alongside.** The tick marks. The track. The threshold marker (colour only, via
CSS, on the same 0.12s as selection). The row height. Any other row's meter beyond its own stagger
slot.

---

## 5. Moment 3 — check ↔ fragment selection

**Trigger.** Click or Enter on a check row sets `selectedCheckId`. Click or Enter on a highlighted
fragment sets the same value. One piece of state, both directions, no separate `selectedSpanId`.

**What makes it feel instant: there is no Motion component in this moment at all.**

Every verified span is a `<mark>` that is permanently in the DOM at its exact final position, with
its idle background already painted. Selecting changes one attribute. The transition is 120ms of
`background-color` and `box-shadow` in plain CSS. Nothing enters, nothing exits, nothing is measured,
nothing reflows. A user clicking through all nine checks in three seconds gets nine instant colour
changes and zero queued animations.

```css
/* apps/frontend/src/styles/base.css */
.fragment {
  background-color: var(--frag-idle);
  box-shadow: inset 0 -2px 0 var(--frag-rule-idle);
  color: inherit;
  border-radius: 2px;
  transition:
    background-color var(--dur-micro) ease,
    box-shadow var(--dur-micro) ease;
}
.fragment[data-selected] {
  background-color: var(--frag-active);
  box-shadow: inset 0 -2px 0 var(--frag-rule-active);
}
.fragment[data-unverified] {
  /* "fragment not found" — never silently absent. Static, never animated. */
  background: repeating-linear-gradient(/* … */);
}
@media (prefers-reduced-motion: reduce) {
  .fragment { transition: none; }
}
```

```tsx
// apps/frontend/src/components/DescriptionText.tsx
import { memo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import type { SpanView } from "@prompt-coach/contract";
import { segmentDescription } from "../lib/segmentDescription";

export type DescriptionTextProps = {
  text: string;
  /** Verified spans only, sorted by start offset. */
  spans: SpanView[];
  selectedCheckId: string | null;
  onSelectCheck: (checkId: string) => void;
};

function DescriptionTextImpl(props: DescriptionTextProps) {
  const { text, spans, selectedCheckId, onSelectCheck } = props;
  const reduce = useReducedMotion() ?? false;
  const paneRef = useRef<HTMLDivElement>(null);

  // The only motion in this moment, and only when the fragment is actually out of view.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || selectedCheckId === null) return;
    const el = pane.querySelector<HTMLElement>(`[data-check-id="${CSS.escape(selectedCheckId)}"]`);
    if (!el) return;

    const box = el.getBoundingClientRect();
    const view = pane.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;

    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [selectedCheckId, reduce]);

  return (
    <div className="description-pane" ref={paneRef}>
      <p className="description">
        {segmentDescription(text, spans).map((part) =>
          part.kind === "plain" ? (
            <span key={part.key}>{part.value}</span>
          ) : (
            <mark
              key={part.key}
              className="fragment"
              data-check-id={part.checkId}
              data-selected={part.checkId === selectedCheckId || undefined}
              data-unverified={part.unverified || undefined}
              tabIndex={0}
              role="button"
              aria-pressed={part.checkId === selectedCheckId}
              onClick={() => onSelectCheck(part.checkId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectCheck(part.checkId);
                }
              }}
            >
              {part.value}
            </mark>
          ),
        )}
      </p>
    </div>
  );
}

export const DescriptionText = memo(DescriptionTextImpl);
```

The check row's own selected ring uses the same 120ms colour transition, so the two ends of the
interaction land on the same beat.

**Timing.** 0.12s, built-in `ease`. A subtle state change on a high-frequency control. Below ~150ms
a colour change reads as a response rather than an animation, and colour interpolation is
interruptible mid-flight without leaving an artefact, which matters when the user is clicking faster
than the transition finishes.

**Rejected: a shared `layoutId` indicator that slides between fragments.** A quoted fragment is
inline text and wraps across lines, so it has several client rects. Motion's layout animation
represents a change as one `transform` on one box, which cannot describe a box that was two lines and
is now one. It produces a smear or a snap, unpredictably, depending on the paragraph width. Do not
reach for it.

**Must not animate.** The `<mark>` must never scale, translate or change `font-weight` — an inline
element changing its metrics shifts the line's baseline and makes the surrounding text jitter, which
on a research instrument reads as a rendering bug. The row order. The meters. The description's
scroll position when the fragment is already visible.

---

## 6. Moment 4 — the fragment diff between passes

This is the hardest moment in the app, and the honest answer starts with what cannot be done.

**Trigger.** The selected pass changes to a pass whose `replacements` are non-empty, or the run
advances to a pass that produced replacements. Each changed span renders old text and new text
inline; the unchanged remainder of the description is byte-identical by construction and stays
exactly where it was.

### 6.1 The layout shift, stated honestly

Inserting the replacement text makes the paragraph reflow. That reflow **cannot be animated**, and
three approaches that look like they would work do not:

- **`layout` on the fragment span.** Same failure as §5: an inline element that wraps has multiple
  client rects, and Motion's projection applies a single `transform` to a single box. It smears.
- **`display: inline-block` on the fragment so it has one box.** Now a long fragment cannot wrap, so
  it either overflows the column or forces an early line break. It trades a smear for a broken
  paragraph.
- **Crossfading the whole description block between passes.** Forbidden outright — "never a
  whole-text rewrite" — and it would animate the byte-identical regions, which is the precise
  opposite of what the splice guarantee exists to show.

What can be controlled is **when** the reflow happens and **whether the user is looking at it.** So
the sequence pins the reflow to one instant, at a moment the eye is already on the fragment, and puts
no motion on either side of it that would compete for attention.

### 6.2 The sequence

Three beats, per fragment, staggered in document order:

| Beat | Window | What moves | Layout cost |
|---|---|---|---|
| 1 | 0 → 0.14s | Strike-through line draws left to right across the old text (`scaleX` on an absolutely positioned rule). Old text's colour dims to the removed token. | None. Absolute positioning and `transform` only. |
| 2 | at 0.14s | Replacement text is inserted into the DOM. | **The single reflow.** One frame, unanimated. |
| 3 | 0.14 → 0.32s | Replacement fades `opacity` 0 → 1. | None. |

Nothing is removed during the forward sequence: the old text stays, struck through, because that is
what the diff shows in its resting state. The only element entering is the replacement, so the
paragraph gets longer once and never shorter mid-animation.

Going backwards, the sequence reverses: the replacement fades out first, then it leaves the DOM (the
second and final reflow), then the strike retracts. Direction is supplied by the pass stepper (§7).

```tsx
// apps/frontend/src/components/FragmentDiff.tsx
import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR, STAGGER, STAGGER_CAP, T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

export type FragmentDiffProps = {
  spanId: string;
  passIndex: number;
  oldText: string;
  newText: string;
  /** True when the selected pass is at or after the pass that made this replacement. */
  applied: boolean;
  /** Document order among the fragments changed in this pass. */
  order: number;
};

function FragmentDiffImpl(props: FragmentDiffProps) {
  const { spanId, passIndex, oldText, newText, applied, order } = props;
  const { t } = useMotionPrefs();

  const slot = Math.min(order, STAGGER_CAP.fragment) * STAGGER.fragment;

  return (
    <span className="diff" data-span-id={spanId}>
      <del className="diff__old">
        {oldText}
        <motion.span
          className="diff__strike"
          aria-hidden="true"
          style={{ transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: applied ? 1 : 0 }}
          /* Forward: strike first. Backward: wait for the replacement to leave, then retract. */
          transition={t({ ...T.strike, delay: applied ? slot : DUR.micro })}
        />
      </del>

      <AnimatePresence initial={false}>
        {applied && (
          <motion.ins
            key={`${spanId}:${passIndex}`}
            className="diff__new"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: t(T.panelOut) }}
            transition={t({ ...T.insert, delay: slot + T.strike.duration })}
          >
            {newText}
          </motion.ins>
        )}
      </AnimatePresence>
    </span>
  );
}

export const FragmentDiff = memo(FragmentDiffImpl);
```

`motion.ins` and `motion.del` are real components — Motion's `HTMLElements` map includes both — so
the diff keeps its `<ins>`/`<del>` semantics without wrapping in a `<span>`. That matters here: the
semantics, not the motion, are what survive under reduced motion and in a screen reader.

### 6.3 Containing the blast radius

Because a pass's diff can be taller than the previous pass's, the reflow can push everything below
the description. Two rules:

- The description pane scrolls internally and has its own bounded height. The right-hand check column
  and the terminal banner never move because of a diff.
- `.description` carries a `min-height` set from the tallest rendered pass, so stepping backwards
  through passes does not make the pane's own scrollbar appear and disappear.

If neither is feasible in a given layout, the reflow is allowed to snap. It is never animated.

**Timing.** Strike 0.14s `ease-out-quart`; insert 0.18s `ease-out-quart` starting at 0.14s;
0.32s total. Stagger 0.05s, capped at index 5. The total is held under 350ms so that six staggered
fragments still finish inside 0.6s — beyond that the edit stops reading as an edit and starts reading
as a sequence being performed for the user. Ease-out on both beats: the strike is a pen stroke
arriving at the end of a word, and the replacement is arriving on screen.

**Must not animate.** The unchanged text, in any way — it is byte-identical by construction and any
motion on it would contradict the guarantee the screen exists to demonstrate. The paragraph's
position or size. The check rows and their meters, which are showing the *previous* pass's scores
until the next `evaluator.group.completed` arrives. The scroll position. And when the run's status is
`no_improvement`, no fragment diff sequence runs at all, because nothing changed — see §12.

---

## 7. Moment 5 — the pass stepper switching passes

**Trigger.** The user clicks a step, or the run advances. Direction is `Math.sign(next - current)`.

```ts
// apps/frontend/src/screens/RunScreen.tsx
const [view, setView] = useState<{ pass: number; direction: 1 | -1 }>({ pass: 1, direction: 1 });

const selectPass = useCallback((next: number) => {
  setView((prev) => ({ pass: next, direction: next >= prev.pass ? 1 : -1 }));
}, []);
```

**The non-obvious decision: the stepper does not animate the description.** The instinct is a
direction-aware slide of the pass content, and it is wrong here twice over. It would animate the
whole description including the byte-identical regions, and it would run at the same time as the
fragment diff sequence, giving two competing motions for one state change.

So the stepper animates one thing — its own indicator pill — and the direction is expressed in the
body by **playing the fragment diff forward or backward** (§6.2). Forward: strike, then insert.
Backward: un-insert, then un-strike. That is direction-aware without a slide, and it means the
motion describes the actual edit rather than the navigation.

```tsx
// apps/frontend/src/components/PassStepper.tsx
import { motion } from "motion/react";
import { SPRING } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

export type PassStepperProps = {
  /** Only the passes that exist. A one-pass run renders one step and no pill motion. */
  passes: number[];
  selected: number;
  onSelect: (pass: number) => void;
};

export function PassStepper({ passes, selected, onSelect }: PassStepperProps) {
  const { t } = useMotionPrefs();

  return (
    <div className="pass-stepper" role="tablist" aria-label="Repair passes">
      {passes.map((pass) => {
        const active = pass === selected;
        return (
          <button
            key={pass}
            type="button"
            role="tab"
            aria-selected={active}
            className="pass-stepper__step"
            onClick={() => onSelect(pass)}
          >
            {active && (
              <motion.span
                layoutId="pass-stepper-pill"
                className="pass-stepper__pill"
                aria-hidden="true"
                /* borderRadius via style so Motion corrects the scale distortion. */
                style={{ borderRadius: 6 }}
                transition={t(SPRING.pill)}
              />
            )}
            <span className="pass-stepper__label">Pass {pass}</span>
          </button>
        );
      })}
    </div>
  );
}
```

**Why `layoutId` is right here and nowhere else in the app.** The pill is a single block-level box of
fixed size, moving between three known positions in one row that never wraps. That is the exact case
layout projection was built for. Every other candidate in this app — inline spans, nine rows that
never reorder, static graph nodes — fails one of those conditions. §13 lists them.

**Why a spring rather than a bezier.** The user can click 1 → 2 → 3 faster than 220ms. A bezier
re-targeted mid-flight restarts from zero velocity and visibly stutters; a spring carries its
velocity through the interruption. `bounce: 0`, because a click-triggered navigation that overshoots
reads as playful and this is an audit screen.

**Timing.** `visualDuration: 0.22`, `bounce: 0`. 220ms is the perceived travel across three steps of
roughly 100px each — fast enough to feel like the pill followed the click, slow enough to be traced.

**Must not animate alongside.** The description block's position or opacity. The check rows. The
meters. The nine scores, which belong to the run and not to the viewed pass. The step labels.

---

## 8. Moment 6 — graph node state transitions

**Trigger.** `evaluator.group.started` / `evaluator.group.completed`, `repairer.started` /
`repairer.completed`, `run.failed`. States: `queued → running → done`, or `→ failed`. Nodes for
unbuilt agents are `planned`.

### 8.1 Resolving "running" without a loop

This is the sharpest conflict in the spec, so here is the reasoning rather than the conclusion alone.

Every reflex for "this is working" is a loop: a pulse, a spinner, a shimmer, a dashed border in
motion. All are forbidden. They are also, on inspection, the wrong answer regardless of the rule — a
pulse conveys no information. It does not say how long the step has been running, how far through it
is, or whether it is stuck. It says "this element has a CSS animation on it".

The resolution has three parts, and the first is the important one:

**1. A running node does not animate. It animates once, on entry, then holds a distinct static
state.** `queued → running` plays a single 0.18s change: the node's colour tokens swap, and the
accent rule along its top edge sweeps `scaleX` 0 → 1 from the left. One shot. Once it has played, the
node sits still, visibly different from `queued` and `done` by fill, border and an always-present
text label reading `running`.

**2. Elapsed time is rendered as text. It is data, not motion.** A monospace counter ticking at 1s
granularity changes because a real value changed, which is exactly what the rule permits, and it
answers the question the pulse was pretending to answer: *has this been running for two seconds or
forty?* It is a text node re-rendering. No Motion component is involved and no transition is applied
to it.

**3. Progress inside a running node is real and event-driven.** The Evaluator makes three group calls
per pass. Each `evaluator.group.completed` moves the node's progress bar 1/3 → 2/3 → 3/3, using the
same `scaleX` mechanism as the band meter. That is genuine motion during the running state, and every
frame of it is caused by an event that actually happened. Nodes with no sub-steps (Repairer) hold
progress at 0 until they complete.

So "running" reads as running through a static style change, a real number that advances, and real
progress that advances — and the thing a pulse was faking is instead measured.

```tsx
// apps/frontend/src/components/GraphNode.tsx
import { memo } from "react";
import { motion } from "motion/react";
import { T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

export type NodeState = "planned" | "queued" | "running" | "done" | "failed";

export type GraphNodeProps = {
  nodeId: string;
  label: string;
  state: NodeState;
  /** Real, event-driven progress in 0-1. Evaluator: groups completed / 3. Others: 0 or 1. */
  progress: number;
  /** Whole seconds since the node started, or null when it is not running. */
  elapsedSeconds: number | null;
  onOpen: (nodeId: string) => void;
};

function GraphNodeImpl(props: GraphNodeProps) {
  const { nodeId, label, state, progress, elapsedSeconds, onOpen } = props;
  const { t } = useMotionPrefs();

  // A planned node is not a motion component. There is no code path that can animate it.
  if (state === "planned") {
    return (
      <div className="node node--planned">
        <span className="node__label">{label}</span>
        <span className="node__state">planned</span>
      </div>
    );
  }

  const running = state === "running";

  return (
    <motion.button
      type="button"
      className="node"
      data-state={state}
      onClick={() => onOpen(nodeId)}
      /* Colour lives in CSS on [data-state]; only opacity and the accent are animated here. */
      animate={{ opacity: state === "queued" ? 0.55 : 1 }}
      transition={t(state === "failed" ? T.nodeFail : T.node)}
    >
      <motion.span
        className="node__accent"
        aria-hidden="true"
        style={{ transformOrigin: "left center" }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: state === "queued" ? 0 : 1 }}
        /* The sweep is a transform, so reduced motion snaps it. The state label carries the fact. */
        transition={t(T.node, T.none)}
      />

      <span className="node__label">{label}</span>
      <span className="node__state">{state}</span>

      {running && elapsedSeconds !== null && (
        /* Data, not motion: a text node re-rendering once a second. No transition. */
        <span className="node__elapsed">{elapsedSeconds}s</span>
      )}

      <span className="node__track" aria-hidden="true">
        <motion.span
          className="node__progress"
          style={{ transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress }}
          transition={t(T.node)}
        />
      </span>
    </motion.button>
  );
}

export const GraphNode = memo(GraphNodeImpl);
```

**Timing.** `queued → running` and `running → done` both 0.18s `ease-out-quart` — a state landing.
Anything `→ failed` is 0.12s: fast, so it arrives and stops. Colour is transitioned in CSS on
`[data-state]` at the same durations, which keeps the palette in the token file rather than
duplicated as JS strings.

**`failed` gets no shake and no bounce.** A shake is two or more oscillations, which is a loop under
another name; and it editorialises a pipeline defect at the user, who did not cause it. The failed
state is a colour, a label and the error payload one click away in the inspector.

**Planned nodes.** Rendered as a plain `<div>`, never `motion.*`. This is structural: there is no
prop a future developer could add that would animate them, because the element cannot accept one.

**Must not animate alongside.** Node positions — the graph layout is computed once and is static;
there is no force simulation and no settling. Edges other than the one that fired (§9). The inspector
panel. Other nodes' states. The graph's pan or zoom.

---

## 9. Moment 7 — flow along a graph edge

**Trigger.** An event that represents a genuine handoff between agents, not merely a state change.
In v1 that is `repairer.started` (Evaluator → Repairer) and `pass.started` for passes 2 and 3
(Repairer → Evaluator). Each carries the event id `<pass>-<step>`, which is unique per handoff and
becomes the animation's key — so the flow plays exactly once per real handoff and cannot be replayed
by a re-render.

**Implementation.** A dim base path is always drawn at full length. A bright overlay path holds
`pathLength` at a short constant and travels by animating `pathOffset` from 0 to `1 - pathLength`.
Both values are Motion's SVG line-drawing properties, normalised 0–1 against the path's total length.
`repeat: 0` is written out in the token rather than left to the default, so it is visible in review.

```tsx
// apps/frontend/src/components/GraphEdge.tsx
import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

const SEGMENT = 0.22;

export type GraphEdgeProps = {
  edgeId: string;
  /** SVG path data for this edge. Computed once from the static layout. */
  d: string;
  /** The SSE event id of the handoff that lit this edge, or null. Unique per handoff. */
  flowToken: string | null;
  planned: boolean;
};

function GraphEdgeImpl({ edgeId, d, flowToken, planned }: GraphEdgeProps) {
  const { t, reduce } = useMotionPrefs();

  return (
    <g className="edge" data-edge-id={edgeId} data-planned={planned || undefined}>
      <path className="edge__base" d={d} fill="none" />

      {/* Planned edges never flow. Under reduced motion nothing flows; see §2.2. */}
      {!planned && !reduce && (
        <AnimatePresence>
          {flowToken !== null && (
            <motion.path
              key={flowToken}
              className="edge__flow"
              d={d}
              fill="none"
              initial={{ pathLength: SEGMENT, pathOffset: 0, opacity: 1 }}
              animate={{ pathOffset: 1 - SEGMENT }}
              exit={{ opacity: 0, transition: t(T.panelOut) }}
              transition={t(T.flow)}
            />
          )}
        </AnimatePresence>
      )}
    </g>
  );
}

export const GraphEdge = memo(GraphEdgeImpl);
```

The reducer clears `flowToken` on the edge after `T.flow.duration + T.panelOut.duration`, or on the
next handoff, whichever comes first. It is never set from a render.

**Timing.** 0.45s, `ease-in-out-cubic`. This is the one duration in the app above the 300ms
product-UI ceiling, and the exception is deliberate: the motion's entire job is to say *where the
work went*, so the eye has to be able to trace it across the edge's length. A 200ms flash on a 180px
path is missed if the user happened to be reading the check column. There are at most four handoffs
in a three-pass run, so this is a low-frequency, illustrative event, which is where longer durations
are allowed. Ease-in-out because it is a body travelling from one place to another: it accelerates
away from the source and settles into the target.

**Reduced motion drops it entirely rather than degrading it.** The flow is the only motion in the app
that is purely redundant — the same information is already in the two node states (source `done`,
target `running`) and in the event log inside the inspector. Nothing is lost by removing it, and
there is no static substitute that would need inventing.

**Must not animate alongside.** Every other edge. The node positions. Node state changes fire on
their own events, which happen to be adjacent in time; that is coincidence, not choreography, and no
delay should be added to line them up.

---

## 10. Moment 8 — the node payload inspector

**Trigger.** Clicking a node sets `inspectorNodeId`. Clicking close, pressing Escape, or clicking the
open node again clears it.

**Layout.** The inspector occupies a reserved column in the Architecture screen's grid, hidden when
closed. The graph pane's width therefore never changes, so there is no layout animation anywhere in
this moment. If a future layout cannot reserve the column, the graph's width snaps; it is never
animated.

```tsx
// apps/frontend/src/components/NodeInspector.tsx
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { NodePayloadView } from "@prompt-coach/contract";
import { T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";
import { PayloadBody } from "./PayloadBody";

export type NodeInspectorProps = {
  /** null when closed. */
  payload: NodePayloadView | null;
  onClose: () => void;
};

export function NodeInspector({ payload, onClose }: NodeInspectorProps) {
  const { t, v } = useMotionPrefs();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves on the state change, never in onAnimationComplete: motion must not gate a11y.
  useEffect(() => {
    if (payload !== null) closeRef.current?.focus();
  }, [payload?.nodeId]);

  return (
    <aside className="inspector">
      <AnimatePresence>
        {payload !== null && (
          <motion.div
            key="inspector-panel"
            className="inspector__panel"
            role="dialog"
            aria-label="Step payload"
            initial={v({ opacity: 0, x: 16 }, { opacity: 0 })}
            animate={v({ opacity: 1, x: 0 }, { opacity: 1 })}
            exit={{ ...v({ opacity: 0, x: 16 }, { opacity: 0 }), transition: t(T.panelOut) }}
            transition={t(T.panelIn, T.fade)}
          >
            <button type="button" ref={closeRef} onClick={onClose}>Close</button>

            {/* Switching nodes keeps the panel and swaps only the body. mode="wait" so two
                payloads of different heights never overlap. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={payload.nodeId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={t(T.select, T.fade)}
              >
                <PayloadBody payload={payload} />
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
```

**Timing.** Open 0.18s `ease-out-quart` with `x: 16 → 0` — a small travel from the edge the panel is
docked to, enough to say where it came from without a slide the user waits through. Close 0.12s: the
user who dismissed a panel wants it gone, and a symmetric exit always feels slower than the enter.
Body swap 0.12s out then 0.12s in via `mode="wait"`.

No `scale`. A large surface scaling in reads as rubbery, and the panel is not a popover anchored to a
point — it has a fixed edge, so translation is the truthful description of where it came from.

**Must not animate alongside.** The graph's width, position or zoom. The node that was clicked — it
gets a selected style, not a lift or a scale. The other nodes' states. The payload's syntax-
highlighted JSON body, which is a wall of text and is never staggered, revealed or typed.

---

## 11. Moment 9 — the versions sparkline and the compare view

### 11.1 Sparkline

**Trigger.** The row's series arriving for the first time. Versions data is read from disk, so in
practice it is usually present at first paint — and in that case **the draw does not run at all**.
The rule is tied to state changes, and "data I already had" is not one.

```tsx
// apps/frontend/src/components/Sparkline.tsx
import { memo } from "react";
import { motion } from "motion/react";
import { STAGGER, STAGGER_CAP, T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

export type SparklineProps = {
  /** SVG path data for the series. */
  d: string;
  /**
   * True only when this row's series arrived after the list had already painted.
   * False when the data was present on first paint, on re-sort, on filter, and on every re-render.
   */
  draw: boolean;
  order: number;
};

function SparklineImpl({ d, draw, order }: SparklineProps) {
  const { t, reduce } = useMotionPrefs();
  const delay = Math.min(order, STAGGER_CAP.sparkline) * STAGGER.sparkline;
  const shouldDraw = draw && !reduce;

  return (
    <svg className="sparkline" viewBox="0 0 64 16" aria-hidden="true" focusable="false">
      <motion.path
        d={d}
        fill="none"
        initial={shouldDraw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={t({ ...T.draw, delay })}
      />
    </svg>
  );
}

export const Sparkline = memo(SparklineImpl);
```

`initial={false}` is what makes the row safe to re-render: the path is placed at `pathLength: 1`
with no animation. Never key a version row by its array index — sorting would remount every row and
replay every draw.

**Timing.** 0.5s `linear`, stagger 0.06s capped at index 7. Linear because a line being drawn is a
pen travelling at constant speed; easing makes the tail of a 64px sparkline rush and the head crawl,
which misrepresents the spacing of the data points. 0.5s is long for product UI and is allowed
because the element is small, illustrative, and draws at most once per session.

**Never `whileInView`.** Scrolling is not a state change in this pipeline. A sparkline that draws
when it scrolls into view is ambient motion triggered by the user's scrollbar.

### 11.2 Compare opening

**Trigger.** A second version is selected, so `compare` becomes a pair.

The panel enters with `opacity 0 → 1` and `y: 8 → 0` over 0.24s `ease-out-quart` — a medium surface
arriving, at the token duration for dialogs and sheets. The two selected rows keep a static selected
style; they do not morph into the panel header. A `layoutId` morph between a variable-height list row
and a panel header is the classic trap: it looks excellent in a mock with one row height and falls
apart the moment a version note wraps to two lines.

The prompt diff body inside does not animate at all. It is a block of text, and animating it would
be the whole-text rewrite the Run screen forbids, re-imported onto another screen.

The per-check score deltas do animate, using the same mechanism as the band meter so the two screens
read as one system: each delta bar `scaleX` 0 → 1 from a centre origin (deltas are signed), 0.24s
`ease-out-quart`, staggered 0.03s capped at index 8 — 30ms is tighter than the check rows because
nine short bars in a compact panel should land almost together.

```tsx
// apps/frontend/src/components/ComparePanel.tsx
import { AnimatePresence, motion } from "motion/react";
import type { CompareView } from "@prompt-coach/contract";
import { STAGGER, STAGGER_CAP, T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";
import { PromptDiff } from "./PromptDiff";

export function ComparePanel({ compare }: { compare: CompareView | null }) {
  const { t, v } = useMotionPrefs();

  return (
    <AnimatePresence>
      {compare !== null && (
        <motion.section
          key="compare"
          className="compare"
          initial={v({ opacity: 0, y: 8 }, { opacity: 0 })}
          animate={v({ opacity: 1, y: 0 }, { opacity: 1 })}
          exit={{ opacity: 0, transition: t(T.panelOut) }}
          transition={t(T.terminal, T.fade)}
        >
          {/* Not animated: a block of text. */}
          <PromptDiff left={compare.left.prompt} right={compare.right.prompt} />

          <ul className="compare__deltas">
            {compare.deltas.map((delta, i) => (
              <li key={delta.checkId} className="compare__delta">
                <span className="compare__delta-label">{delta.title}</span>
                <span className="compare__delta-track" aria-hidden="true">
                  <motion.span
                    className="compare__delta-bar"
                    data-sign={delta.points >= 0 ? "up" : "down"}
                    style={{ transformOrigin: "center" }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.abs(delta.points) / 100 }}
                    transition={t({
                      ...T.terminal,
                      delay: Math.min(i, STAGGER_CAP.delta) * STAGGER.delta,
                    })}
                  />
                </span>
                <span className="compare__delta-value">
                  {delta.points >= 0 ? "+" : ""}{delta.points}
                </span>
              </li>
            ))}
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
```

**Must not animate.** The versions list behind the panel. The row heights. The prompt diff text. The
version notes.

---

## 12. Moment 10 — the terminal states landing

**Trigger.** `run.completed`, carrying `status`. Three outcomes matter: `passed`,
`improved_still_failing`, `no_improvement`.

**The rule, stated as code.** All three get the **identical** transition, the identical `initial`,
the identical `animate`. There is no branch on status anywhere in the animation. Only the copy and
the tone token differ. This is the whole design: if the failing states arrived more slowly, or more
gently, or with a different curve, the motion would be editorialising a research result. And if the
passing state arrived with a spring, a scale-up or a drawn checkmark, the other two would read as
consolation prizes by contrast.

```tsx
// apps/frontend/src/components/TerminalBanner.tsx
import { motion } from "motion/react";
import type { RunStatus } from "@prompt-coach/contract";
import { T } from "../motion/tokens";
import { useMotionPrefs } from "../motion/useMotionPrefs";

type Terminal = Exclude<RunStatus, "running">;

const COPY: Record<Terminal, { title: string; tone: "pass" | "fail" }> = {
  passed: { title: "All nine checks reached band 4 or better", tone: "pass" },
  improved_still_failing: { title: "Scores improved. Checks still below band 4", tone: "fail" },
  no_improvement: { title: "No check improved across three passes", tone: "fail" },
  failed: { title: "Run stopped before completing", tone: "fail" },
};

export function TerminalBanner({ status }: { status: Terminal }) {
  const { t, v } = useMotionPrefs();
  const { title, tone } = COPY[status];

  return (
    <motion.div
      className="terminal"
      data-tone={tone}
      role="status"
      /* One transition. One target. No branch on status — that is the point. */
      initial={v({ opacity: 0, y: 6 }, { opacity: 0 })}
      animate={v({ opacity: 1, y: 0 }, { opacity: 1 })}
      transition={t(T.terminal, T.fade)}
    >
      <h2 className="terminal__title">{title}</h2>
    </motion.div>
  );
}
```

**What `passed` gets.** 0.24s, `ease-out-quart`, `opacity` and 6px of `y`. That is the entire reward.
The information that the run passed is in nine meters sitting at or above the band-4 threshold line;
the banner names it and stops.

**What `improved_still_failing` and `no_improvement` get instead of celebration.** Exactly the same
0.24s arrival, in the failing tone, with copy that states the outcome. `no_improvement` additionally
suppresses the entire fragment diff sequence on the Run screen: the Repairer produced no accepted
replacement, so there is nothing to diff, and playing a diff animation over unchanged text would
misrepresent what the pipeline did. That is a correctness rule, not a taste one.

**Explicitly forbidden on every terminal state**, including `passed`: confetti; a drawn or scaling
checkmark; any spring or `bounce > 0`; a scale-up; a colour cycle or glow; a number counting up to a
final score; a shake or any oscillation on the failing states; a delay before the failing banner
appears.

**Timing.** 0.24s, `ease-out-quart`. The token for a medium surface arriving. Long enough that the
banner does not appear to have always been there, short enough not to be a reveal.

**Must not animate alongside.** The nine rows, which have already landed. The meters. The pass
stepper. The description. The graph, on the other screen.

---

## 13. Performance

### 13.1 Properties

Animated in this app:

- `opacity` and `transform` (`x`, `y`, `scaleX`, `scale`) — compositor-only, no layout, no paint.
- `backgroundColor`, `color` and `box-shadow` on selection and node states — paint, not layout. These
  run in CSS from `[data-selected]` / `[data-state]` attributes so the palette stays in
  `tokens.css` rather than being duplicated as JS colour strings. At most nine elements change colour
  at once and each is small.
- SVG `pathLength` and `pathOffset` — these write `stroke-dasharray` and `stroke-dashoffset`, which
  is paint work, not layout. The budget that makes it safe: the Architecture graph has fewer than a
  dozen edges and only one flows at a time; sparklines are 64×16 with fewer than 20 points.

Never animated: `width`, `height`, `top`, `left`, `right`, `bottom`, `margin`, `padding`, `gap`,
`font-size`, `border-width`. If a value needs to grow, it grows by `scaleX` inside a fixed track.

`will-change` is not set anywhere by hand. Motion promotes what it is animating and releases it
afterwards; a standing `will-change` on nine rows holds nine compositor layers for a run that is
mostly idle.

### 13.2 Where `layout` is warranted, and where it is a trap

**Warranted — exactly one place.** The pass-stepper pill's `layoutId` (§7). Fixed size, block-level,
three known positions, one row, no wrapping.

**Traps, each with its reason:**

- **Inline fragment spans in the description.** A wrapped inline element has several client rects and
  layout projection applies one transform to one box. Smears or snaps depending on where the text
  happens to wrap. (§5, §6.1)
- **The nine check rows.** They never reorder, never resize and never mount or unmount. `layout`
  would buy nothing and would add a measure of every row on every commit, which on an SSE stream is
  every commit.
- **The description paragraph during a diff.** `layout` would apply `scale` to the whole block and
  smear the glyphs. Motion corrects `borderRadius` and `boxShadow` distortion; it does not correct
  text.
- **Graph nodes.** Positions are computed once from a static layout. There is nothing to project.
- **Version rows and the compare panel.** Variable-height rows morphing into a panel header is the
  animation that looks perfect until a note wraps.

**`LayoutGroup`.** Not used. It exists to make layout animations in sibling trees measure together,
and the single `layoutId` in this app lives inside one parent. Adding it "for safety" is not free: it
forces a shared measure cycle across everything inside it.

### 13.3 List-key discipline for the SSE stream

Nine rows re-rendering on every event is the failure mode this section exists to prevent.

- **Row key is `check.id`.** Never the array index. Never `${pass}-${check.id}` — that remounts all
  nine rows on every pass and replays every reveal, which is the exact thing the rule forbids. Never
  an SSE event id and never `Date.now()`.
- **Update by id in the reducer.** If `evaluator.group.completed` for `look` rebuilds all nine
  `CheckResultView` objects, every row re-renders even though seven are unchanged. Motion will not
  re-animate — the targets are value-equal — but React will still reconcile nine subtrees on every
  one of the ~12 events in a three-pass run. Replace only the entries in the event's group:

  ```ts
  case "evaluator.group.completed": {
    const next = new Map(state.checks);
    for (const r of event.results) next.set(r.checkId, { band: r.band, reason: r.reason });
    return { ...state, checks: next };
  }
  ```
- **Memoise the row and pass primitives.** `export const CheckRow = memo(CheckRowImpl)` only works if
  its props are stable: no inline object or array props, no inline arrow handlers. `onSelect` is a
  `useCallback` with an empty dependency list that takes the `checkId`; the row calls
  `onSelect(checkId)` itself.
- **`AnimatePresence` keys are the enforcement mechanism, so choose them deliberately.** The band
  badge is keyed by the band value, which is what makes an unchanged score structurally unable to
  animate. The diff fragment is keyed `${spanId}:${passIndex}`. The edge flow is keyed by the SSE
  event id, so one handoff produces one play.
- **Do not batch the stream by hand.** React 19 batches within a task; a group's five results arrive
  in one `message` event and commit once. Three groups finishing inside one frame produce three
  commits, which is fine. Adding a manual queue would delay the first group behind the slowest.
- **Never key anything by `runId` at the row level.** A run change should remount the screen, not
  cause nine rows to independently re-enter.

---

## 14. Anti-patterns

Each of these is something a competent developer would reach for on this screen. Each is forbidden,
with the reason.

1. **A pulsing, breathing or glowing `running` node.** A loop, and it conveys nothing. Replaced by a
   static state style, an elapsed counter, and event-driven progress. (§8.1)
2. **A spinner on the run button while the stream is open.** Same loop, same emptiness. The run's
   real progress is the pass stepper filling in and the nodes changing state.
3. **A shimmer skeleton on the nine rows before scores land.** Ambient motion, and unnecessary: the
   rows are not unknown-shape placeholders. They show the check's title and an em dash.
4. **Counting the percentage up from 0 to 80.** The percentage is derived from a band and is one of
   five values. A count-up displays 43%, a number the rubric cannot produce. Set it directly.
5. **Confetti, a drawn checkmark, or a scale-pop on `passed`.** A research instrument does not
   congratulate. It also makes the two failing terminal states read as consolation. (§12)
6. **A shake on `failed` or `no_improvement`.** An oscillation is a loop, and it editorialises a
   pipeline result at a user who did not cause it.
7. **A typewriter reveal of the description or of any agent output.** "None while typing" is explicit
   in the rule, the description is read-only after submit, and a typewriter would fake a token stream
   that does not exist — these agents return structured output, not streamed prose.
8. **Crossfading or sliding the whole description when the pass changes.** Forbidden by "never a
   whole-text rewrite", and it animates the byte-identical regions, which contradicts the guarantee
   the screen exists to demonstrate. (§7)
9. **`layout` on the description, its paragraphs or its spans.** Smears text. (§13.2)
10. **Wrapping the nine rows in `AnimatePresence` so they mount per pass.** All nine are visible at
    all times by spec. Unmounting them to buy an entrance animation breaks that and replays reveals
    for unchanged scores.
11. **Hover lift or scale on check rows and graph nodes.** Moving the hovered element can move it out
    from under the cursor and flicker; across nine rows the pointer crosses many of them per second.
    Hover is a colour change, scoped to `@media (hover: hover)`.
12. **`repeat: Infinity`, `repeatType: "mirror"`, or a CSS `@keyframes` with `infinite`.** No
    legitimate use exists in this app. Grep for all three before merging.
13. **A continuously animated edge to suggest "data streaming".** The stream is server-sent events
    carrying discrete results. A flowing pipe would be a picture of something that is not happening.
14. **`whileInView` anywhere, particularly on the versions list.** Scroll position is not pipeline
    state.
15. **`bounce > 0` on anything.** There are no drag gestures in Prompt Coach, so there is no motion
    with momentum to carry. Every spring in the app is `bounce: 0`, and there is only one spring.
16. **Animating an "unverified fragment" indicator to draw attention to it.** The "fragment not
    found" state is a real pipeline signal and must be legible in a screenshot, which motion is not.
17. **Adding a delay so that a node's state change lines up with the edge flow.** They fire on
    different events. Choreographing them would make the graph show a sequence the pipeline did not
    actually run in that order.

---

## 15. Review checklist

Before any Phase B task is marked done:

- [ ] `grep -rn "framer-motion" apps/frontend/src` returns nothing.
- [ ] `grep -rn "repeat: Infinity\|infinite" apps/frontend/src` returns nothing.
- [ ] `grep -rn "duration:\|ease:\|type: \"spring\"" apps/frontend/src/components` returns nothing —
      every value comes from `motion/tokens.ts`.
- [ ] Every `motion.*` component's `transition` goes through `useMotionPrefs().t`.
- [ ] No `key={index}` and no key containing a pass number, run id or event id on a check row.
- [ ] With reduced motion forced on (`<MotionConfig reducedMotion="always">` in a dev build), every
      screen still communicates every state.
- [ ] Replaying a fixture run twice without reload animates each score exactly once.
- [ ] Selecting the same pass twice produces no frames.
- [ ] A run ending in `no_improvement` plays no fragment diff sequence at all.
- [ ] The `passed`, `improved_still_failing` and `no_improvement` banners are indistinguishable in a
      side-by-side recording except for colour and copy.
