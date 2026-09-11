export const CHECK_GROUPS = ["look", "safety", "drawable"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

export const CHECKS_BY_GROUP = {
  look: ["age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker"],
  safety: ["no_real_person", "no_brand_name"],
  drawable: ["drawable_only", "no_cross_slot"],
} as const satisfies Record<CheckGroup, readonly string[]>;

export const CHECK_IDS = [
  ...CHECKS_BY_GROUP.look,
  ...CHECKS_BY_GROUP.safety,
  ...CHECKS_BY_GROUP.drawable,
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export type Band = 1 | 2 | 3 | 4 | 5;

/** The percentage a band is displayed as. Derived in code, never produced by a model. */
export type Percent = 20 | 40 | 60 | 80 | 100;

export function groupOf(checkId: CheckId): CheckGroup {
  for (const group of CHECK_GROUPS) {
    if ((CHECKS_BY_GROUP[group] as readonly string[]).includes(checkId)) return group;
  }
  throw new Error(`unknown check id: ${checkId}`);
}
