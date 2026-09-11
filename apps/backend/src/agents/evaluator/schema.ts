import { z } from "zod";

export const EvaluatorCheckResultSchema = z
  .object({
    checkId: z.string(),
    band: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    reason: z.string(),
    quotes: z.array(z.string()),
  })
  .refine((result) => result.band >= 4 || result.quotes.length > 0, {
    message: "quotes must be non-empty for any band below 4",
    path: ["quotes"],
  });

export const EvaluatorGroupOutputSchema = z.object({
  results: z.array(EvaluatorCheckResultSchema),
});

export type EvaluatorCheckResult = z.infer<typeof EvaluatorCheckResultSchema>;
export type EvaluatorGroupOutput = z.infer<typeof EvaluatorGroupOutputSchema>;
