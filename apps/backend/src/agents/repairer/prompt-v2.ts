import type { RubricCheck } from "../../rubric/load.js";

/**
 * REPAIRER PROMPT v2 — the same repairer, with the character sheet in front of it.
 *
 * ── The defect this exists to fix ───────────────────────────────────────────────
 * v1 never saw the avatar. `describeImage` is the only step in this repo that is
 * given the sheet; it turns the picture into one sentence and the picture is
 * dropped. Everything after it — Evaluator, Repairer, splice, gate — works on text.
 *
 * So v1 was handed the fragment "wavy brown hair", told that `hair_spec` reaches
 * band 5 with colour and texture and style, and told to "replace with observable
 * facts a video model can draw". It had nothing to observe. The only way to obey
 * was to invent something that reads like an observation, and it did: on run
 * `bee3bcd6` it produced shoulder-length hair on a medium-length head, 5 foot 8 on
 * a 1.78m man, a narrow-shouldered build on an average one, plus a mole, a scar and
 * a ring belonging to nobody. `hair_spec` and `age_build` both went 3 → 5 on that
 * repair and the run terminated `passed`. The full trace is in
 * `docs/repairer-cannot-see.md`.
 *
 * The lesson is not that the model lies. It is that a check demanding specificity,
 * put to a model with no source of specifics, can only be satisfied by fabrication.
 * The fix is the source, not sterner wording.
 *
 * ── What v2 changes, and what it deliberately does not ──────────────────────────
 * The sheet travels with the fragments. Rules 3 and 6 are the whole change: every
 * replacement must name something visible in the image, and a check asking for a
 * detail the image does not show must be LEFT UNSATISFIED rather than filled in.
 *
 * v1's central rule is untouched: the Repairer still sees only failing fragments
 * and never the whole description. That rule was never the problem. Showing it the
 * full description would not have told it how long the hair is either — that fact
 * was never in the text at any point, at any length.
 *
 * ── What the score is expected to do, checked against the rubric ────────────────
 * Not "go down". That was a first guess and the rubric does not support it. Read
 * band 5 of each look check against what a character sheet actually shows:
 *
 *   hair_spec   colour + texture + style + length or parting  — all visible. Band 5.
 *   face_skin   two concrete features + a skin-texture cue    — all visible. Band 5.
 *   wardrobe    every garment, colours, footwear, fit cues     — all visible. Band 5.
 *   age_build   age bracket + build + HEIGHT OR PROPORTION     — proportion is
 *               visible, an absolute height is not. Band 5 stays reachable through
 *               the proportion arm (rule 7), which is why rule 7 names it.
 *   anchor_marker  TWO OR MORE localised markers               — the only check that
 *               can honestly drop, and only when the render shows fewer than two.
 *
 * So the prediction is: unchanged on most checks, truthful where v1 was not, and a
 * possible drop on `anchor_marker` alone. A large fall anywhere else means rule 6 is
 * being read as "say less" rather than "say what you see", and the prompt is wrong.
 *
 * A description that honestly sits at band 3 is still worth more than one at band 5
 * describing hair the person does not have. But honesty is not supposed to cost a
 * band here, and where it does, that is a finding about the rubric.
 */
export const REPAIRER_V2_SHEET_USER_NOTE =
  "The image above is the character reference sheet for this person. Every replacement you write must describe what is in it.";

/**
 * `statedFacts` is the avatar's own brief when there is one (`avatar/statedFacts.ts`):
 * the text the character sheet was rendered from, which is where a real height comes
 * from. Absent for an uploaded sheet, and then rule 7 holds the Repairer to proportion
 * cues, because for an uploaded photo nobody knows the answer.
 */
export function buildRepairerSystemPromptV2(
  checks: RubricCheck[],
  statedFacts?: string | null,
): string {
  const rendered = checks
    .map((check) => `${check.id} - ${check.title}\n  Pass test: ${check.passTest}\n  Band 5: ${check.bands["5"]}`)
    .join("\n\n");

  const facts = statedFacts?.trim()
    ? [
        "Stated facts about this person, from the brief the sheet was rendered from.",
        "These are true of the image even where the image cannot show them, such as height.",
        "Use them as a source alongside the picture; do not contradict them.",
        "",
        statedFacts.trim(),
        "",
      ]
    : [
        "No brief exists for this person: the sheet was uploaded rather than generated.",
        "The picture is your only source, so no height or other absolute measurement is known.",
        "",
      ];

  return [
    "You repair fragments of a character description for a text-to-video model.",
    "You are shown the character reference sheet for the person being described, and only",
    "the fragments that failed a check. You are never shown the whole description.",
    "",
    ...facts,
    "The checks these fragments failed:",
    "",
    rendered,
    "",
    "Rules:",
    "1. Return exactly one replacement per spanId you were given, and never a spanId you were not given.",
    "2. The replacement must read grammatically where the fragment sat, because code splices it back in unchanged.",
    "3. Every fact in a replacement must be VISIBLE IN THE SHEET. Describe what you can see there and nothing else. Do not carry over a detail from the fragment that the sheet contradicts.",
    "4. Replace with observable facts a video model can draw: countable features, named colours, named garments. No mood words, no feelings, no camera or lighting instructions.",
    "5. Never name a real person and never name a brand.",
    "6. The test for a detail is whether you can SEE it, not whether it sounds plausible. Hair colour, texture, length and parting; build and proportion; every garment, its colour, its fit and its condition; moles, scars, freckles, skin texture and jewellery are all things a character sheet shows. Where the sheet shows one, name it exactly and aim for the highest band the check offers. Where the sheet does not show one, LEAVE IT OUT and accept that the check may score low. Withholding a detail you can plainly see is as wrong as inventing one you cannot.",
    "7. Height and any other absolute measurement may be stated ONLY if the stated facts above give it. Copy the figure from there; do not adjust it and do not round it. A photograph does not carry a height, so if the stated facts are absent or silent on it, write a proportion you can see instead -- \"long legs relative to the torso\", \"narrow through the shoulders\", \"broad-framed\" -- and never a number you estimated from the picture.",
    "8. Keep the replacement close in length to the fragment unless the check requires more detail you can actually see.",
    "9. In `rationale`, say where each fact came from: what in the sheet you read it off, or that it was given in the stated facts. If you left part of a check unsatisfied under rule 6, say which part and that neither source supplies it.",
  ].join("\n");
}
