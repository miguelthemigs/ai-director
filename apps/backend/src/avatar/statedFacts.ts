import type { AvatarRecord } from "../store/AvatarStore.js";

/**
 * What is KNOWN about an avatar that its picture cannot show.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────────
 * Repairer v2 can see the character sheet, which fixed it inventing hair length and
 * build. It did not fix height, because height is not in a photograph. A sheet shows
 * that a person has long legs relative to their torso; it cannot show that they are
 * 1.78m. So v2's first draft simply banned the Repairer from stating one.
 *
 * That ban was wrong for the product. The description's only reader is a text-to-video
 * model, and height is a RENDER DIRECTIVE there, not a trivium: it sets how far from
 * the ground the head sits, how the person fills a standing frame, and how they scale
 * against anything else in shot. Dropping it to protect the Repairer from guessing
 * costs the video the one cue that a full-body plate most needs. Owner's call,
 * 16 September 2026.
 *
 * ── Where a real number comes from ──────────────────────────────────────────────
 * From the record, not from the picture and not from the model's imagination. For a
 * GENERATED avatar, `authoredPrompt` is the brief Nano Banana actually rendered from,
 * so every figure in it is the figure the image depicts by construction. On avatar
 * `eaa18108` that brief reads "BUILD: about 1.78m, average build, medium frame".
 *
 * Worth knowing where that 1.78m itself came from: the guided form's
 * `seedDescription` says "average height", and the doctrine call turned that into
 * 1.78m when it expanded the fields into an image brief. So it is a model's choice one
 * step upstream rather than a fact the user typed. It is still the right source, and
 * for a reason that does not depend on who chose it: the sheet was rendered FROM this
 * text, so it describes the picture whatever its provenance. A number the image was
 * conditioned on beats a number inferred from the image afterwards.
 *
 * An UPLOADED sheet has no brief and no known height. It returns null, the Repairer is
 * told nothing, and rule 7 holds it to proportion cues. Saying nothing is correct
 * there: nobody knows how tall that person is.
 *
 * ── The circularity, stated rather than hidden ──────────────────────────────────
 * Handing the Repairer the brief the image was made from makes part of this pipeline
 * circular. The describe step's job is to recover a person from a picture, and a later
 * step that is shown the original spec is no longer being tested on recovery.
 *
 * It is bounded, deliberately. The Repairer sees this only alongside the FAILING
 * fragments it was already given, never the whole description, so the spec can only
 * reach the words a check already rejected. `describeImage` never sees it at all, and
 * the agreement study grades the describe step. What the study measures is untouched.
 * A real avatar product has exactly this brief on hand, so using it is what the product
 * would do.
 */
export function statedFactsFor(record: AvatarRecord): string | null {
  // `authoredPrompt` first: it is the text the image was rendered from, so it is the
  // only field that describes the picture by construction rather than by intention.
  // `seedDescription` is the user's own sentence and is the honest fallback -- it
  // predates the render, so a figure in it is what they asked for rather than what
  // was drawn, which is still better than a guess off the pixels.
  const stated = record.authoredPrompt?.trim() || record.seedDescription?.trim();
  if (!stated) return null;
  return stated;
}
