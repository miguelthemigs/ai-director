import type { CheckGroup, CheckId, VersionKind } from "@ai-director/contract";

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

/** Versions screen: the KIND column and the prompt-diff title (design doc §4.3, §5). */
export const VERSION_KIND_TITLES: Record<VersionKind, string> = {
  rubric: "Rubric",
  evaluator_prompt: "Evaluator prompt",
  repairer_prompt: "Repairer prompt",
};

/**
 * What produced the text behind one clip of a comparison.
 *
 * The "before" clip is the describe step's own output, which no Repairer touched, so it is
 * labelled as unrepaired whatever its run's version is. Labelling it with the run's version
 * made an unrepaired clip read as a v2 one, and that is exactly how a no-repair vs v2
 * comparison was once mistaken for a v1 vs v2 one (`docs/repairer-v1-vs-v2-results.md` §6.1).
 *
 * An "after" clip whose run recorded no version is v1: every run written before the version
 * was recorded on 16 September 2026 was repaired by v1 (`DEFAULT_REPAIRER_PROMPT_VERSION` in
 * `apps/backend/src/agents/repairer/version.ts`). The label says it is inferred, because it
 * was not recorded on the run itself.
 */
export function clipRepairLabel(side: "before" | "after", version: string | null): string {
  if (side === "before") return "no repair";
  return version ? `repairer ${version}` : "repairer v1 (inferred, not recorded)";
}
