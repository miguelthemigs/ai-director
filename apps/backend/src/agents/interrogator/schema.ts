import { z } from "zod";
import { QUESTION_TOPICS } from "../../lab/types.js";

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

// The lab's Interrogator v2 (`prompt-v2.ts`): two calls, *ask* then *fill*. Structural
// validation only; the rules (at most 6 questions, one topic each, a length Seedance can
// render, an avatar that exists) are code in `runV2.ts`.
export const InterrogatorQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      topic: z.enum(QUESTION_TOPICS),
      question: z.string(),
      ifYouDecide: z.string(),
    }),
  ),
});

export const InterrogatorFillSchema = z.object({
  productKind: z.string(),
  product: z.string(),
  audience: z.string(),
  tone: z.string(),
  setting: z.string(),
  character: z.string(),
  seconds: z.number().int(),
  mustNotAppear: z.array(z.string()),
  avatarId: z.string().nullable(),
});
