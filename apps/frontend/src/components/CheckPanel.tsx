import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHECKS_BY_GROUP,
  CHECK_GROUPS,
  CHECK_IDS,
  type CheckId,
  type CheckResultView,
} from "@ai-director/contract";
import { CHECK_TITLES, GROUP_TITLES } from "../domain/labels.js";
import { passingCount } from "../domain/derive.js";
import { CheckGroupHeader } from "./CheckGroupHeader.js";
import { CheckRow } from "./CheckRow.js";
import { SectionLabel } from "./SectionLabel.js";

export type CheckPanelProps = {
  /** Only the checks that have arrived so far — scored or `not_evaluated`. Missing ids render as
   *  the pre-arrival row; all nine ids are always rendered regardless of what has arrived. */
  results: CheckResultView[];
  selectedCheckId: CheckId | null;
  onSelectCheck: (checkId: CheckId | null) => void;
  streaming: boolean;
  activeSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
};

/**
 * The right column. Three groups, nine rows, always all nine. The panel's own header is a count —
 * "n/9 at ≥80" — never an average; each `CheckGroupHeader` beneath it is a label and a count of its
 * own checks and must never carry an aggregate (design doc §5, rule enforced in `CheckGroupHeader`).
 */
export function CheckPanel({
  results,
  selectedCheckId,
  onSelectCheck,
  streaming,
  activeSpanId,
  onSelectSpan,
}: CheckPanelProps): React.JSX.Element {
  const byId = useMemo(() => new Map(results.map((r) => [r.checkId, r])), [results]);
  const revealIndexOf = useRevealIndex(results);

  const [focusedId, setFocusedId] = useState<CheckId>(CHECK_IDS[0]);
  const rowRefs = useRef(new Map<CheckId, HTMLLIElement>());
  // Roving tabindex must move DOM focus when arrow keys move it, but never steal focus on mount —
  // this only turns true once the keyboard path has actually been used.
  const shouldMoveFocus = useRef(false);

  useEffect(() => {
    if (shouldMoveFocus.current) rowRefs.current.get(focusedId)?.focus();
  }, [focusedId]);

  const move = useCallback((next: CheckId | undefined) => {
    if (!next) return;
    shouldMoveFocus.current = true;
    setFocusedId(next);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const index = CHECK_IDS.indexOf(focusedId);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(CHECK_IDS[Math.min(index + 1, CHECK_IDS.length - 1)]);
          break;
        case "ArrowUp":
          event.preventDefault();
          move(CHECK_IDS[Math.max(index - 1, 0)]);
          break;
        case "Home":
          event.preventDefault();
          move(CHECK_IDS[0]);
          break;
        case "End":
          event.preventDefault();
          move(CHECK_IDS[CHECK_IDS.length - 1]);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onSelectCheck(focusedId);
          break;
        case "Escape":
          event.preventDefault();
          onSelectCheck(null);
          break;
        case "f":
        case "F": {
          event.preventDefault();
          const forward = !event.shiftKey;
          const failing = CHECK_IDS.filter((id) => {
            const r = byId.get(id);
            return r?.status === "scored" && !r.passed;
          });
          if (failing.length === 0) break;
          const currentPos = failing.indexOf(focusedId);
          const nextPos = forward
            ? (currentPos + 1 + failing.length) % failing.length
            : (currentPos - 1 + failing.length) % failing.length;
          move(failing[currentPos === -1 ? 0 : nextPos]);
          break;
        }
        // Next / previous fragment of the focused check (design doc §7 "Keyboard, and the check
        // to fragment link"). Cycles `activeSpanId`, not the focused check, so `f`/`Shift+F` and
        // `n`/`p` compose: jump to a failing check, then walk its own quoted fragments.
        case "n":
        case "p": {
          const result = byId.get(focusedId);
          if (result?.status !== "scored" || result.spans.length === 0) break;
          event.preventDefault();
          const spans = result.spans;
          const currentSpanIndex = spans.findIndex((s) => s.spanId === activeSpanId);
          const forward = event.key === "n";
          const nextSpanIndex =
            currentSpanIndex === -1
              ? 0
              : forward
                ? (currentSpanIndex + 1) % spans.length
                : (currentSpanIndex - 1 + spans.length) % spans.length;
          const nextSpan = spans[nextSpanIndex];
          if (nextSpan) onSelectSpan(nextSpan.spanId);
          break;
        }
        default: {
          if (/^[1-9]$/.test(event.key)) {
            event.preventDefault();
            move(CHECK_IDS[Number(event.key) - 1]);
          }
        }
      }
    },
    [focusedId, byId, move, onSelectCheck, activeSpanId, onSelectSpan],
  );

  const total = passingCount(results);

  return (
    <section className="check-panel" aria-label="Checks">
      <div className="check-panel__header">
        <SectionLabel>Checks</SectionLabel>
        <span className="check-panel__summary tnum">{total}/9 at ≥80</span>
      </div>
      <ul
        className="check-panel__list"
        role="listbox"
        aria-label="Checks"
        aria-activedescendant={`check-row-${focusedId}`}
        onKeyDown={onKeyDown}
      >
        {CHECK_GROUPS.map((group) => {
          const ids = CHECKS_BY_GROUP[group];
          const arrivedCount = ids.filter((id) => byId.has(id)).length;
          return (
            <li key={group} className="check-panel__group" role="presentation">
              <CheckGroupHeader
                group={group}
                label={GROUP_TITLES[group]}
                total={ids.length}
                arrivedCount={arrivedCount}
              />
              <ul className="check-panel__rows" role="presentation">
                {ids.map((id) => (
                  <CheckRow
                    key={id}
                    checkId={id}
                    title={CHECK_TITLES[id]}
                    result={byId.get(id) ?? null}
                    revealIndex={revealIndexOf.get(id) ?? 0}
                    selected={selectedCheckId === id}
                    active={focusedId === id}
                    streaming={streaming}
                    activeSpanId={activeSpanId}
                    onSelect={(checkId) => {
                      setFocusedId(checkId);
                      onSelectCheck(checkId);
                    }}
                    onSelectSpan={onSelectSpan}
                    ref={(el) => {
                      if (el) rowRefs.current.set(id, el);
                      else rowRefs.current.delete(id);
                    }}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Position among the rows that arrived since the last render, in rubric order — the "batch index"
 * motion spec §3 requires for the reveal stagger. A row that was already scored keeps index 0
 * (harmless: `CheckRow` only plays the reveal once, when it first goes from unarrived to arrived).
 */
function useRevealIndex(results: CheckResultView[]): Map<CheckId, number> {
  const previouslyArrived = useRef<Set<CheckId>>(new Set());
  return useMemo(() => {
    const newlyArrived: CheckId[] = [];
    const nowArrived = new Set<CheckId>();
    for (const id of CHECK_IDS) {
      const r = results.find((x) => x.checkId === id);
      if (!r) continue;
      nowArrived.add(id);
      if (!previouslyArrived.current.has(id)) newlyArrived.push(id);
    }
    const map = new Map<CheckId, number>();
    newlyArrived.forEach((id, i) => map.set(id, i));
    previouslyArrived.current = nowArrived;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);
}
