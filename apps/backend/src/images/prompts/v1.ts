/**
 * Image briefs, v1. Append-only: a change ships as v2.ts.
 * `productShotBrief` adapts Mentic's `productSheetBrief` (`lib/ugc-lab/generate-product-sheet.ts`)
 * from two views to ONE.
 */
export const IMAGE_PROMPT_VERSION = "v1";

/** States the kind only, on one line; every other line is fixed text. */
export function productShotBrief(productKind: string): string {
  const kind = productKind.trim();
  return [
    "Product reference photograph, one view of one product, photorealistic product photography.",
    "",
    "The first reference image is the product. Reproduce it exactly as photographed:",
    "same shape, same proportions, same finish, same materials, and the same label,",
    "lettering and markings in the same places. Do not redesign it, do not restyle it,",
    "and do not add anything that is not already in the reference image.",
    "",
    `The subject is: ${kind}`,
    "",
    "Straight-on three-quarter view: the product turned about 45 degrees so its front and",
    "one side are both visible, the whole object inside the frame, nothing cropped,",
    "standing or resting the way it is meant to sit.",
    "",
    "Look: plain seamless neutral ground, soft even light with gentle fill, no harsh shadows.",
    "Nothing else in the frame: no hands, no people, no props, no packaging that was not in",
    "the reference, no added text, callouts, labels, arrows or watermark. The product sharp",
    "front to back.",
  ].join("\n");
}

export function locationPlateBrief(description: string, styleLine: string): string {
  return [
    "Location plate, photorealistic, vertical frame.",
    "",
    `The place: ${description.trim()}`,
    "",
    "Shot from a three-quarter angle with depth, so a camera can move through the space: foreground,",
    "middle ground and background all readable.",
    "",
    "The place is empty, nobody in the frame: no people, no figures, no reflections of people,",
    "no added text, signage lettering or watermark.",
    "",
    `Light and palette: ${styleLine.trim()}`,
  ].join("\n");
}
