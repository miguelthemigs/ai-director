import { z } from "zod";

export const CheckGroupSchema = z.enum(["look", "safety", "drawable"]);
export type CheckGroup = z.infer<typeof CheckGroupSchema>;

export const RubricCheckSchema = z.object({
  id: z.string().min(1),
  group: CheckGroupSchema,
  title: z.string().min(1),
  passTest: z.string().min(1),
  bands: z.object({
    "1": z.string().min(1),
    "2": z.string().min(1),
    "3": z.string().min(1),
    "4": z.string().min(1),
    "5": z.string().min(1),
  }),
  source: z.string().min(1),
});
export type RubricCheck = z.infer<typeof RubricCheckSchema>;

export const RubricSchema = z.object({
  version: z.string().min(1),
  frozenOn: z.string().min(1),
  passBand: z.literal(4),
  checks: z.array(RubricCheckSchema).length(9),
});
export type Rubric = z.infer<typeof RubricSchema>;
