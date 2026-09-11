import type { RunEvent, RunView, VersionCompare, VersionRow } from "@ai-director/contract";

/**
 * The seam between the three screens and wherever a run's data actually comes from.
 *
 * `FixtureRunClient` (canned, timed data) and the eventual `HttpRunClient` (real SSE) both
 * implement this. Screens are built and reviewed against the fixture; going live in Phase C is a
 * matter of constructing a different implementation of this interface in `main.tsx` — nothing
 * else should need to change. This file holds only the interface and its types, so neither client
 * implementation needs to import the other.
 */
export interface RunClient {
  /** Kick off a new run. Resolves once the server (or fixture) has accepted it. */
  startRun(description: string): Promise<{ runId: string }>;
  /** Fetch a run's current state as a snapshot, e.g. for the Versions screen's history. */
  getRun(runId: string): Promise<RunView>;
  /** List every run this client knows about, most relevant first. */
  listRuns(): Promise<RunView[]>;
  /**
   * Stream events for one run to `sink`, starting after event id `from` (undefined for the
   * beginning). Mirrors `EventSource` + `Last-Event-ID`. Returns an unsubscribe function that
   * stops delivery and releases any pending timer or connection.
   */
  subscribe(runId: string, from: string | undefined, sink: (event: RunEvent) => void): () => void;
  /**
   * Every rubric and prompt version on record, oldest sealed first — the Versions screen's own
   * history. Read-only: sealing a new version is a build-time/backend act, not something a client
   * of this interface does.
   */
  listVersions(): Promise<VersionRow[]>;
  /**
   * The two-version compare: prompt/rubric diff plus the nine per-check deltas. `a` and `b` are
   * `VersionRow.id` values in either order — swapping which one is "before" is the caller's job,
   * not this method's.
   */
  compareVersions(a: string, b: string): Promise<VersionCompare>;
}
