import { isValidVideoSeconds, type FilledBrief } from "@ai-director/contract";
import type { ParseTransport } from "../../api/client.js";
import { buildInterrogatorSystemPrompt, renderInterrogatorRequest } from "./prompt-v1.js";
import { InterrogatorOutputSchema } from "./schema.js";

const DECIDED_FIELDS = ["productKind", "audience", "tone", "setting", "character"] as const;

/**
 * One call: the brief in, a filled brief out.
 *
 * `brief` is the caller's text, never the model's echo of it. A blank decided field
 * throws: the prompt's whole job is to decide, so a gap is a failed attempt, not
 * something to paper over downstream.
 *
 * A suggested length Seedance cannot render (outside 4-30) becomes null rather than
 * failing the run: it only prefills the length field at Gate A, and null already
 * means "no usable suggestion; the owner chooses" there.
 */
export async function interrogate(
  deps: { transport: ParseTransport },
  args: { brief: string },
): Promise<FilledBrief> {
  const { parsed_output } = await deps.transport({
    system: buildInterrogatorSystemPrompt(),
    user: renderInterrogatorRequest(args.brief),
    schema: InterrogatorOutputSchema,
  });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error("interrogator parse failed");
  }
  const output = InterrogatorOutputSchema.parse(parsed_output);

  for (const field of DECIDED_FIELDS) {
    if (output[field].trim() === "") throw new Error(`interrogator left ${field} blank`);
  }
  const suggested = output.suggestedSeconds;

  return {
    brief: args.brief,
    productKind: output.productKind,
    audience: output.audience,
    tone: output.tone,
    setting: output.setting,
    character: output.character,
    suggestedSeconds: suggested !== null && isValidVideoSeconds(suggested) ? suggested : null,
  };
}
