import { z } from "zod";

// Structural validation only: spanId, newText, and rationale as plain strings.
// `newText` is NOT required to be non-empty here -- a `.min(1)` would fail the
// whole batch's parse over one bad replacement, the same reason the Evaluator's
// quotes rule moved out of its schema in Task 5. An empty `newText` is rejected
// per-item, in code, in run.ts's `repairSpans`, which can drop a single
// replacement without losing the rest of the batch.
export const RepairerOutputSchema = z.object({
  replacements: z.array(
    z.object({
      spanId: z.string(),
      newText: z.string(),
      rationale: z.string(),
    }),
  ),
});

export type RepairerOutput = z.infer<typeof RepairerOutputSchema>;
