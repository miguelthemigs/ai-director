import { useEffect, useState } from "react";
import type { RunStatus, RunSummary, TerminalStatus } from "@ai-director/contract";
import type { RunClient } from "../data/RunClient.js";
import { SectionLabel } from "./SectionLabel.js";
import { verdictWord } from "./VerdictBanner.js";

/**
 * Every run this server has on disk, so a finished one can be opened again.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 * A run's id lived in one `useState` and nowhere else, and its assembled results lived in
 * one map inside the server process. Between them, any reload — a laptop closing, Chrome
 * discarding the tab, a dev-server restart on a file save — made a finished run's results
 * unreachable, while every pass it produced sat untouched in `data/runs/`. Nothing said
 * they were still there, so a run that had completed looked like a run that had never
 * happened. That is the same silent loss the avatar gallery was built to end, and this is
 * the same answer for runs.
 *
 * The verdict word comes from `verdictWord`, not from a second table written here: a
 * history that could word `improved_still_failing` as a pass would be a success state on a
 * run that did not pass, which the product forbids outright.
 */

export type RunHistoryProps = {
  client: RunClient;
  /** The run currently on screen, so the list can show which one that is. */
  openRunId: string | null;
  onOpen: (runId: string) => void;
};

function isTerminal(status: RunStatus): status is TerminalStatus {
  return status === "passed" || status === "improved_still_failing" || status === "no_improvement";
}

/** What a row says a run ended as. A run that never reached a terminal status is reported
 *  as what it is, never dressed up in one of the three verdict words. */
function statusWord(status: RunStatus): string {
  if (isTerminal(status)) return verdictWord(status);
  return status === "failed" ? "FAILED" : "UNFINISHED";
}

export function RunHistory({ client, openRunId, onOpen }: RunHistoryProps): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .listRuns()
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // An unreachable backend and an empty history are different facts. Reporting the
        // first as the second is exactly the silence this list was built to end.
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <section className="run-history" aria-label="Past runs">
      <div className="run-history__head">
        <SectionLabel>Past runs</SectionLabel>
        <span className="run-history__count tnum">
          {runs === null ? "loading" : runs.length === 1 ? "1 run" : `${runs.length} runs`}
        </span>
      </div>

      {error ? (
        <p className="run-history__error" role="alert">
          Could not load past runs: {error}
        </p>
      ) : null}

      {runs !== null && runs.length === 0 && error === null ? (
        <p className="run-history__empty">
          No runs yet. Every run is written to <code>data/runs/</code> as it happens and
          appears here, so it survives a reload.
        </p>
      ) : null}

      <ul className="run-history__list">
        {(runs ?? []).map((run) => (
          <li key={run.runId}>
            <button
              type="button"
              className="run-history__item"
              data-open={run.runId === openRunId ? "true" : undefined}
              data-passed={run.status === "passed" ? "true" : undefined}
              onClick={() => onOpen(run.runId)}
            >
              <span className="run-history__verdict">{statusWord(run.status)}</span>
              <span className="run-history__meta tnum">
                {new Date(run.startedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                {run.passes === 1 ? "1 pass" : `${run.passes} passes`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
