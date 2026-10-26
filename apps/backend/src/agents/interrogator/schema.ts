import { z } from "zod";

// Everything in `FilledBrief` except `brief`, which code carries from the caller
// verbatim (run.ts): a model that echoes the brief can only ever get it wrong.
//
// Structural validation only, the same split the Evaluator and Repairer use: a blank
// field or a length Seedance cannot render is handled in code, in run.ts, where the
// rule can be stated and tested on its own.
export const InterrogatorOutputSchema = z.object({
  productKind: z.string(),
  audience: z.string(),
  tone: z.string(),
  setting: z.string(),
  character: z.string(),
  suggestedSeconds: z.number().int().nullable(),
});

export type InterrogatorOutput = z.infer<typeof InterrogatorOutputSchema>;
