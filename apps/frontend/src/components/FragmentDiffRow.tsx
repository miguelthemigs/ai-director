import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
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
  passIndex: number;
  onSelectSpan: (spanId: string) => void;
};

/**
 * One replaced fragment: source line, the old text struck through, the new text inserted, then
 * `checkId · rationale`. `<del>`/`<ins>` carry the change semantically, not only visually (design
 * doc §5). The strike/insert sequence plays once on mount, exactly as motion spec §6.2 times it:
 * strike 0.14s, one unanimated reflow at 0.14s (the text insertion itself), then the replacement
 * fading in over 0.18s. Nothing here uses `layout` — an inline fragment is exactly the trap §13.2
 * warns about.
 */
function FragmentDiffRowImpl(props: FragmentDiffRowProps): React.JSX.Element {
  const { replacement, line, order, passIndex, onSelectSpan } = props;
  const { t } = useMotionPrefs();
  const slot = Math.min(order, STAGGER_CAP.fragment) * STAGGER.fragment;

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
          <AnimatePresence initial={true}>
            <motion.ins
              key={`${replacement.spanId}:${passIndex}`}
              className="fragment-diff-row__new"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: t(T.panelOut) }}
              transition={t({ ...T.insert, delay: slot + T.strike.duration }, T.fade)}
            >
              {replacement.newText}
            </motion.ins>
          </AnimatePresence>
        </span>
        <span className="fragment-diff-row__meta">{CHECK_TITLES[replacement.checkId]}</span>
      </button>
      <p className="fragment-diff-row__rationale">{replacement.rationale}</p>
    </li>
  );
}

export const FragmentDiffRow = memo(FragmentDiffRowImpl);
