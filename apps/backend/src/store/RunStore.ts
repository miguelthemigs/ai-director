export type RunStatus =
  | "running"
  | "passed"
  | "improved_still_failing"
  | "no_improvement"
  | "failed";

export type RunManifest = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  passes: number;
};

export interface RunStore {
  createRun(manifest: RunManifest): Promise<void>;
  writePass(runId: string, pass: number, kind: "eval" | "repair", payload: unknown): Promise<void>;
  finishRun(runId: string, status: RunStatus, passes: number): Promise<void>;
  getRun(runId: string): Promise<RunManifest>;
  listRuns(): Promise<RunManifest[]>;
}
