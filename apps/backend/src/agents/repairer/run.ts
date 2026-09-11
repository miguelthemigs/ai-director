import type { ParseTransport } from "../../api/client.js";
import type { Replacement } from "../../enforce/splice.js";
import type { Span } from "../../enforce/verifySpans.js";
import type { RubricCheck } from "../../rubric/load.js";
import { buildRepairerSystemPrompt } from "./prompt.js";
import { RepairerOutputSchema } from "./schema.js";

export async function repairSpans(
  deps: { transport: ParseTransport },
  args: { spans: Span[]; checks: RubricCheck[]; reasons: Record<string, string> },
): Promise<Replacement[]> {
  const { spans, checks, reasons } = args;
  if (spans.length === 0) return [];

  const user = spans
    .map(
      (span) =>
        `spanId: ${span.spanId}\ncheck: ${span.checkId}\nwhy it failed: ${reasons[span.spanId] ?? "below pass band"}\nfragment: ${span.quote}`,
    )
    .join("\n\n");

  const { parsed_output } = await deps.transport({
    system: buildRepairerSystemPrompt(checks),
    user,
    schema: RepairerOutputSchema,
  });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error("repairer parse failed");
  }
  const output = RepairerOutputSchema.parse(parsed_output);

  const known = new Set(spans.map((span) => span.spanId));
  for (const replacement of output.replacements) {
    if (!known.has(replacement.spanId)) {
      throw new Error(`unknown spanId ${replacement.spanId} from repairer`);
    }
  }
  return output.replacements.map(({ spanId, newText }) => ({ spanId, newText }));
}
