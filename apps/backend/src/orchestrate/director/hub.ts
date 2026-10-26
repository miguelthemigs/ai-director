import type { DirectorEvent } from "@ai-director/contract";

export type DirectorEventSink = (event: DirectorEvent) => void;

/**
 * Live delivery of Director events to whoever is watching a run, in memory only. The store's
 * log is the record: a watcher that connects late (or reconnects) replays from the store and
 * uses this only for what happens after it subscribed.
 */
export class DirectorEventHub {
  private readonly sinks = new Map<string, Set<DirectorEventSink>>();

  /** Bound, so it can be handed on as the runner's and the render's `publish`. */
  readonly publish = (event: DirectorEvent): void => {
    for (const sink of this.sinks.get(event.runId) ?? []) {
      try {
        sink(event);
      } catch {
        // A watcher whose socket broke must not reach the runner: its `emit` would read a
        // failed delivery as a failed append. The watcher's own close handler unsubscribes it.
      }
    }
  };

  subscribe(runId: string, sink: DirectorEventSink): () => void {
    let set = this.sinks.get(runId);
    if (!set) {
      set = new Set();
      this.sinks.set(runId, set);
    }
    set.add(sink);
    return () => {
      const current = this.sinks.get(runId);
      if (!current) return;
      current.delete(sink);
      if (current.size === 0) this.sinks.delete(runId);
    };
  }
}
