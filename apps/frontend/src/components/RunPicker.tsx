import type { RunSummary } from "@ai-director/contract";

/**
 * Which graded run supplies the two descriptions, and — the part that matters — WHICH
 * REPAIRER wrote the "after".
 *
 * v1 and v2 are not two builds of the same thing. v1 never saw the avatar and satisfied
 * the rubric by inventing: on run `bee3bcd6` it wrote shoulder-length hair on a
 * medium-length head and 5 foot 8 on a 1.78m man. Rendering a v1 "after" shows a
 * different person, which is a real result about v1 and a useless one about repair. So
 * the version is on the row, not in a tooltip, and a run that predates the record says
 * exactly that rather than being labelled v1 on a guess.
 */

function versionLabel(run: RunSummary): { text: string; tone: "v2" | "v1" | "unknown" } {
  if (run.repairerPromptVersion === "v2") return { text: "repairer v2 · saw the sheet", tone: "v2" };
  if (run.repairerPromptVersion === "v1") return { text: "repairer v1 · blind", tone: "v1" };
  return { text: "repairer version not recorded", tone: "unknown" };
}

export function RunPicker({
  runs,
  avatarId,
  selectedId,
  onSelect,
  disabled,
}: {
  runs: RunSummary[];
  avatarId: string | null;
  selectedId: string | null;
  onSelect: (runId: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  // Runs written since 2026-09-16 record the avatar they graded. Older ones record
  // nothing, so they are shown for ANY avatar and the server refuses the mismatched ones
  // by comparing descriptions — a refusal with a reason beats a picker that quietly hides
  // a run somebody is looking for.
  const mine = avatarId
    ? runs.filter((run) => run.avatarId === undefined || run.avatarId === avatarId)
    : [];

  if (!avatarId) {
    return <p className="compare-empty">Pick an avatar first.</p>;
  }
  if (mine.length === 0) {
    return (
      <p className="compare-empty">
        No graded runs for this avatar yet. Grade and repair it below, and it will appear
        here.
      </p>
    );
  }

  return (
    <ul className="run-picker" role="radiogroup" aria-label="Run">
      {mine.map((run) => {
        const version = versionLabel(run);
        const selected = run.runId === selectedId;
        return (
          <li key={run.runId}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={run.runId}
              className="run-row"
              data-selected={selected || undefined}
              disabled={disabled}
              onClick={() => onSelect(run.runId)}
            >
              <span className="run-row__id">{run.runId.slice(0, 8)}</span>
              <span className="run-row__version" data-tone={version.tone}>
                {version.text}
              </span>
              <span className="run-row__status" data-status={run.status}>
                {run.status.replace(/_/g, " ")}
              </span>
              <span className="run-row__passes tnum">{run.passes} passes</span>
              <span className="run-row__when">{new Date(run.startedAt).toLocaleString()}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
