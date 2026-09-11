import type { CheckGroup, CheckId } from "@ai-director/contract";

/**
 * Human titles for the nine checks and three groups, as frozen in the v1 rubric
 * (`apps/backend/src/rubric/v1.json`). The frontend has no runtime access to that file — it lives in
 * a different app — so the titles are copied here as static strings. If the rubric is ever revised,
 * these must be updated to match.
 */
export const CHECK_TITLES: Record<CheckId, string> = {
  age_build: "Age bracket and build",
  face_skin: "Face and skin detail",
  hair_spec: "Hair specified three ways",
  wardrobe: "Wardrobe head to toe",
  anchor_marker: "Identity anchor marker",
  no_real_person: "No real-person anchor",
  no_brand_name: "No brand or franchise name",
  drawable_only: "Only drawable words",
  no_cross_slot: "No cross-slot instructions",
};

export const GROUP_TITLES: Record<CheckGroup, string> = {
  look: "Re-renderable look",
  safety: "Will not be refused",
  drawable: "Only drawable words",
};

export const GROUP_LETTER: Record<CheckGroup, string> = {
  look: "A",
  safety: "B",
  drawable: "C",
};
