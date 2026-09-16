import type { RunEvent } from "@ai-director/contract";

/**
 * Every wire event of a grading run, in order, as it lands.
 *
 * ── Why the raw feed and not a tidy summary ─────────────────────────────────────────
 * The thing this screen is testing is a repair, and the repair is where the last defect
 * lived: v1 satisfied `hair_spec` by inventing a hair length nobody could see. A progress
 * bar would have shown that as a smooth green fill. What makes a fabricated repair
 * catchable is seeing the fragment go in and the replacement come out, at the moment it
 * happens, with the check that demanded it named.
 *
 * So this renders the events the server actually sent, including the ids, rather than a
 * narration of them. Nine event names exist (spec §6) and every one of them is shown.
 *
 * ── No spinner ──────────────────────────────────────────────────────────────────────
 * Lines appear when events arrive and at no other time. An empty feed means nothing has
 * happened yet, which is information; a spinner would mean the same thing whether the run
 * was working or wedged.
 */

function describe(event: RunEvent): { label: string; detail: string } {
  switch (event.name) {
    case "run.started":
      return { label: "run started", detail: `rubric ${event.rubricVersion} · ${event.model}` };
    case "pass.started":
      return { label: `pass ${event.pass} started`, detail: `${event.description.length} chars` };
    case "evaluator.group.started":
      return { label: `evaluating ${event.group}`, detail: "three groups run concurrently" };
    case "evaluator.group.completed": {
      // A check that was never scored says so. Folding it in as a band would make a group
      // call that failed look like one that ran, which is the class of lie this app spends
      // most of its effort refusing.
      const bands = event.results
        .map((r) => (r.status === "scored" ? `${r.checkId} band ${r.band}` : `${r.checkId} not scored`))
        .join(", ");
      return { label: `${event.group} scored`, detail: bands };
    }
    case "repairer.started":
      return {
        label: "repairer started",
        detail: `${event.spanIds.length} failing fragment${event.spanIds.length === 1 ? "" : "s"}: ${event.spanIds.join(", ")}`,
      };
    case "repairer.completed":
      return {
        label: "repairer returned",
        detail:
          event.replacements
            .map((r) => `${r.checkId}: "${r.oldText}" -> "${r.newText}"`)
            .join(" · ") || "nothing applied",
      };
    case "pass.completed":
      return {
        label: `pass ${event.pass} complete`,
        detail: `${event.failing.length} still failing`,
      };
    case "run.completed":
      return { label: "run complete", detail: event.status };
    case "run.failed":
      return { label: "run failed", detail: event.error };
    default:
      return { label: (event as { name: string }).name, detail: "" };
  }
}

export function RunEventFeed({ events }: { events: RunEvent[] }): React.JSX.Element {
  if (events.length === 0) {
    return <p className="compare-empty">Nothing yet. Every step will appear here as it happens.</p>;
  }

  return (
    <ol className="event-feed" data-testid="run-event-feed">
      {events.map((event) => {
        const { label, detail } = describe(event);
        return (
          <li key={event.id} className="event-feed__row" data-name={event.name}>
            <span className="event-feed__id tnum">{event.id}</span>
            <span className="event-feed__label">{label}</span>
            {detail ? <span className="event-feed__detail">{detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
