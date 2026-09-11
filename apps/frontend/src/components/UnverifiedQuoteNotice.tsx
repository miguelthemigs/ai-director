import type { UnverifiedQuoteView } from "@ai-director/contract";

const REASON_TEXT: Record<UnverifiedQuoteView["reason"], string> = {
  not_found:
    "This quote was not found in the description. It was excluded from repair and logged. This is a pipeline defect, not a display problem.",
  ambiguous:
    "This quote matched more than one place in the description. It was excluded from repair and logged. This is a pipeline defect, not a display problem.",
};

export type UnverifiedQuoteNoticeProps = {
  quote: UnverifiedQuoteView;
};

/**
 * The explicit "fragment not found" state. A quote the model returned that code could not verify
 * verbatim in the description must never be silently dropped — that would read as a UI bug and
 * hide a real pipeline defect (spec, and design doc §5).
 */
export function UnverifiedQuoteNotice({ quote }: UnverifiedQuoteNoticeProps): React.JSX.Element {
  return (
    <div className="unverified-quote-notice" role="note">
      <p className="unverified-quote-notice__quote">&ldquo;{quote.quote}&rdquo;</p>
      <p className="unverified-quote-notice__text">{REASON_TEXT[quote.reason]}</p>
    </div>
  );
}
