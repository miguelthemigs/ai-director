import { LENGTH_TOLERANCE_SECONDS, type CheckOutcome, type Plan } from "@ai-director/contract";
import type { LabBrief } from "../../lab/types.js";
import { DIRECTOR_V1_CHECK_LABELS, buildDirectorPatchSystemPrompt, buildDirectorSystemPrompt } from "./prompt-v1.js";

/**
 * DIRECTOR PROMPT v2 — the architecture lab's Director: v1 with a text-only product.
 *
 * Append-only (CLAUDE.md): v1 is untouched and still serves the Director app.
 *
 * v1 kept the product's description to its kind, because the owner's photo carried the
 * look, and painted the location as a picture. The lab has no photo and no picture, so
 * the product's description may say what a camera sees, and the location line no longer
 * mentions a picture. Those two lines are the only change: v2 is built from v1's text by
 * exact replacement, and throws if a line it replaces is ever not found, so v2 can never
 * drift from v1 silently.
 */
export const DIRECTOR_PROMPT_VERSION_V2 = "v2";

const V1_PRODUCT_LINE_START = "- The product's description says what kind of thing it is";
const V2_PRODUCT_LINE =
  "- The product's description says what kind of thing it is and what a camera sees of it: its shape, materials and colours, from the website text in the request. Never a brand name, logo, lettering or label text: the ad shows no brand, and words on a label are how a label gets rewritten.";
const V1_PICTURE_SENTENCE = " It is painted as a picture with nobody in the frame.";

function replaceOnce(lines: string[], match: (line: string) => boolean, change: (line: string) => string): string[] {
  const index = lines.findIndex(match);
  if (index === -1) throw new Error("director prompt v2: a v1 line it replaces was not found");
  return lines.map((line, i) => (i === index ? change(line) : line));
}

export function buildDirectorSystemPromptV2(): string {
  let lines = buildDirectorSystemPrompt().split("\n");
  lines = replaceOnce(lines, (line) => line.startsWith(V1_PRODUCT_LINE_START), () => V2_PRODUCT_LINE);
  lines = replaceOnce(lines, (line) => line.includes(V1_PICTURE_SENTENCE), (line) => line.replace(V1_PICTURE_SENTENCE, ""));
  return lines.join("\n");
}

export function buildDirectorPatchSystemPromptV2(): string {
  const v1Base = buildDirectorSystemPrompt();
  const v1Patch = buildDirectorPatchSystemPrompt();
  if (!v1Patch.startsWith(v1Base)) throw new Error("director prompt v2: v1's patch prompt no longer starts with v1");
  return buildDirectorSystemPromptV2() + v1Patch.slice(v1Base.length);
}

// The cast and ruled-out sentences are v1's, word for word.
function renderCast(brief: LabBrief): string {
  return brief.avatar !== null
    ? "Cast: the owner picked one of their existing people. Their look is already written and code pastes it in, so the character's description says only who they are in this ad, and no field describes their face, hair, body or clothes."
    : "Cast: a new person will be cast from your character description, so write their look in plain visible facts.";
}

function renderRuledOut(brief: LabBrief): string {
  const terms = brief.mustNotAppear.map((term) => term.trim()).filter((term) => term !== "");
  return terms.length === 0
    ? "Nothing is ruled out."
    : `Must not appear anywhere in the plan, not even to say it is absent: ${terms.map((term) => `"${term}"`).join(", ")}.`;
}

export function renderLabDirectorRequest(brief: LabBrief): string {
  return [
    `The owner's brief: ${brief.brief}`,
    "",
    "The filled brief:",
    `- Product kind: ${brief.productKind}`,
    `- The product, as the website and the owner describe it: ${brief.product}`,
    `- Audience: ${brief.audience}`,
    `- Tone: ${brief.tone}`,
    `- Setting: ${brief.setting}`,
    `- Character: ${brief.character}`,
    "",
    `Length: the owner chose ${brief.seconds} seconds, so the shot counts must add up to between ${brief.seconds - LENGTH_TOLERANCE_SECONDS} and ${brief.seconds + LENGTH_TOLERANCE_SECONDS}.`,
    renderRuledOut(brief),
    renderCast(brief),
  ].join("\n");
}

function renderFailure(failure: CheckOutcome): string {
  const shots = failure.shots.length > 0 ? ` Shots: ${failure.shots.join(", ")}.` : "";
  return `- ${DIRECTOR_V1_CHECK_LABELS[failure.id]} — failed: ${failure.detail ?? "no detail"}.${shots}`;
}

export function renderLabDirectorPatchRequest(args: { brief: LabBrief; plan: Plan; failures: CheckOutcome[] }): string {
  return [
    renderLabDirectorRequest(args.brief),
    "",
    "The plan you wrote:",
    "",
    JSON.stringify(args.plan, null, 2),
    "",
    "Checks in code failed on it:",
    ...args.failures.map(renderFailure),
    "",
    "Return the whole plan with these failures fixed.",
  ].join("\n");
}
