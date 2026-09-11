import { z } from "zod";

export const RepairerOutputSchema = z.object({
  replacements: z.array(
    z.object({
      spanId: z.string(),
      newText: z.string().min(1),
      rationale: z.string(),
    }),
  ),
});

export type RepairerOutput = z.infer<typeof RepairerOutputSchema>;
