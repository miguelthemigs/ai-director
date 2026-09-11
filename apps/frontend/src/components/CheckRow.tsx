import { memo } from "react";
import { motion } from "motion/react";
import type { CheckId, CheckResultView } from "@ai-director/contract";
import { STAGGER, STAGGER_CAP, T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";
import { BandMeter } from "./BandMeter.js";
import { QuoteList } from "./QuoteList.js";
import { SkeletonRows } from "./SkeletonRows.js";

export type CheckRowProps = {
  checkId: CheckId;
  title: string;
  /** `null` before this check has any result at all. */
  result: CheckResultView | null;
  /** Position among the rows revealing in the batch that just landed. 0 for an already-scored row. */
  revealIndex: number;
  selected: boolean;
  /** Roving-tabindex target: only one row in the whole listbox is ever a tab stop. */
  active: boolean;
  /** The run is streaming and this check's group has not completed yet. */
  streaming: boolean;
  activeSpanId: string | null;
  onSelect: (checkId: CheckId) => void;
  onSelectSpan: (spanId: string) => void;
  /** React 19 accepts `ref` as an ordinary prop on function components; `CheckPanel` uses it to
   *  move DOM focus for the roving-tabindex keyboard path. */
  ref?: React.Ref<HTMLLIElement>;
};

function CheckRowImpl(props: CheckRowProps): React.JSX.Element {
  const {
    checkId,
    title,
    result,
    revealIndex,
    selected,
    active,
    streaming,
    activeSpanId,
    onSelect,
    onSelectSpan,
    ref,
  } = props;
  const { t, v } = useMotionPrefs();

  const arrived = result !== null;
  const delay = Math.min(revealIndex, STAGGER_CAP.row) * STAGGER.row;
  const isScored = result?.status === "scored";
  const isFailing = isScored && !result.passed;

  return (
    <li
      ref={ref}
      id={`check-row-${checkId}`}
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      className="check-row"
      data-selected={selected || undefined}
      data-status={result?.status ?? "pending"}
    >
      <button type="button" className="check-row__hit" onClick={() => onSelect(checkId)}>
        {/* Always visible, never animated: the row must be readable before any score exists. */}
        <span className="check-row__title">{title}</span>

        <motion.span
          className="check-row__body"
          initial={{ opacity: 0, y: 6 }}
          animate={arrived ? v({ opacity: 1, y: 0 }, { opacity: 1 }) : v({ opacity: 0, y: 6 }, { opacity: 0 })}
          transition={t({ ...T.reveal, delay }, T.fade)}
        >
          {result === null ? (
            streaming ? (
              <SkeletonRows rows={1} height={26} />
            ) : (
              <BandMeter band={null} percent={null} />
            )
          ) : result.status === "not_evaluated" ? (
            <>
              <span className="check-row__not-evaluated">not evaluated</span>
              <BandMeter band={null} percent={null} />
            </>
          ) : (
            <BandMeter band={result.band} percent={result.percent} delay={delay} />
          )}
        </motion.span>
      </button>

      {result?.status === "not_evaluated" ? (
        <p className="check-row__reason check-row__reason--not-evaluated">{result.reason}</p>
      ) : null}

      {isFailing ? (
        <div className="check-row__detail">
          <p className="check-row__reason">{result.reason}</p>
          <QuoteList
            spans={result.spans}
            unverified={result.unverified}
            activeSpanId={activeSpanId}
            onSelectSpan={onSelectSpan}
          />
        </div>
      ) : null}
    </li>
  );
}

export const CheckRow = memo(CheckRowImpl);
