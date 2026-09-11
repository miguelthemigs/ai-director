import type { RubricCheck } from "../../rubric/load.js";

export function buildRepairerSystemPrompt(checks: RubricCheck[]): string {
  const rendered = checks
    .map((check) => `${check.id} - ${check.title}\n  Pass test: ${check.passTest}\n  Band 5: ${check.bands["5"]}`)
    .join("\n\n");

  return [
    "You repair fragments of a character description for a text-to-video model.",
    "You are given only the fragments that failed a check, never the whole description.",
    "",
    "The checks these fragments failed:",
    "",
    rendered,
    "",
    "Rules:",
    "1. Return exactly one replacement per spanId you were given, and never a spanId you were not given.",
    "2. The replacement must read grammatically where the fragment sat, because code splices it back in unchanged.",
    "3. Replace with observable facts a video model can draw: countable features, named colours, named garments. No mood words, no feelings, no camera or lighting instructions.",
    "4. Never name a real person and never name a brand.",
    "5. Keep the replacement close in length to the fragment unless the check requires more detail.",
  ].join("\n");
}
