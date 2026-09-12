/**
 * MENTIC'S OWN DESCRIBE PROMPT, COPIED VERBATIM.
 *
 * Source: `lib/video-lab/describe-actor.ts` in the Mentic repo, constant
 * `DESCRIBE_ACTOR_SYSTEM`, read 2026-09-12. Not adapted, not improved, not
 * reformatted. This string is the SUBJECT UNDER TEST, not a component of this
 * product, and the moment it is edited this repo stops measuring Mentic and starts
 * measuring a prompt of its own.
 *
 * ── Why this file exists at all ─────────────────────────────────────────────────
 * A character description reaches an AI video model as words and only as words:
 * `ACTOR_IMAGE_ENABLED` is false in Mentic's `lib/video-lab/render-ugc.ts` because
 * seedance2 refuses a human likeness in any input image. So the avatar's rendered
 * character sheet is never sent anywhere. Its only reader is this prompt, whose
 * output is persisted to `UgcActor.description` and spliced into every render
 * prompt for that actor from then on.
 *
 * That makes this prompt the single point where a person becomes text, and it is
 * the thing the nine checks are actually grading. Grading a description typed by
 * hand into a textarea measures the typist. Grading THIS prompt's output, over the
 * real sheet Mentic rendered, measures Mentic.
 *
 * ── The conflict this repo was built to measure ─────────────────────────────────
 * Read the last rule below: one sentence, under 400 characters. Then read the
 * rubric's band 4 rows. `age_build` wants an age bracket and a build. `hair_spec`
 * wants colour and texture and style. `wardrobe` wants every visible garment with
 * colours including footwear. `face_skin` wants two concrete features.
 * `anchor_marker` wants a localised reusable marker. Those five do not fit in 400
 * characters together, so something is dropped on every call, and which thing gets
 * dropped is not stable between calls.
 *
 * That is a hypothesis with a mechanism, not a verdict. It is what the agreement
 * study is for.
 */
export const MENTIC_DESCRIBE_ACTOR_SYSTEM = [
  "You write one sentence describing how a person LOOKS, for use inside a video",
  "generation prompt.",
  "",
  "The image is one of two things. It may be a character reference sheet: one person",
  "shown several times in one frame, a facial close-up beside a full-body front view",
  "and a full-body back view, on a plain studio background. Every panel is the same",
  "person, so describe one person, not several. Or it may be an ordinary photograph,",
  "often head and shoulders only.",
  "",
  "Rules:",
  "- Physical appearance only: apparent age range, hair, face, facial hair, skin tone,",
  "  anything visible like glasses or tattoos.",
  "- Build, and approximate height, whenever the body is visible.",
  "- The complete outfit head to toe whenever it is visible: top, bottoms, footwear and",
  "  any jewelry.",
  "- Never invent what the image does not show. If you only see the head and shoulders,",
  "  describe only those and say nothing about height, build or shoes.",
  "- Describe the person, never describe the sheet: no panels, no divider lines, no grey",
  "  background, no studio, no mention of views or angles.",
  "- Never a name, never an identity, never a guess at who they are, never a judgement.",
  "- One sentence, under 400 characters, no preamble, no quotes, no list.",
  "- Write it as a noun phrase that can start a sentence, e.g.",
  '  "A man in his late twenties, lean and about 1.80m, with short dark hair and stubble,',
  '  in a plain grey t-shirt, black jeans and white trainers".',
].join("\n");

/** The user turn Mentic sends alongside the image. Verbatim, same reason as above. */
export const MENTIC_DESCRIBE_ACTOR_USER = "Describe how this person looks.";

/**
 * Mentic's default describe model (`MENTIC_ACTOR_DESCRIBE_MODEL ?? "claude-sonnet-5"`).
 *
 * Deliberately NOT `claude-opus-5`, which CLAUDE.md fixes for this repo's own two
 * agents. The Evaluator and the Repairer are ours and run on Opus. This call is not
 * ours: it is a reproduction of a call Mentic makes, and reproducing it on a
 * different model would measure a describe step that does not exist in production.
 */
export const MENTIC_DESCRIBE_MODEL = "claude-sonnet-5";

/**
 * Mentic's storage cap, raised 400 -> 900 on 2026-08-28 after a live description was
 * cut mid-word ("cream roller bli"). Note that the PROMPT above still asks for 400:
 * the gap between what is asked for and what is stored is Mentic's, and it is
 * preserved here rather than reconciled.
 */
export const MENTIC_DESCRIBE_MAX_CHARS = 900;
