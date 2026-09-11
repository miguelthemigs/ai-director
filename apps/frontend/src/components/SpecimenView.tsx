import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  CHECK_IDS,
  isScoredCheck,
  type Band,
  type CheckId,
  type CheckResultView,
  type SpanView,
} from "@ai-director/contract";
import { segmentLine, splitLines } from "../domain/derive.js";
import { CHECK_TITLES } from "../domain/labels.js";
import { CoverageGutter, type CoverageRuleGeometry } from "./CoverageGutter.js";
import { SpecimenLine } from "./SpecimenLine.js";
import { SpanMark, type SpanMarkCoveringSpan } from "./SpanMark.js";

export type SpecimenViewProps = {
  description: string;
  results: CheckResultView[];
  lanes: CheckId[];
  selectedCheckId: CheckId | null;
  activeSpanId: string | null;
  onSelectCheck: (checkId: CheckId) => void;
  onClearSelection: () => void;
};

type FlatSpan = {
  spanId: string;
  checkId: CheckId;
  band: Band;
  quote: string;
  start: number;
  indexInCheck: number;
  totalInCheck: number;
};

/**
 * The script field: numbered source lines, coverage gutter, span-highlighted text. Measures line
 * geometry and publishes it to the gutter.
 */
export function SpecimenView({
  description,
  results,
  lanes,
  selectedCheckId,
  activeSpanId,
  onSelectCheck,
  onClearSelection,
}: SpecimenViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());
  const reduce = useReducedMotion() ?? false;

  const bandOf = useMemo(() => {
    const map = new Map<CheckId, Band>();
    for (const r of results) if (isScoredCheck(r)) map.set(r.checkId, r.band);
    return map;
  }, [results]);

  const spans: SpanView[] = useMemo(
    () => results.filter(isScoredCheck).flatMap((r) => r.spans),
    [results],
  );

  const flatSpans: FlatSpan[] = useMemo(() => {
    const byCheck = new Map<CheckId, SpanView[]>();
    for (const s of spans) {
      const list = byCheck.get(s.checkId) ?? [];
      list.push(s);
      byCheck.set(s.checkId, list);
    }
    const result: FlatSpan[] = [];
    for (const [checkId, list] of byCheck) {
      const sorted = [...list].sort((a, b) => a.start - b.start);
      sorted.forEach((s, i) => {
        const band = bandOf.get(checkId);
        if (band === undefined) return;
        result.push({
          spanId: s.spanId,
          checkId,
          band,
          quote: s.quote,
          start: s.start,
          indexInCheck: i + 1,
          totalInCheck: sorted.length,
        });
      });
    }
    return result.sort((a, b) => a.start - b.start);
  }, [spans, bandOf]);

  const flatSpanById = useMemo(() => new Map(flatSpans.map((s) => [s.spanId, s])), [flatSpans]);

  const lines = useMemo(() => splitLines(description, spans), [description, spans]);

  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(flatSpans[0]?.spanId ?? null);
  useEffect(() => {
    if (flatSpans.length === 0) {
      setFocusedSpanId(null);
      return;
    }
    if (!flatSpans.some((s) => s.spanId === focusedSpanId)) setFocusedSpanId(flatSpans[0]?.spanId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatSpans]);

  // One pass over every line's segments, tracking how many times each spanId will actually be
  // rendered (a span can be split across more than one segment — an overlap with another check's
  // quote, or a straddled line break — and its DOM occurrences must be disambiguated for
  // assistive tech, never silently repeated with an identical accessible name).
  const renderedLines = useMemo(() => {
    const segmentsByLine = lines.map((line) => ({ line, segments: segmentLine(line) }));

    const occurrenceTotals = new Map<string, number>();
    for (const { segments } of segmentsByLine) {
      for (const segment of segments) {
        for (const span of segment.spans) {
          occurrenceTotals.set(span.spanId, (occurrenceTotals.get(span.spanId) ?? 0) + 1);
        }
      }
    }

    const occurrenceSeen = new Map<string, number>();
    const result = new Map<number, React.ReactNode[]>();

    for (const { line, segments } of segmentsByLine) {
      const nodes: React.ReactNode[] = [];
      for (const segment of segments) {
        const text = line.text.slice(segment.start, segment.end);

        const covering: SpanMarkCoveringSpan[] = [];
        for (const span of segment.spans) {
          const flat = flatSpanById.get(span.spanId);
          if (!flat) continue;
          const seen = (occurrenceSeen.get(span.spanId) ?? 0) + 1;
          occurrenceSeen.set(span.spanId, seen);
          covering.push({
            spanId: span.spanId,
            checkId: span.checkId,
            checkTitle: CHECK_TITLES[span.checkId],
            band: flat.band,
            index: flat.indexInCheck,
            total: flat.totalInCheck,
            occurrenceIndex: seen,
            occurrenceTotal: occurrenceTotals.get(span.spanId) ?? 1,
            selected: selectedCheckId === span.checkId,
            focused: focusedSpanId === span.spanId,
          });
        }

        const primary = covering[0];
        if (!primary) {
          nodes.push(<span key={`${line.line}-plain-${segment.start}`}>{text}</span>);
          continue;
        }

        const lane = Math.max(lanes.indexOf(primary.checkId), 0);
        nodes.push(
          <SpanMark
            key={`${line.line}-${segment.start}`}
            text={text}
            lane={lane}
            covering={covering}
            onSelect={onSelectCheck}
          />,
        );
      }
      result.set(line.line, nodes);
    }
    return result;
  }, [lines, flatSpanById, lanes, selectedCheckId, focusedSpanId, onSelectCheck]);

  const moveFocus = useCallback((spanId: string | undefined) => {
    if (!spanId) return;
    setFocusedSpanId(spanId);
    // A spanId can render more than one element (split by an overlap or a line break); the first
    // occurrence is as good a place as any to land focus.
    containerRef.current?.querySelector<HTMLButtonElement>(`[data-span-id="${CSS.escape(spanId)}"]`)?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = flatSpans.findIndex((s) => s.spanId === focusedSpanId);
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          moveFocus(flatSpans[Math.min(index + 1, flatSpans.length - 1)]?.spanId);
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveFocus(flatSpans[Math.max(index - 1, 0)]?.spanId);
          break;
        case "Home":
          event.preventDefault();
          moveFocus(flatSpans[0]?.spanId);
          break;
        case "End":
          event.preventDefault();
          moveFocus(flatSpans[flatSpans.length - 1]?.spanId);
          break;
        case "n":
        case "p": {
          if (!selectedCheckId) break;
          event.preventDefault();
          const ofCheck = flatSpans.filter((s) => s.checkId === selectedCheckId);
          if (ofCheck.length === 0) break;
          const pos = ofCheck.findIndex((s) => s.spanId === focusedSpanId);
          const nextPos =
            event.key === "n" ? (pos + 1 + ofCheck.length) % ofCheck.length : (pos - 1 + ofCheck.length) % ofCheck.length;
          moveFocus(ofCheck[pos === -1 ? 0 : nextPos]?.spanId);
          break;
        }
        case "Enter":
        case " ": {
          const current = flatSpanById.get(focusedSpanId ?? "");
          if (current) {
            event.preventDefault();
            onSelectCheck(current.checkId);
          }
          break;
        }
        case "Escape":
          event.preventDefault();
          onClearSelection();
          break;
        default: {
          if (/^[1-9]$/.test(event.key)) {
            const target = CHECK_IDS[Number(event.key) - 1];
            if (target) {
              event.preventDefault();
              onSelectCheck(target);
            }
          }
        }
      }
    },
    [flatSpans, focusedSpanId, selectedCheckId, flatSpanById, moveFocus, onSelectCheck, onClearSelection],
  );

  // Scroll the selected check's active fragment into view — the only motion in this moment
  // (motion spec §5), and only when it is actually out of view.
  useEffect(() => {
    const targetSpanId = activeSpanId ?? flatSpans.find((s) => s.checkId === selectedCheckId)?.spanId;
    if (!targetSpanId) return;
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-span-id="${CSS.escape(targetSpanId)}"]`);
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [selectedCheckId, activeSpanId, flatSpans, reduce]);

  const [rules, setRules] = useState<CoverageRuleGeometry[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const next: CoverageRuleGeometry[] = [];
    for (const checkId of lanes) {
      const checkLines = lines.filter((l) => l.spans.some((s) => s.checkId === checkId));
      if (checkLines.length === 0) continue;
      const first = lineRefs.current.get(checkLines[0]?.line ?? -1);
      const last = lineRefs.current.get(checkLines.at(-1)?.line ?? -1);
      const band = bandOf.get(checkId);
      if (!first || !last || band === undefined) continue;
      const top = first.getBoundingClientRect().top - containerTop;
      const bottom = last.getBoundingClientRect().bottom - containerTop;
      next.push({ checkId, lane: lanes.indexOf(checkId), top, height: Math.max(bottom - top, 1), band });
    }
    setRules(next);
  }, [lanes, lines, bandOf]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined" || !containerRef.current) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      className="specimen"
      role="group"
      aria-label="Character description with check coverage"
      ref={containerRef}
      onKeyDown={onKeyDown}
      style={{ ["--lane-count" as string]: lanes.length }}
    >
      <CoverageGutter lanes={lanes} rules={rules} selectedCheckId={selectedCheckId} onSelectCheck={onSelectCheck} />
      {lines.map((line) => (
        <SpecimenLine
          key={line.line}
          n={line.line}
          rowRef={(el) => {
            if (el) lineRefs.current.set(line.line, el);
            else lineRefs.current.delete(line.line);
          }}
        >
          {renderedLines.get(line.line)}
        </SpecimenLine>
      ))}
    </div>
  );
}
