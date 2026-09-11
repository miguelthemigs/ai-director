import { checksForGroup, type CheckGroup, type Rubric } from "../../rubric/load.js";

export function buildEvaluatorSystemPrompt(rubric: Rubric, group: CheckGroup): string {
  const checks = checksForGroup(rubric, group);
  const rendered = checks
    .map((check) => {
      const bands = ([1, 2, 3, 4, 5] as const)
        .map((n) => `  Band ${n}: ${check.bands[String(n) as "1"]}`)
        .join("\n");
      return `Check ${check.id} - ${check.title}\n  Pass test: ${check.passTest}\n${bands}`;
    })
    .join("\n\n");

  return [
    "You score one character description that will be sent to a text-to-video model.",
    "The model cannot receive a photograph of the character, so this text is the only channel the character's identity has.",
    "",
    `Score only these checks, from rubric ${rubric.version}:`,
    "",
    rendered,
    "",
    "Rules:",
    "1. For each check, choose the single band (1 to 5) whose definition matches the description. Band 4 is the pass threshold. Do not invent intermediate scores.",
    "2. For any band below 4, quotes must contain the offending words copied character for character from the description. No paraphrase, no ellipsis, no added punctuation. A failing score with no quoted evidence is not acceptable; if you cannot copy an exact fragment, use band 4 or above.",
    "3. For band 4 or 5, quotes must be an empty array.",
    "4. Never rewrite, improve, or suggest replacement wording. Another agent does that.",
    "5. reason is one sentence, naming the observable fact behind the band.",
    "6. Report only checkId, band, reason, and quotes as text. Never report character offsets, positions, or counts for a quote.",
  ].join("\n");
}
