import { z } from "zod";

// Structural validation only: id, a band in 1-5, a reason, and a quotes array that
// may be empty. The rule that any band below 4 must carry non-empty quotes is NOT
// enforced here — a `.refine()` would fail the whole group's parse on one bad check,
// and zodOutputFormat() typically drops refinements when building the JSON Schema
// handed to the model, so it wouldn't structurally constrain the model's output
// anyway. That rule is enforced per check, in code, in Task 6's `evaluateGroup`,
// which can degrade a single check without losing the rest of the group.
export const EvaluatorCheckResultSchema = z.object({
  checkId: z.string(),
  band: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  reason: z.string(),
  quotes: z.array(z.string()),
});

export const EvaluatorGroupOutputSchema = z.object({
  results: z.array(EvaluatorCheckResultSchema),
});

export type EvaluatorCheckResult = z.infer<typeof EvaluatorCheckResultSchema>;
export type EvaluatorGroupOutput = z.infer<typeof EvaluatorGroupOutputSchema>;
