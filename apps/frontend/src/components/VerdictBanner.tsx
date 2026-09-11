import { motion } from "motion/react";
import type { RunStatus, TerminalStatus } from "@ai-director/contract";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";
import { BandMark } from "./BandMark.js";

export type VerdictBannerProps = {
  status: RunStatus;
  /** Count of scored checks still below band 4 in the run's last pass. Never the score. */
  failingCount: number;
  passesUsed: number;
  /** Mean of the scored checks' `percent` in the run's first pass. */
  meanBefore: number;
  /** Mean of the scored checks' `percent` in the run's last pass. */
  meanAfter: number;
};

function isTerminalStatus(status: RunStatus): status is TerminalStatus {
  return status === "passed" || status === "improved_still_failing" || status === "no_improvement";
}

/** The verdict word, exactly as design doc §6.2's binding table fixes it. */
export function verdictWord(status: TerminalStatus): string {
  switch (status) {
    case "passed":
      return "PASSED";
    case "improved_still_failing":
      return "STILL FAILING";
    case "no_improvement":
      return "NO IMPROVEMENT";
  }
}

/** The `--fs-count` numeral: the score for `passed`, but the count of checks still below band 4
 *  for either failing state — never the score (design doc §6.2, structural fact 1). */
export function verdictNumeral(status: TerminalStatus, failingCount: number): number {
  return status === "passed" ? 9 - failingCount : failingCount;
}

/** The label beside the numeral, exactly as §6.2 fixes it per status. */
export function verdictNumeralLabel(status: TerminalStatus): string {
  return status === "passed" ? "of 9 checks at band 4 or above" : "checks still below band 4";
}

/**
 * The mandatory second line, exactly as §6.2 fixes it per status. `improved_still_failing`'s
 * qualifying clause — "the description did not pass" — always shares the line with any
 * improvement wording, so no truncation or screenshot can separate the two (structural fact 2).
 */
export function verdictSecondLine(
  status: TerminalStatus,
  passesUsed: number,
  meanBefore: number,
  meanAfter: number,
): string {
  if (status === "passed") {
    return `${passesUsed} passes used · mean ${meanAfter}`;
  }
  if (status === "no_improvement") {
    return `${passesUsed} passes used · mean unchanged at ${meanAfter} · no fragment improved its band`;
  }
  const change =
    meanAfter > meanBefore
      ? `rose ${meanBefore} → ${meanAfter}`
      : meanAfter < meanBefore
        ? `fell ${meanBefore} → ${meanAfter}`
        : `unchanged at ${meanAfter}`;
  return `${passesUsed} passes used · mean ${change} · the description did not pass`;
}

/**
 * The terminal state banner. Governed entirely by design doc §6.2's binding table — nothing here
 * renders anything outside that table's row for `status`. This is the single most important
 * requirement in the product (spec, PRODUCT.md principle 3, Global Constraints): the UI must never
 * show a success state for `improved_still_failing` or `no_improvement`.
 *
 * Deliberately not a live region — design doc §7 reserves the one polite `role="status"` and one
 * assertive `role="alert"` region for `LiveAnnouncer`; a second live region here would double the
 * announcement. `RunScreen` builds its assertive terminal announcement from the same helpers this
 * component renders from, so the spoken and the printed word are never two different wordings.
 */
export function VerdictBanner({
  status,
  failingCount,
  passesUsed,
  meanBefore,
  meanAfter,
}: VerdictBannerProps): React.JSX.Element | null {
  const { t, v } = useMotionPrefs();
  if (!isTerminalStatus(status)) return null;

  const numeral = verdictNumeral(status, failingCount);
  const numeralLabel = verdictNumeralLabel(status);
  const line = verdictSecondLine(status, passesUsed, meanBefore, meanAfter);
  const markBand = status === "passed" ? 5 : 1;

  return (
    // Motion spec §12 (Moment 10): identical transition, identical initial/animate targets for
    // all three terminal states — no branch on status anywhere in this animation. Only the copy
    // and the tone token differ; a gentler or springier arrival for one status would editorialise
    // a research result.
    <motion.section
      className="verdict-banner"
      data-status={status}
      aria-label="Run verdict"
      initial={v({ opacity: 0, y: 6 }, { opacity: 0 })}
      animate={v({ opacity: 1, y: 0 }, { opacity: 1 })}
      transition={t(T.terminal, T.fade)}
    >
      <BandMark
        band={markBand}
        orientation="h"
        size={28}
        title={status === "passed" ? "band 5, double rule" : "band 1, wave"}
      />
      <p className="verdict-banner__word">{verdictWord(status)}</p>
      <p className="verdict-banner__count">
        <span data-testid="verdict-numeral" className="verdict-banner__count-num tnum">
          {numeral}
        </span>
        <span className="verdict-banner__count-label">{numeralLabel}</span>
      </p>
      <p data-testid="verdict-second-line" className="verdict-banner__detail">
        {line}
      </p>
    </motion.section>
  );
}
