import { useState } from "react";
import type { ComparisonView } from "@ai-director/contract";

/**
 * Exactly what went to OpenRouter and exactly what came back, for both sides.
 *
 * ── Why this is on the screen and not in a log ──────────────────────────────────────
 * The comparison's whole claim is "one variable moved". Nobody has to take that on trust:
 * both prompts are here in full, and the shared wrapper is visibly identical because it
 * is the same bytes. If the two clips look different and the prompts differ anywhere but
 * the description, the claim is wrong and this is where that shows.
 *
 * The prompts are the STORED ones, as sent. Rebuilding them for display would show what
 * the wrapper says today rather than what this pair was rendered from.
 *
 * ── The task ids are here because they are the recovery path ────────────────────────
 * OpenRouter has no endpoint that lists tasks by anything else we hold. A task id on
 * screen is the difference between a paid render that can be chased and one that cannot.
 */

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="wire__row">
      <dt>{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

export function WireInspector({
  comparison,
}: {
  comparison: ComparisonView;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  // Proved rather than asserted: strip each side's own description out of its own prompt
  // and what is left must be byte-identical.
  const beforeWrapper = comparison.before.prompt.replace(comparison.before.description, "");
  const afterWrapper = comparison.after.prompt.replace(comparison.after.description, "");
  const wrappersMatch = beforeWrapper === afterWrapper;

  return (
    <section className="wire" data-testid="wire-inspector">
      <button
        type="button"
        className="wire__toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {open ? "Hide" : "Show"} exactly what was sent and received
      </button>

      <p className="wire__verdict" data-match={wrappersMatch || undefined}>
        {wrappersMatch
          ? "Both prompts are identical apart from the description."
          : "WARNING: the two prompts differ outside the description. This pair does not compare one variable."}
      </p>

      {open ? (
        <div className="wire__body">
          {(["before", "after"] as const).map((side) => {
            const render = comparison[side];
            return (
              <article key={side} className="wire__side" data-testid={`wire-${side}`}>
                <h4>{side}</h4>
                <dl className="wire__facts">
                  <Row label="Endpoint" value="POST https://openrouter.ai/api/v1/videos" />
                  <Row label="Model" value={comparison.model} />
                  <Row label="Size" value={comparison.size} />
                  <Row label="Duration" value={`${comparison.seconds}s`} />
                  <Row label="Audio" value="generate_audio: false" />
                  <Row label="Image refs" value="none — text only" />
                  <Row label="Task id" value={render.taskId ?? "not yet submitted"} />
                  <Row label="Submitted" value={render.submittedAt ?? "not yet"} />
                  <Row label="Finished" value={render.finishedAt ?? "not yet"} />
                  <Row label="Status reads" value={String(render.polls)} />
                  <Row label="Description sha256" value={render.descriptionSha256} />
                </dl>
                <h5>The prompt, as sent</h5>
                <pre className="wire__prompt">{render.prompt}</pre>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
