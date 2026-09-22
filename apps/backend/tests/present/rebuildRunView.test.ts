import { describe, expect, it } from "vitest";
import { isScoredCheck } from "@ai-director/contract";
import { rebuildRunView } from "../../src/present/rebuildRunView.js";
import type { RunManifest } from "../../src/store/RunStore.js";

/**
 * Rebuilding is the only way a finished run can be looked at again. The full `RunView` a
 * run produces lives in one in-memory map on the server, so every restart -- a file save
 * under `tsx watch`, a laptop closing -- used to lose every result while the files that
 * produced it sat untouched on disk. These tests hold the rebuild to the same shape the
 * live path emits, because the UI cannot tell the two apart and must not have to.
 */

const manifest: RunManifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "passed",
  startedAt: "2026-09-11T20:47:00.985Z",
  finishedAt: "2026-09-11T20:47:43.168Z",
  passes: 2,
};

const evaluation = (description: string, band: 1 | 2 | 3 | 4 | 5, quote: string) => ({
  description,
  results: [
    {
      status: "scored",
      checkId: "drawable_only",
      band,
      reason: "Mood word.",
      quotes: [quote],
      missingEvidence: false,
    },
  ],
  failing: band < 4 ? ["drawable_only"] : [],
  notEvaluated: [],
  spans: [
    {
      spanId: "drawable_only:0",
      checkId: "drawable_only",
      quote,
      start: description.indexOf(quote),
      end: description.indexOf(quote) + quote.length,
    },
  ],
  unverified: [],
  negativeConstraintPresent: false,
});

describe("rebuildRunView", () => {
  it("rebuilds the run's identity and both descriptions from the manifest and its passes", () => {
    const view = rebuildRunView(manifest, [
      {
        pass: 1,
        evaluation: evaluation("A man with a cinematic presence.", 2, "cinematic presence"),
        repair: {
          from: "A man with a cinematic presence.",
          to: "A man with a grey hoodie.",
          replacements: [
            { spanId: "drawable_only:0", newText: "grey hoodie", rationale: "drawable" },
          ],
          rejected: [],
        },
      },
      { pass: 2, evaluation: evaluation("A man with a grey hoodie.", 5, "grey hoodie") },
    ]);

    expect(view.runId).toBe("run-1");
    expect(view.status).toBe("passed");
    expect(view.finishedAt).toBe("2026-09-11T20:47:43.168Z");
    expect(view.originalDescription).toBe("A man with a cinematic presence.");
    expect(view.finalDescription).toBe("A man with a grey hoodie.");
    expect(view.passes).toHaveLength(2);
  });

  it("restores each check's band, its derived percent and its verified quotes", () => {
    const view = rebuildRunView(manifest, [
      { pass: 1, evaluation: evaluation("A man with a cinematic presence.", 2, "cinematic presence") },
    ]);

    const check = view.passes[0]?.results[0];
    if (!check || !isScoredCheck(check)) throw new Error("expected a scored check");
    // Derived in code from the band, exactly as the live path does it. A rebuild that
    // carried a stored percent could disagree with the band it sits beside.
    expect(check.percent).toBe(40);
    expect(check.passed).toBe(false);
    expect(check.spans[0]?.quote).toBe("cinematic presence");
  });

  it("restores the applied replacements so a reopened run shows what was repaired", () => {
    const view = rebuildRunView(manifest, [
      {
        pass: 1,
        evaluation: evaluation("A man with a cinematic presence.", 2, "cinematic presence"),
        repair: {
          from: "A man with a cinematic presence.",
          to: "A man with a grey hoodie.",
          replacements: [
            { spanId: "drawable_only:0", newText: "grey hoodie", rationale: "drawable" },
          ],
          rejected: [],
        },
      },
    ]);

    expect(view.passes[0]?.replacements).toEqual([
      {
        spanId: "drawable_only:0",
        checkId: "drawable_only",
        oldText: "cinematic presence",
        newText: "grey hoodie",
        rationale: "drawable",
      },
    ]);
    expect(view.passes[0]?.repairedDescription).toBe("A man with a grey hoodie.");
  });

  it("reports cost as not measured rather than as zero", () => {
    const view = rebuildRunView(manifest, [
      { pass: 1, evaluation: evaluation("A man with a grey hoodie.", 5, "grey hoodie") },
    ]);
    // Tokens and spend are never written to disk, so a rebuilt run has no cost to report.
    // An absent field reads as "not measured"; a zero would read as a measurement of zero.
    expect(view.cost).toEqual({});
  });

  it("rebuilds a run whose repair file predates the applied replacements being stored", () => {
    const view = rebuildRunView(manifest, [
      {
        pass: 1,
        evaluation: evaluation("A man with a cinematic presence.", 2, "cinematic presence"),
        repair: {
          from: "A man with a cinematic presence.",
          to: "A man with a grey hoodie.",
          rejected: [],
        },
      },
    ]);
    // The repaired text is still recoverable; only the fragment-by-fragment diff is not.
    expect(view.passes[0]?.replacements).toEqual([]);
    expect(view.passes[0]?.repairedDescription).toBe("A man with a grey hoodie.");
  });

  it("refuses a run whose passes cannot be read rather than inventing an empty one", () => {
    expect(() => rebuildRunView(manifest, [])).toThrow(/no passes/i);
    expect(() => rebuildRunView(manifest, [{ pass: 1, evaluation: { nonsense: true } }])).toThrow();
  });
});
