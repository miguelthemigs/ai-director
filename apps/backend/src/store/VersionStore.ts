import { z } from "zod";
import type { VersionCompare, VersionRow } from "@ai-director/contract";

const VersionKindSchema = z.enum(["rubric", "evaluator_prompt", "repairer_prompt"]);

const PercentSchema = z.union([
  z.literal(20),
  z.literal(40),
  z.literal(60),
  z.literal(80),
  z.literal(100),
]);

// Spelled out rather than built from CHECK_IDS: nine fixed keys, and writing
// them out lets TypeScript check the schema's inferred shape against
// `Record<CheckId, Percent>` structurally, with no cast.
const ProfileSchema = z
  .object({
    age_build: PercentSchema,
    face_skin: PercentSchema,
    hair_spec: PercentSchema,
    wardrobe: PercentSchema,
    anchor_marker: PercentSchema,
    no_real_person: PercentSchema,
    no_brand_name: PercentSchema,
    drawable_only: PercentSchema,
    no_cross_slot: PercentSchema,
  })
  .strict();

const PerCheckKappaSchema = z
  .object({
    age_build: z.number(),
    face_skin: z.number(),
    hair_spec: z.number(),
    wardrobe: z.number(),
    anchor_marker: z.number(),
    no_real_person: z.number(),
    no_brand_name: z.number(),
    drawable_only: z.number(),
    no_cross_slot: z.number(),
  })
  .strict();

export const VersionRowSchema = z.object({
  id: z.string().min(1),
  kind: VersionKindSchema,
  version: z.string().min(1),
  sealedAt: z.string().min(1),
  // Required by spec §7: a version row is not a real version row without a
  // stated reason it changed. Never optional, never defaulted to "".
  why: z.string().min(1, "why is required and must not be empty"),
  meanPercent: z.number().nullable(),
  deltaPercent: z.number().nullable(),
  profile: ProfileSchema.nullable(),
  // Null until the agreement study has run (Task 23). Never invent a number
  // here -- PRODUCT.md forbids fabricating an agreement figure no study
  // produced.
  kappa: z.number().nullable(),
  perCheckKappa: PerCheckKappaSchema.nullable(),
  goldSetSize: z.number().int().nonnegative().nullable(),
});

export const VersionsFileSchema = z.object({
  versions: z.array(VersionRowSchema),
});

export interface VersionStore {
  list(): Promise<VersionRow[]>;
  get(id: string): Promise<VersionRow>;
  compare(a: string, b: string): Promise<VersionCompare>;
}
