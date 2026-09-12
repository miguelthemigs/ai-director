import { useEffect, useRef, useState } from "react";
import {
  isScoredCheck,
  TERMINAL_STATUSES,
  type CheckId,
  type PassView,
  type RunEvent,
  type RunView,
  type TerminalStatus,
} from "@ai-director/contract";
import type { RunClient } from "../data/RunClient.js";
import type { RunStatus } from "../hooks/useRunStream.js";
import { useSelection } from "../hooks/useSelection.js";
import { failingCount, lanesOf, lineOfSpan, meanPercent } from "../domain/derive.js";
import { CheckPanel } from "../components/CheckPanel.js";
import { DescriptionComposer } from "../components/DescriptionComposer.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { FragmentDiff } from "../components/FragmentDiff.js";
import { LiveAnnouncer } from "../components/LiveAnnouncer.js";
import { PassStepper } from "../components/PassStepper.js";
import { SectionLabel } from "../components/SectionLabel.js";
import { SpecimenView } from "../components/SpecimenView.js";
import {
  verdictNumeral,
  verdictNumeralLabel,
  verdictSecondLine,
  verdictWord,
  VerdictBanner,
} from "../components/VerdictBanner.js";
import "../styles/run-screen.css";

const MAX_CHARS = 2000;

function humanCheckId(checkId: CheckId): string {
  return checkId.replaceAll("_", " ");
}

/** Builds the one polite announcement for a `pass.completed` event, in the exact shape spec §7
 *  gives as its example: "Pass 2 evaluated. 6 of 9 checks at band 4 or above. 3 checks failing:
 *  hair spec, wardrobe, no brand name." */
function passCompletedAnnouncement(event: Extract<RunEvent, { name: "pass.completed" }>): string {
  const failing = event.failing as CheckId[];
  const passing = 9 - failing.length;
  const names = failing.map(humanCheckId).join(", ");
  const tail = failing.length > 0 ? ` ${failing.length} checks failing: ${names}.` : "";
  return `Pass ${event.pass} evaluated. ${passing} of 9 checks at band 4 or above.${tail}`;
}

function isTerminalStatus(status: RunStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Builds a `spanId -> source line` lookup for one pass, from that pass's own scored spans. Used
 *  only to give `FragmentDiff` a line number; a span that cannot be found is simply omitted. */
function lineLookup(pass: PassView): (spanId: string) => number | undefined {
  const byId = new Map<string, number>();
  for (const result of pass.results) {
    if (!isScoredCheck(result)) continue;
    for (const span of result.spans) byId.set(span.spanId, lineOfSpan(pass.description, span.start));
  }
  return (spanId: string) => byId.get(spanId);
}

/** The assertive terminal-state announcement, built from the exact same §6.2 strings
 *  `VerdictBanner` renders — never a second wording for the same event (design doc §7 "Live
 *  announcements while a run streams"). */
function terminalAnnouncement(
  status: TerminalStatus,
  failing: number,
  passesUsed: number,
  meanBefore: number,
  meanAfter: number,
): string {
  const numeral = verdictNumeral(status, failing);
  const label = verdictNumeralLabel(status);
  const secondLine = verdictSecondLine(status, passesUsed, meanBefore, meanAfter);
  return `${verdictWord(status)}. ${numeral} ${label}. ${secondLine}`;
}

export type RunScreenProps = {
  client: RunClient;
  run: RunView | null;
  status: RunStatus;
  events: RunEvent[];
  error: string | null;
  /** Called once `client.startRun` resolves; the parent owns the run id and its `useRunStream`
   *  subscription (lifted to `App` — see the task report — so the Architecture screen can share
   *  the same stream rather than opening a second one). */
  onRunStarted: (runId: string) => void;
};

/**
 * Lays out the pass rail, the description and the check panel, and owns `useSelection` plus the
 * viewed-pass state the pass rail and fragment diff read from. `useRunStream` itself now lives in
 * `App` (see the task report for Task 14) so `TopBar` and `ScreenTabs` can read the same run.
 */
export function RunScreen({ client, run, status, events, error, onRunStarted }: RunScreenProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { selected, select, hoveredSpanId, hoverSpan } = useSelection();

  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");
  const processedEventCount = useRef(0);

  const passes = run?.passes ?? [];
  const terminal = isTerminalStatus(status) ? status : null;

  // The pass the rail and the diff show. `null` means "follow the latest pass as it streams in";
  // once the user clicks an older step, that choice sticks even as later passes land.
  const [manualPass, setManualPass] = useState<number | null>(null);
  const latestPassNumber = Math.max(passes.length, 1);
  const viewedPassNumber = manualPass ?? latestPassNumber;
  const viewedPass = passes.find((p) => p.pass === viewedPassNumber) ?? null;

  useEffect(() => {
    const newEvents = events.slice(processedEventCount.current);
    processedEventCount.current = events.length;
    for (const event of newEvents) {
      if (event.name === "pass.started") {
        setPoliteMessage(`Pass ${event.pass} started.`);
      } else if (event.name === "pass.completed") {
        setPoliteMessage(passCompletedAnnouncement(event));
      } else if (event.name === "repairer.completed") {
        setPoliteMessage(`Repair applied to ${event.replacements.length} fragments.`);
      } else if (event.name === "run.failed") {
        setAssertiveMessage(`Run failed at step ${event.id}. ${event.error}`);
      } else if (event.name === "run.completed") {
        const finished = event.run;
        const failing = failingCount(finished.passes.at(-1)?.results ?? []);
        const passesUsed = finished.passes.length;
        const meanBefore = meanPercent(finished.passes[0]?.results ?? []);
        const meanAfter = meanPercent(finished.passes.at(-1)?.results ?? []);
        setAssertiveMessage(
          isTerminalStatus(event.status)
            ? terminalAnnouncement(event.status, failing, passesUsed, meanBefore, meanAfter)
            : `Run failed. ${failing} checks still below band 4.`,
        );
      }
    }
  }, [events]);

  const hasStarted = status !== "idle";
  const lastPass = passes.at(-1) ?? null;
  const results = lastPass?.results ?? [];
  const lanes = lanesOf(results);

  const selectionAnnouncedRef = useRef<CheckId | null>(null);
  useEffect(() => {
    if (selected === null || selected === selectionAnnouncedRef.current) {
      selectionAnnouncedRef.current = selected;
      return;
    }
    selectionAnnouncedRef.current = selected;
    const result = results.find((r) => r.checkId === selected);
    if (result?.status === "scored") {
      setPoliteMessage(
        `${humanCheckId(selected)}, band ${result.band}, ${result.percent} percent, ${result.spans.length} fragments.`,
      );
    } else {
      setPoliteMessage(`${humanCheckId(selected)} selected.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { runId: newRunId } = await client.startRun(draft);
      onRunStarted(newRunId);
    } finally {
      setSubmitting(false);
    }
  }

  const failing = failingCount(results);
  const passesUsed = passes.length;
  const meanBefore = meanPercent(passes[0]?.results ?? []);
  const meanAfter = meanPercent(lastPass?.results ?? []);

  // Motion spec §12: `no_improvement` suppresses the fragment-diff sequence entirely — nothing
  // changed the outcome, so nothing is diffed, on any pass, once the run has landed there.
  const suppressDiff = status === "no_improvement";

  return (
    <div className="run">
      {/* Visually hidden: the screen's own landmark heading. The visible header row for each
          column below (`SectionLabel`) is what a sighted user actually reads. */}
      <h1 className="sr-only">Run</h1>
      <LiveAnnouncer politeness="polite" message={politeMessage} />
      <LiveAnnouncer politeness="assertive" message={assertiveMessage} />

      <div className="run__rail">
        <PassStepper
          passes={passes.map((p) => ({ pass: p.pass, changedCount: p.replacements.length }))}
          selected={viewedPassNumber}
          onSelect={setManualPass}
          terminal={terminal}
          streaming={status === "streaming"}
          cueId={events.at(-1)?.id}
        />
      </div>

      <div className="run__field">
        {/*
          The verdict does NOT sit at the foot of the pass rail, which is where the design doc's
          FIRST VIEWPORT line puts it. The rail is `--w-rail`, 88px, and the verdict word is
          `--fs-verdict`, 28px: `STILL FAILING` is thirteen characters and needs roughly 220px, so
          in the rail it rendered clipped on both edges and the mandatory second line was cut to
          "asses used · me". Every binding requirement in §6.2 is about the banner's CONTENT and
          TREATMENT — the word, the numeral, the second line, the tokens and words forbidden — and
          none of them survives being illegible. It moves to the head of the description column,
          which is the widest column on the screen and the first thing read, and §6.2's table is
          rendered unchanged.
        */}
        {terminal ? (
          <VerdictBanner
            status={terminal}
            failingCount={failing}
            passesUsed={passesUsed}
            meanBefore={meanBefore}
            meanAfter={meanAfter}
          />
        ) : null}
        <div className="run__field-header">
          <SectionLabel>Description</SectionLabel>
          {hasStarted ? (
            <span className="run__field-meta tnum">
              read-only · {(lastPass?.description ?? "").length} char
            </span>
          ) : null}
        </div>

        {status === "failed" ? (
          <ErrorPanel
            title="Run failed"
            detail={error ?? "Unknown error."}
            canResume={false}
          />
        ) : null}

        {!hasStarted ? (
          <>
            <EmptyState
              title="Paste a description to begin"
              body="Nine checks, three groups, up to three repair passes. Nothing here spends a render credit."
            />
            <DescriptionComposer
              value={draft}
              onChange={setDraft}
              onSubmit={handleSubmit}
              disabled={submitting}
              maxChars={MAX_CHARS}
            />
          </>
        ) : (
          <>
            <SpecimenView
              description={lastPass?.description ?? ""}
              results={results}
              lanes={lanes}
              selectedCheckId={selected}
              activeSpanId={hoveredSpanId}
              onSelectCheck={select}
              onClearSelection={() => select(null)}
            />

            {viewedPass && !suppressDiff ? (
              <div className="run__diff">
                <SectionLabel as="h3">
                  Pass {viewedPass.pass} · {viewedPass.replacements.length} fragments changed
                </SectionLabel>
                <FragmentDiff
                  pass={viewedPass.pass}
                  replacements={viewedPass.replacements}
                  lineOf={lineLookup(viewedPass)}
                  onSelectSpan={hoverSpan}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <CheckPanel
        results={results}
        selectedCheckId={selected}
        onSelectCheck={select}
        streaming={status === "streaming"}
        activeSpanId={hoveredSpanId}
        onSelectSpan={hoverSpan}
      />
    </div>
  );
}
