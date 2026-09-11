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
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

export interface RunStore {
  createRun(manifest: RunManifest): Promise<void>;
  writePass(runId: string, pass: number, kind: "eval" | "repair", payload: unknown): Promise<void>;
  finishRun(runId: string, status: RunStatus, passes: number): Promise<void>;
  getRun(runId: string): Promise<RunManifest>;
  listRuns(): Promise<RunManifest[]>;
}
