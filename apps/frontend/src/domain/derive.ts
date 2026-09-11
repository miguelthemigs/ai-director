import {
  CHECK_IDS,
  isScoredCheck,
  type CheckId,
  type CheckResultView,
  type SpanView,
} from "@ai-director/contract";

/** One line of the description, plus the spans (or partial spans) that fall on it. */
export type SpecimenLineModel = {
  /** 1-based, matching how a script supervisor numbers a page. */
  line: number;
  /** This line's raw text, with no trailing newline. */
  text: string;
  /** Offset of this line's first character in the full description. */
  start: number;
  /** Offset just past this line's last character (before the newline, if any). */
  end: number;
  spans: SpecimenLineSpanModel[];
};

/** A span clipped to the portion of it that falls on one line. */
export type SpecimenLineSpanModel = {
  spanId: string;
  checkId: CheckId;
  /** Offset of the clipped fragment within `line.text`. */
  startInLine: number;
  endInLine: number;
};

/**
 * Splits a description into its source lines and assigns each verified span to every line it
 * touches. A span that straddles a newline (the model quoted across a line break) is clipped and
 * attached to both lines rather than dropped — losing it would hide real coverage from the gutter.
 */
export function splitLines(description: string, spans: SpanView[]): SpecimenLineModel[] {
  const rawLines = description.split("\n");
  const lines: SpecimenLineModel[] = [];
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i] ?? "";
    const start = offset;
    const end = start + text.length;
    lines.push({ line: i + 1, text, start, end, spans: [] });
    offset = end + 1; // skip the newline itself
  }

  for (const span of spans) {
    for (const model of lines) {
      const overlapStart = Math.max(span.start, model.start);
      const overlapEnd = Math.min(span.end, model.end);
      if (overlapStart < overlapEnd) {
        model.spans.push({
          spanId: span.spanId,
          checkId: span.checkId,
          startInLine: overlapStart - model.start,
          endInLine: overlapEnd - model.start,
        });
      }
    }
  }

  return lines;
}

/** The 1-based source line a span's start offset falls on. UI-only; the server never sends this. */
export function lineOfSpan(description: string, start: number): number {
  let line = 1;
  const limit = Math.min(start, description.length);
  for (let i = 0; i < limit; i++) {
    if (description[i] === "\n") line += 1;
  }
  return line;
}

/** Count of scored checks below band 4 (not passing). `not_evaluated` checks are neither passing
 *  nor counted here — an unknown is not a failure, and this must never read as one. */
export function failingCount(results: CheckResultView[]): number {
  return results.filter(isScoredCheck).filter((r) => !r.passed).length;
}

/** Count of scored checks at band 4 or above, for the "n/9 at ≥80" header. Never an average. */
export function passingCount(results: CheckResultView[]): number {
  return results.filter(isScoredCheck).filter((r) => r.passed).length;
}

/** Mean of the scored checks' `percent` fields. Never recomputed from a band; always the contract's
 *  own percentages, averaged. Used only where an aggregate is explicitly asked for (the terminal
 *  banner, a later task) — never inside a group header (see CheckGroupHeader). */
export function meanPercent(results: CheckResultView[]): number {
  const scored = results.filter(isScoredCheck);
  if (scored.length === 0) return 0;
  return scored.reduce((sum, r) => sum + r.percent, 0) / scored.length;
}

/**
 * One lane per check that has at least one verified span, in rubric order, capped at 9. Lane
 * index is stable for the life of the run: a check that has spans in pass 1 keeps its lane even if
 * a later pass gives it none, because the geometry re-used across passes is what makes the gutter
 * readable as one continuous instrument (design doc §4.1).
 */
export function lanesOf(results: CheckResultView[]): CheckId[] {
  const withSpans = new Set(
    results
      .filter(isScoredCheck)
      .filter((r) => r.spans.length > 0)
      .map((r) => r.checkId),
  );
  return CHECK_IDS.filter((id) => withSpans.has(id)).slice(0, 9);
}
