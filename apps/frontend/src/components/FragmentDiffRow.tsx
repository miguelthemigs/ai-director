import { memo, useEffect, useState } from "react";
import { motion } from "motion/react";
import type { ReplacementView } from "@ai-director/contract";
import { CHECK_TITLES } from "../domain/labels.js";
import { STAGGER, STAGGER_CAP, T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

export type FragmentDiffRowProps = {
  replacement: ReplacementView;
  /** 1-based source line the old fragment started on in the pass's own description. Omitted
   *  (rather than guessed) when the span could not be located. */
  line?: number;
  /** Document order among this pass's changed fragments — drives the stagger (motion spec §6.2). */
  order: number;
  onSelectSpan: (spanId: string) => void;
};

/**
 * One replaced fragment: source line, the old text struck through, the new text inserted, then
 * `checkId · rationale`. `<del>`/`<ins>` carry the change semantically, not only visually (design
 * doc §5). The strike/insert sequence plays once on mount, exactly as motion spec §6.2 times it:
 * strike 0.14s, one unanimated reflow at 0.14s (the text insertion itself), then the replacement
 * fading in over 0.18s. Nothing here uses `layout` — an inline fragment is exactly the trap §13.2
 * warns about.
 *
 * The replacement text is kept OUT of the DOM — not merely transparent — until the strike
 * finishes, so the paragraph's one reflow lands at that instant rather than at mount. Mounting it
 * `opacity: 0` and only delaying its opacity transition was tried first and is wrong: an inline
 * node that is not `display: none` still occupies layout space the moment it exists, so a longer
 * replacement (the common case — repairs usually expand a vague phrase into a specific one) would
 * reflow the paragraph to its final width at t=0, directly under the still-running strike
 * animation — precisely the collision §6.1 pins the reflow to a single instant to avoid. Reduced
 * motion reveals it immediately: every state change still happens, just without the wait
 * (design doc §7 "Reduced motion").
 */
function FragmentDiffRowImpl(props: FragmentDiffRowProps): React.JSX.Element {
  const { replacement, line, order, onSelectSpan } = props;
  const { t, reduce } = useMotionPrefs();
  const slot = Math.min(order, STAGGER_CAP.fragment) * STAGGER.fragment;

  const [revealed, setRevealed] = useState(reduce);
  useEffect(() => {
    if (reduce) {
      setRevealed(true);
      return;
    }
    const delayMs = (slot + T.strike.duration) * 1000;
    const timer = setTimeout(() => setRevealed(true), delayMs);
    return () => clearTimeout(timer);
    // `slot` is fixed for the life of this row (its `order` never changes once mounted); only a
    // change in the reduced-motion preference itself should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <li className="fragment-diff-row">
      <button
        type="button"
        className="fragment-diff-row__jump"
        onClick={() => onSelectSpan(replacement.spanId)}
      >
        {line !== undefined ? (
          <span className="fragment-diff-row__line tnum" aria-hidden="true">
            {String(line).padStart(2, "0")}
          </span>
        ) : null}
        <span className="fragment-diff-row__text">
          <del className="fragment-diff-row__old">
            {replacement.oldText}
            <motion.span
              className="fragment-diff-row__strike"
              aria-hidden="true"
              style={{ transformOrigin: "left center" }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={t({ ...T.strike, delay: slot })}
            />
          </del>
          {revealed ? (
            <motion.ins
              className="fragment-diff-row__new"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={t(T.insert, T.fade)}
            >
              {replacement.newText}
            </motion.ins>
          ) : null}
        </span>
        <span className="fragment-diff-row__meta">{CHECK_TITLES[replacement.checkId]}</span>
      </button>
      <p className="fragment-diff-row__rationale">{replacement.rationale}</p>
    </li>
  );
}

export const FragmentDiffRow = memo(FragmentDiffRowImpl);
