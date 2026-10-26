import type {
  DirectorEvent,
  DirectorEventBody,
  DirectorNodeId,
  DirectorRunSummary,
  GateAAnswers,
} from "@ai-director/contract";

export interface DirectorRunStore {
  /** Writes the manifest and `run.started` (seq 1); returns the new run id. */
  createRun(brief: string): Promise<string>;
  /** Assigns seq = last + 1; appends are serialized per run. */
  append(runId: string, body: DirectorEventBody): Promise<DirectorEvent>;
  events(runId: string, afterSeq?: number): Promise<DirectorEvent[]>;
  /** Returns `nodes/<node>.<attempt>.json`. */
  writeOutput(
    runId: string,
    node: DirectorNodeId,
    attempt: number,
    payload: unknown,
  ): Promise<string>;
  readOutput<T>(runId: string, ref: string): Promise<T>;
  /** Returns `assets/<name>`. */
  saveAsset(runId: string, name: string, bytes: Buffer): Promise<string>;
  readAsset(runId: string, ref: string): Promise<Buffer>;
  /** Replaced atomically (a reader sees the old answers or the new, never half of either). */
  writeAnswers(runId: string, answers: GateAAnswers): Promise<void>;
  readAnswers(runId: string): Promise<GateAAnswers | null>;
  /** Atomic create-if-absent of `render.<attempt>.claim`. */
  claimRender(runId: string, attempt: number): Promise<"claimed" | "already_claimed">;
  /** Whether `render.<attempt>.claim` exists. Reads only: never takes the claim. */
  hasRenderClaim(runId: string, attempt: number): Promise<boolean>;
  /** Newest first, from each run's folded events. */
  listRuns(): Promise<DirectorRunSummary[]>;
  listIds(): Promise<string[]>;
}
