import type { CinematographerPrompts } from "./run.js";
import {
  buildCinematographerReshootSystemPrompt,
  buildCinematographerSystemPrompt,
  renderReshootRequest,
  renderShootRequest,
} from "./prompt-v1.js";

/**
 * CINEMATOGRAPHER PROMPT v2 — the architecture lab's Cinematographer: v1 with no picture.
 *
 * Append-only (CLAUDE.md): v1 is untouched and still serves the Director app.
 *
 * v1 tells the Cinematographer that the location is painted as a picture from its
 * description. The lab makes no picture, so v2 removes that sentence and that label and
 * changes nothing else. Built from v1's text by exact replacement; throws if a replaced
 * string is ever not found, so v2 cannot drift from v1 silently.
 */
export const CINEMATOGRAPHER_PROMPT_VERSION_V2 = "v2";

const V1_PICTURE_SENTENCE = " You have not seen the location picture; it is painted from that description.";
const V1_LOCATION_LABEL = "Location, the picture is painted from this";

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`cinematographer prompt v2: "${from}" not found in v1`);
  return text.replace(from, to);
}

function systemV2(): string {
  return replaceOnce(buildCinematographerSystemPrompt(), V1_PICTURE_SENTENCE, "");
}

function reshootSystemV2(): string {
  const v1Base = buildCinematographerSystemPrompt();
  const v1Reshoot = buildCinematographerReshootSystemPrompt();
  if (!v1Reshoot.startsWith(v1Base)) throw new Error("cinematographer prompt v2: v1's reshoot prompt no longer starts with v1");
  return systemV2() + v1Reshoot.slice(v1Base.length);
}

export const CINEMATOGRAPHER_PROMPTS_V2: CinematographerPrompts = {
  system: systemV2(),
  reshootSystem: reshootSystemV2(),
  renderShoot: (args) => replaceOnce(renderShootRequest(args), V1_LOCATION_LABEL, "Location"),
  renderReshoot: (args) => replaceOnce(renderReshootRequest(args), V1_LOCATION_LABEL, "Location"),
};
