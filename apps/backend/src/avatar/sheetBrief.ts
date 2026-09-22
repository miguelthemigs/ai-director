/**
 * MENTIC'S CHARACTER SHEET BRIEF, COPIED VERBATIM.
 *
 * Source: `lib/ugc-lab/generate-actor.ts` (`ACTOR_SHEET_OPENING`, `ACTOR_SHEET_PANELS`,
 * `actorSheetBrief`, `ACTOR_SHEET_ASPECT_RATIO`) and `lib/ugc-lab/realism-tail.ts`
 * (`IMAGE_REALISM_TAIL`, `withRealismTail`), read 2026-09-12. Subject under test, not a
 * component of this product: edit it and this repo stops measuring Mentic.
 *
 * ── Why a sheet and not a portrait ──────────────────────────────────────────────
 * Mentic's avatar used to be a head-and-shoulders portrait. A portrait cannot show a
 * build, a height, trousers or shoes, so the describe step had nothing to write about
 * them and the video render invented a different body and a different outfit every
 * time. On 2026-08-28 it became a split-frame sheet: a facial close-up beside a
 * full-body front and back view, one person, on plain solid grey.
 *
 * That change is directly relevant to four of the nine checks. `age_build` band 4 wants
 * a build stated concretely and `wardrobe` band 4 wants footwear, and neither was
 * visible before the sheet existed.
 *
 * ── ONE tail, not two, and that is the whole judgement ──────────────────────────
 * `IMAGE_CAMERA_TAIL` is deliberately NOT applied here, and Mentic's own comment gives
 * the reason: that tail exists to keep a ROOM legible, a grey studio sheet has no room,
 * and it forbids by name the exact 85mm shallow depth the close-up panel asks for.
 * Applying both would put two contradicting optical instructions in one prompt.
 */

/** For still-image prompts: actor references and first frames. */
export const IMAGE_REALISM_TAIL =
  "Include subtle micro-expressions, stray hairs, and realistic skin pores to ensure the final output looks 100% human, unpolished, and authentic. Focus on realistic textures to ensure the image avoids a synthetic 'plastic' look.";

/**
 * Appends the tail as its own paragraph. An empty prompt stays empty: a failed authoring
 * slot returns "" on purpose, and turning that into a bare realism tail would hide the
 * failure behind something that looks like a real prompt.
 */
export function withRealismTail(prompt: string, tail: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "";
  if (trimmed.includes(tail)) return trimmed;
  return `${trimmed}\n\n${tail}`;
}

export const ACTOR_SHEET_OPENING =
  "Cinematic character reference sheet, split-frame layout, photorealistic.";

export const ACTOR_SHEET_PANELS: readonly string[] = [
  "Left panel, facial close-up: the entire head fully inside the frame including",
  "all the hair, nothing cropped, calm neutral expression, looking straight into",
  "the lens. Shot on 85mm portrait lens, shallow depth of field, soft key light",
  "with gentle fill.",
  "",
  "Right panel, full-body front and back views side by side: the same person",
  "shown twice within this panel. On the left a full-body front view facing the",
  "camera; on the right a full-body back view photographed from directly behind.",
  "In both, they stand straight in a relaxed pose, arms hanging at their sides,",
  "full height in frame head to toe, wearing the same outfit. The front view shows",
  "the face and the front of the garment; the back view shows the back of the head,",
  "hair, shoulders, garment seams and the rear of the trousers and shoes. Both",
  "figures matched in framing, scale and lighting.",
  "",
  "Look: clean studio character sheet, plain solid grey background, the same person",
  "in every view, soft diffused lighting, muted natural colour grade, fine detail,",
  "true-to-life skin tones, vertical divider lines separating each view.",
];

/**
 * The sheet is three panels wide, so it is landscape. Left unset, the image models
 * default to 1:1, which squeezes all three panels into a square. Mentic's comment warns
 * that a ratio outside its lookup table does not throw, it renders SQUARE and nothing
 * reports it, so "16:9" is used rather than any wider-looking string.
 */
export const ACTOR_SHEET_ASPECT_RATIO = "16:9";

/** Wraps one authored identity in the character sheet layout. */
export function actorSheetBrief(basePrompt: string): string {
  return withRealismTail(
    [
      ACTOR_SHEET_OPENING,
      "",
      "The subject, consistent across every panel:",
      basePrompt.trim(),
      "",
      ...ACTOR_SHEET_PANELS,
    ].join("\n"),
    IMAGE_REALISM_TAIL,
  );
}
