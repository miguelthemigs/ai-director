/**
 * The wrapper both clips share, v1.
 *
 * ── APPEND-ONLY ─────────────────────────────────────────────────────────────────────
 * This is a prompt file. `CLAUDE.md`: a change ships as a new version file. Once any
 * comparison row records `shotPromptVersion: "v1"`, this string is frozen, and a revision
 * is `v2.ts` exporting `SHOT_PROMPT_VERSION = "v2"`. Editing it in place would silently
 * change what every earlier row claims to have rendered.
 *
 * ── Why the wrapper is a function and not a template literal at the call site ────────
 * The comparison's whole claim is that the two clips differ in ONE thing. That holds only
 * if every other byte of the two prompts is identical, which is a property of there being
 * one function with one argument. Interpolating the wrapper at two call sites is how the
 * two sides stop being comparable without anyone noticing.
 *
 * ── Why it is this bare ─────────────────────────────────────────────────────────────
 * No location, no lighting, no camera move, no emotion. Those are exactly what the
 * `no_cross_slot` and `drawable_only` checks exist to keep OUT of a character description,
 * and a wrapper that supplied them would be measuring the wrapper. A locked-off medium
 * shot of a person doing almost nothing is also the hardest case for identity: there is
 * no motion, no cut and no scene for a drifting face to hide behind.
 *
 * ── No image, ever ──────────────────────────────────────────────────────────────────
 * The person reaches the model as text and nothing else. Mentic's nine probe calls on
 * 2026-08-25 established that a human likeness in any input image is refused, and
 * `apps/backend/src/describe/prompt.ts` documents the same finding as the reason it
 * exists. Nothing here builds an `input_references` array and nothing should.
 */

export const SHOT_PROMPT_VERSION = "v1";

const WRAPPER_HEAD = [
  "A single locked-off medium shot of one person, facing the camera, plain neutral background.",
  "",
  "The person:",
  "",
].join("\n");

const WRAPPER_TAIL = [
  "",
  "",
  "The person stands still and looks into the lens, with small natural movements only.",
  "The camera does not move. There is no cut and no second shot.",
].join("\n");

/** One description in, one prompt out. The only argument, deliberately. */
export function buildShotPrompt(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    throw new Error("buildShotPrompt: description must not be empty");
  }
  return `${WRAPPER_HEAD}${trimmed}${WRAPPER_TAIL}`;
}
