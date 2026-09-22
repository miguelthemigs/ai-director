import { z } from "zod";
import type { RunView, StepCost } from "@ai-director/contract";
import type { EvaluatedCheck } from "../agents/evaluator/run.js";
import type { RepairedReplacement } from "../agents/repairer/run.js";
import type { PassResult } from "../orchestrate/runPass.js";
import type { RunManifest, StoredPass } from "../store/RunStore.js";
import { toPassView, toRunView } from "./toRunView.js";

/**
 * A finished run, read back off disk.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────
 * A run's assembled `RunView` was only ever held in one in-memory map in the server
 * process. Every pass had been written to disk since the store shipped, but nothing could
 * read one back, so the moment that process restarted -- a file save under `tsx watch`, a
 * laptop closing and the dev server going with it -- every result the run had produced
 * became unreachable while the files that produced it sat untouched. `GET /runs/:id`
 * answered "has no completed view yet" for runs that had completed days earlier.
 *
 * This rebuilds that view from the manifest and the pass files, and deliberately goes
 * through the same `toPassView`/`toRunView` the live path uses rather than assembling the
 * wire shape a second time: two assemblers would drift, and a reopened run that renders
 * subtly differently from a live one is worse than one that cannot be reopened at all.
 *
 * What cannot be recovered is cost. Tokens, spend and latency are never written to disk,
 * so a rebuilt run reports `{}` -- "not measured" -- which `StepCost`'s all-optional shape
 * exists precisely to express. It must never be a zero, which would read as a measurement.
 */

const StoredSpanSchema = z.object({
  spanId: z.string(),
  checkId: z.string(),
  quote: z.string(),
  start: z.number(),
  end: z.number(),
});

const StoredCheckSchema = z.union([
  z.object({
    status: z.literal("scored"),
    checkId: z.string(),
    band: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    reason: z.string(),
    quotes: z.array(z.string()),
    missingEvidence: z.boolean(),
  }),
  z.object({
    status: z.literal("not_evaluated"),
    checkId: z.string(),
    reason: z.string(),
  }),
]);

const StoredEvaluationSchema = z.object({
  description: z.string(),
  results: z.array(StoredCheckSchema),
  failing: z.array(z.string()),
  notEvaluated: z.array(z.string()),
  spans: z.array(StoredSpanSchema),
  unverified: z.array(
    z.object({
      checkId: z.string(),
      quote: z.string(),
      reason: z.enum(["not_found", "ambiguous"]),
    }),
  ),
  negativeConstraintPresent: z.boolean(),
});

/** `replacements` is optional because runs written before it was persisted do not carry it.
 *  Those rebuild with an empty diff rather than not rebuilding at all: the repaired text is
 *  still in `to`, and only the fragment-by-fragment view of how it got there is lost. */
const StoredRepairSchema = z.object({
  from: z.string(),
  to: z.string(),
  replacements: z
    .array(z.object({ spanId: z.string(), newText: z.string(), rationale: z.string() }))
    .optional(),
  rejected: z
    .array(z.object({ spanId: z.string(), reason: z.enum(["unknown_span", "empty_text"]) }))
    .default([]),
});

const NOT_MEASURED: StepCost = {};

export function rebuildRunView(manifest: RunManifest, stored: StoredPass[]): RunView {
  if (stored.length === 0) {
    throw new Error(`rebuildRunView: run "${manifest.runId}" has no passes on disk`);
  }

  const passes = stored.map((entry) => {
    const evaluation = StoredEvaluationSchema.parse(entry.evaluation);
    const repair =
      entry.repair === undefined ? undefined : StoredRepairSchema.parse(entry.repair);

    // A repair file is written whenever the Repairer ran, including when every replacement
    // it returned was rejected. `to === from` is that case, and it is not a repair.
    const repaired = repair && repair.to !== repair.from ? repair.to : undefined;
    const replacements: RepairedReplacement[] = repair?.replacements ?? [];

    const result: PassResult = {
      pass: entry.pass,
      description: evaluation.description,
      results: evaluation.results as EvaluatedCheck[],
      failing: evaluation.failing,
      notEvaluated: evaluation.notEvaluated,
      spans: evaluation.spans,
      unverified: evaluation.unverified,
      negativeConstraintPresent: evaluation.negativeConstraintPresent,
      replacements,
      rejected: repair?.rejected ?? [],
      ...(repaired === undefined ? {} : { repairedDescription: repaired }),
    };

    return toPassView(result, replacements);
  });

  const first = passes[0];
  const last = passes[passes.length - 1];
  if (!first || !last) throw new Error(`rebuildRunView: run "${manifest.runId}" has no passes`);

  return toRunView(
    manifest,
    passes,
    first.description,
    last.repairedDescription ?? last.description,
    NOT_MEASURED,
  );
}
