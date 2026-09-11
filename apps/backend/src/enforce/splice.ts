import type { Span } from "./verifySpans.js";

export type Replacement = { spanId: string; newText: string };

export class SpliceError extends Error {}

type OrderedReplacement = { span: Span; newText: string };

/**
 * Throws when `expected` and `actual` differ; does nothing otherwise.
 *
 * This is the post-splice guard for `applyReplacements`: both strings it is
 * ever called with there are built independently from the same span offsets
 * over the same immutable `description`, so in practice it can never fire —
 * it is a regression trip-wire, not a real branch. `splice.test.ts` calls it
 * directly with mismatched strings to prove it would fire if that invariant
 * were ever violated.
 */
export function assertByteIdentical(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new SpliceError("untouched text changed during splice");
  }
}

function resolveOrdered(spans: Span[], replacements: Replacement[]): OrderedReplacement[] {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const ordered: OrderedReplacement[] = [];

  for (const replacement of replacements) {
    const span = byId.get(replacement.spanId);
    if (!span) throw new SpliceError(`unknown spanId ${replacement.spanId}`);
    if (replacement.newText.trim().length === 0) {
      throw new SpliceError(`empty replacement for ${replacement.spanId}`);
    }
    ordered.push({ span, newText: replacement.newText });
  }

  ordered.sort((a, b) => a.span.start - b.span.start);

  // Two checks can legitimately quote overlapping text (wardrobe: "Nike hoodie",
  // no_brand_name: "Nike"). verifySpans already resolves that upstream by demoting
  // one such span to `ambiguous`, but applyReplacements takes a bare Span[] and must
  // not depend on that having happened — it refuses to splice two replacements whose
  // ranges overlap rather than silently merge or corrupt them.
  let previous: OrderedReplacement | undefined;
  for (const current of ordered) {
    if (previous !== undefined && current.span.start < previous.span.end) {
      throw new SpliceError(
        `overlapping spans ${previous.span.spanId} and ${current.span.spanId}`,
      );
    }
    previous = current;
  }

  return ordered;
}

function untouchedRegions(description: string, ordered: OrderedReplacement[]): string {
  let result = "";
  let cursor = 0;
  for (const { span } of ordered) {
    result += description.slice(cursor, span.start);
    cursor = span.end;
  }
  result += description.slice(cursor);
  return result;
}

export function applyReplacements(
  description: string,
  spans: Span[],
  replacements: Replacement[],
): string {
  const ordered = resolveOrdered(spans, replacements);

  let out = "";
  let cursor = 0;
  // Tracks the byte ranges of `out` that came from `description` rather than
  // from a replacement's newText, so the guard below can inspect the actual
  // output rather than recomputing the same formula a second time.
  const outUntouchedRanges: Array<[number, number]> = [];
  for (const { span, newText } of ordered) {
    const gap = description.slice(cursor, span.start);
    const gapStart = out.length;
    out += gap;
    outUntouchedRanges.push([gapStart, out.length]);
    out += newText;
    cursor = span.end;
  }
  const tailStart = out.length;
  out += description.slice(cursor);
  outUntouchedRanges.push([tailStart, out.length]);

  // Post-splice guard: extract the regions of the actual output that were not
  // written by a replacement, and confirm they equal the untouched regions of
  // `description` computed independently. By construction these always
  // agree — see assertByteIdentical — but this checks what `out` really
  // contains, not a second copy of the same computation.
  const outUntouched = outUntouchedRanges.map(([start, end]) => out.slice(start, end)).join("");
  assertByteIdentical(untouchedRegions(description, ordered), outUntouched);

  return out;
}
