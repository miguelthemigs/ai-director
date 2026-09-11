export type Span = {
  spanId: string;
  checkId: string;
  quote: string;
  start: number;
  end: number;
};

export type UnverifiedQuote = {
  checkId: string;
  quote: string;
  reason: "not_found" | "ambiguous";
};

/**
 * Locates each model-supplied quote verbatim inside `description` and returns
 * its offsets, computed here in code rather than trusted from the model.
 *
 * A quote is unverified when it does not appear in the description
 * (`not_found`) or appears more than once, so no single location can be
 * spliced safely (`ambiguous`). Two checks quoting overlapping or nested text
 * are two independent, individually-verified findings — each is kept as its
 * own span. Resolving any resulting overlap (e.g. before a splice) is the
 * caller's responsibility, not this function's.
 */
export function verifySpans(
  description: string,
  quotes: Array<{ checkId: string; quote: string }>,
): { spans: Span[]; unverified: UnverifiedQuote[] } {
  const spans: Span[] = [];
  const unverified: UnverifiedQuote[] = [];
  const perCheckCount = new Map<string, number>();

  for (const { checkId, quote } of quotes) {
    const trimmed = quote.trim();
    if (trimmed.length === 0) {
      unverified.push({ checkId, quote, reason: "not_found" });
      continue;
    }
    const first = description.indexOf(trimmed);
    if (first === -1) {
      unverified.push({ checkId, quote, reason: "not_found" });
      continue;
    }
    if (description.indexOf(trimmed, first + 1) !== -1) {
      unverified.push({ checkId, quote, reason: "ambiguous" });
      continue;
    }
    const index = perCheckCount.get(checkId) ?? 0;
    perCheckCount.set(checkId, index + 1);
    spans.push({
      spanId: `${checkId}:${index}`,
      checkId,
      quote: trimmed,
      start: first,
      end: first + trimmed.length,
    });
  }

  spans.sort((a, b) => a.start - b.start);
  return { spans, unverified };
}
