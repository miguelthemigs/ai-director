import { z } from "zod";

export const RunStatusSchema = z.enum([
  "running",
  "passed",
  "improved_still_failing",
  "no_improvement",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunManifestSchema = z.object({
  runId: z.string(),
  rubricVersion: z.string(),
  model: z.string(),
  status: RunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  passes: z.number(),
  /**
   * Which Repairer prompt repaired this run — "v1" blind, "v2" with the character
   * sheet in front of it (`agents/repairer/version.ts`).
   *
   * Optional because every run written before 16 September 2026 predates the field,
   * and a required key would make those manifests fail to parse. Absent reads as
   * "v1" via `DEFAULT_REPAIRER_PROMPT_VERSION`, which is a fact about those runs
   * rather than a default standing in for one: v2 did not exist when they ran.
   *
   * It is recorded at all because v1 and v2 produce different descriptions from the
   * same avatar by design, and the comparison screen renders both. A clip labelled
   * only "after" would be unreadable evidence.
   */
  repairerPromptVersion: z.string().optional(),
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

/**
 * One pass as it sits on disk: the evaluation always, the repair only when one was
 * attempted (the final pass never calls the Repairer, so it has no repair file).
 *
 * Deliberately `unknown` payloads. This store's job is to hand back what it was given,
 * byte for byte; deciding what a pass payload means belongs to the presenter that rebuilds
 * a `RunView` from it, not to the thing that reads the file.
 */
export type StoredPass = {
  pass: number;
  evaluation: unknown;
  repair?: unknown;
};

export interface RunStore {
  createRun(manifest: RunManifest): Promise<void>;
  writePass(runId: string, pass: number, kind: "eval" | "repair", payload: unknown): Promise<void>;
  finishRun(runId: string, status: RunStatus, passes: number): Promise<void>;
  getRun(runId: string): Promise<RunManifest>;
  listRuns(): Promise<RunManifest[]>;
  /**
   * Every pass this run wrote, in pass order.
   *
   * The counterpart `writePass` never had. Without it a finished run's results existed on
   * disk but were unreachable: the only assembled `RunView` lived in the server's
   * in-memory cache, so a process restart lost every result the run had produced. Returns
   * `[]` for a run that wrote no passes, which is a real state (a run that failed before
   * its first pass completed), not an error.
   */
  readPasses(runId: string): Promise<StoredPass[]>;
}
