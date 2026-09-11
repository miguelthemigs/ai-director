import { parseEventId, type RunEvent } from "@ai-director/contract";

export type EventSink = (event: RunEvent) => void;

/** True when `id` sorts strictly after `cursor` under `<pass>-<step>` order. */
function isAfter(id: string, cursor: string): boolean {
  const a = parseEventId(id);
  const b = parseEventId(cursor);
  return a.pass !== b.pass ? a.pass > b.pass : a.step > b.step;
}

/**
 * Per-run pub/sub with replay, so a browser that subscribes late -- or
 * reconnects mid-run with `Last-Event-ID` -- can never end up with a
 * permanently incomplete set of checks. History is kept for the life of the
 * process: v1 is single-user and a run is at most a few dozen events, so
 * nothing is ever evicted. The cost is that a long-lived process accumulates
 * one array and one subscriber set per run forever; acceptable for v1, but
 * worth knowing if this process ever runs unattended for a long time or
 * serves many users.
 */
export class RunEventBus {
  private readonly histories = new Map<string, RunEvent[]>();
  private readonly subscribers = new Map<string, Set<EventSink>>();

  /**
   * Appends to this run's history and fans out to every live subscriber.
   * Each sink runs inside its own try/catch: a subscriber that throws (a
   * client that disconnected badly, a bad handler) must not stall the run or
   * prevent the other subscribers from seeing the event.
   */
  publish(runId: string, event: RunEvent): void {
    const history = this.histories.get(runId) ?? [];
    history.push(event);
    this.histories.set(runId, history);

    for (const sink of this.subscribers.get(runId) ?? []) {
      try {
        sink(event);
      } catch {
        // A throwing subscriber is a broken client, not a reason to stop
        // delivering to the others or to abort the run that is publishing.
      }
    }
  }

  /**
   * Replays this run's history to `sink` -- all of it when `from` is
   * undefined, or only what comes strictly after `from` (per `parseEventId`,
   * not array position) when resuming -- then registers `sink` for future
   * events. Returns a function that unsubscribes it.
   */
  subscribe(runId: string, from: string | undefined, sink: EventSink): () => void {
    const history = this.histories.get(runId) ?? [];
    const replay = from === undefined ? history : history.filter((event) => isAfter(event.id, from));
    for (const event of replay) {
      try {
        sink(event);
      } catch {
        // Same as publish: a throwing sink during replay must not prevent
        // the subscription itself from being registered.
      }
    }

    let sinks = this.subscribers.get(runId);
    if (!sinks) {
      sinks = new Set();
      this.subscribers.set(runId, sinks);
    }
    sinks.add(sink);

    return () => {
      this.subscribers.get(runId)?.delete(sink);
    };
  }

  /** This run's full history, in publish order. Empty for an unknown run. */
  history(runId: string): RunEvent[] {
    return this.histories.get(runId) ?? [];
  }
}
