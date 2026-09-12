import type { SpanView, UnverifiedQuoteView } from "@ai-director/contract";
import { UnverifiedQuoteNotice } from "./UnverifiedQuoteNotice.js";

export type QuoteListProps = {
  spans: SpanView[];
  unverified: UnverifiedQuoteView[];
  activeSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
};

/**
 * The verbatim fragments under a failing check, each jumping to its span in the specimen. Every
 * unverified quote renders its explicit notice alongside the verified ones — never omitted.
 */
export function QuoteList({
  spans,
  unverified,
  activeSpanId,
  onSelectSpan,
}: QuoteListProps): React.JSX.Element {
  return (
    <ul className="quote-list">
      {spans.map((span) => (
        <li key={span.spanId}>
          <button
            type="button"
            className="quote-list__quote"
            data-active={span.spanId === activeSpanId || undefined}
            onClick={() => onSelectSpan(span.spanId)}
          >
            &ldquo;{span.quote}&rdquo;
          </button>
        </li>
      ))}
      {unverified.map((quote, index) => (
        // eslint-disable-next-line react/no-array-index-key -- unverified quotes carry no id of their own
        <li key={`${quote.checkId}-unverified-${index}`}>
          <UnverifiedQuoteNotice quote={quote} />
        </li>
      ))}
    </ul>
  );
}
