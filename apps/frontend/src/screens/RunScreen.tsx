import { useEffect, useRef, useState } from "react";
import type { CheckId, RunEvent } from "@ai-director/contract";
import type { RunClient } from "../data/RunClient.js";
import { useRunStream } from "../hooks/useRunStream.js";
import { useSelection } from "../hooks/useSelection.js";
import { failingCount, lanesOf } from "../domain/derive.js";
import { CheckPanel } from "../components/CheckPanel.js";
import { DescriptionComposer } from "../components/DescriptionComposer.js";
import { EmptyState } from "../components/EmptyState.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { LiveAnnouncer } from "../components/LiveAnnouncer.js";
import { SectionLabel } from "../components/SectionLabel.js";
import { SpecimenView } from "../components/SpecimenView.js";
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

/**
 * Owns `useRunStream` and `useSelection`; lays out the description and the check panel. The
 * pass rail (`PassStepper`) from design doc §4.1 is not built in this task — see the task report —
 * so this screen currently lays out two columns (field, checks) rather than the mockup's three.
 */
export function RunScreen({ client }: { client: RunClient }): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { run, status, events, error } = useRunStream(client, runId);
  const { selected, select, hoveredSpanId, hoverSpan } = useSelection();

  const [politeMessage, setPoliteMessage] = useState("");
  const [assertiveMessage, setAssertiveMessage] = useState("");
  const processedEventCount = useRef(0);

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
        const stillFailing = failingCount(event.run.passes.at(-1)?.results ?? []);
        setAssertiveMessage(
          event.status === "passed"
            ? "Passed. 9 of 9 checks at band 4 or above."
            : `${event.status === "no_improvement" ? "No improvement" : "Still failing"}. ${stillFailing} checks still below band 4.`,
        );
      }
    }
  }, [events]);

  const hasStarted = runId !== null;
  const lastPass = run?.passes.at(-1) ?? null;
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
      setRunId(newRunId);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="run">
      {/* Visually hidden: the screen's own landmark heading. The visible header row for each
          column below (`SectionLabel`) is what a sighted user actually reads. */}
      <h1 className="sr-only">Run</h1>
      <LiveAnnouncer politeness="polite" message={politeMessage} />
      <LiveAnnouncer politeness="assertive" message={assertiveMessage} />

      <div className="run__field">
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
          <SpecimenView
            description={lastPass?.description ?? ""}
            results={results}
            lanes={lanes}
            selectedCheckId={selected}
            activeSpanId={hoveredSpanId}
            onSelectCheck={select}
            onClearSelection={() => select(null)}
          />
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
