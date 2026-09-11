import type { ParseTransport } from "../../api/client.js";
import type { Span } from "../../enforce/verifySpans.js";
import type { RubricCheck } from "../../rubric/load.js";
import { buildRepairerSystemPrompt } from "./prompt.js";
import { RepairerOutputSchema } from "./schema.js";

/**
 * A replacement as the Repairer actually produced it, rationale included.
 * `Replacement` (Task 4, `splice.ts`) is `{spanId, newText}` only --
 * `applyReplacements` never needed the model's rationale, so that type stays
 * narrow. This richer shape is what a caller assembling a real run needs to
 * carry the rationale through to `PassResult` and on to the presenter's
 * `ReplacementView`, without widening `Replacement` itself (which would
 * ripple into every existing `Replacement` literal in `splice.ts` and its
 * tests for a field that module never needed). It is structurally a superset
 * of `Replacement`, so it can be passed anywhere a `Replacement[]` is
 * expected (e.g. `applyReplacements`) with no cast.
 */
export type RepairedReplacement = { spanId: string; newText: string; rationale: string };

/**
 * A replacement the model returned that could not be applied, kept as
 * prompt-tuning signal rather than discarded silently.
 *
 * - "unknown_span": the model named a spanId it was not given.
 * - "empty_text": the model's newText was empty (or all whitespace).
 */
export type RejectedReplacement = {
  spanId: string;
  reason: "unknown_span" | "empty_text";
};

/**
 * Rewrites failing fragments one-for-one, in isolation from the rest of the
 * description (see the module-level design note in prompt.ts's caller: this
 * function only ever sees `spans`, never the full description).
 *
 * A single bad replacement -- an invented spanId, an empty newText -- is
 * dropped into `rejected` rather than thrown, matching the failure idiom used
 * everywhere else in this pipeline (verifySpans for an unlocatable quote,
 * evaluateGroup/evaluateAllGroups for missing evidence or a failed group):
 * mark the bad item, exclude it, keep the rest. Throwing here would cost a
 * whole repair pass -- one of only three -- over one hallucinated id; dropping
 * costs one span for one pass, and the next pass re-evaluates and re-quotes it
 * if it is still wrong. Applying the survivors is safe regardless, because
 * `applyReplacements` (Task 4) independently validates every replacement
 * against the known spans before splicing.
 */
export async function repairSpans(
  deps: { transport: ParseTransport },
  args: { spans: Span[]; checks: RubricCheck[]; reasons: Record<string, string> },
): Promise<{ replacements: RepairedReplacement[]; rejected: RejectedReplacement[] }> {
  const { spans, checks, reasons } = args;
  if (spans.length === 0) return { replacements: [], rejected: [] };

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
  const replacements: RepairedReplacement[] = [];
  const rejected: RejectedReplacement[] = [];

  for (const replacement of output.replacements) {
    if (!known.has(replacement.spanId)) {
      rejected.push({ spanId: replacement.spanId, reason: "unknown_span" });
      continue;
    }
    if (replacement.newText.trim().length === 0) {
      rejected.push({ spanId: replacement.spanId, reason: "empty_text" });
      continue;
    }
    replacements.push({
      spanId: replacement.spanId,
      newText: replacement.newText,
      rationale: replacement.rationale,
    });
  }

  return { replacements, rejected };
}
