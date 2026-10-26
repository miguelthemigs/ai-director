import { z } from "zod";

// The contract's `Plan`, as the model returns it. The kinds and weights are closed
// lists here, so a fourth kind or a "medium" weight cannot parse. Everything else a
// plan must satisfy is code: the shape rules downstream steps depend on are in
// run.ts, and the rules a model can fail and fix (length, handles, timestamps, things
// ruled out) are the plan checks (`orchestrate/director/checks.ts`), which route a
// failure back to the Director instead of failing the run.
export const DirectorPlanSchema = z.object({
  styleLine: z.string(),
  scene: z.string(),
  assets: z.array(
    z.object({
      handle: z.string(),
      kind: z.enum(["product", "location", "character"]),
      description: z.string(),
    }),
  ),
  shots: z.array(
    z.object({
      action: z.string(),
      weight: z.enum(["short", "normal", "long"]),
      sound: z.string(),
    }),
  ),
});
