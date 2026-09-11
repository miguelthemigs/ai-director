import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EvaluatedCheck } from "../../src/agents/evaluator/run.js";
import { runToCompletion } from "../../src/orchestrate/runToCompletion.js";
import type { EvaluateFn, RepairFn, RetryVerbatimFn } from "../../src/orchestrate/runPass.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileRunStore } from "../../src/store/FileRunStore.js";

type LoadedRubric = Awaited<ReturnType<typeof loadRubric>>;

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

const scored = (
  checkId: string,
  band: 1 | 2 | 3 | 4 | 5,
  reason: string,
  quotes: string[] = [],
): EvaluatedCheck => ({
  status: "scored",
  checkId,
  band,
  reason,
  quotes,
  missingEvidence: band < 4 && quotes.length === 0,
});

const allPass = (rubric: LoadedRubric): EvaluatedCheck[] =>
  rubric.checks.map((c) => scored(c.id, 5, "r"));

const failDrawable = (rubric: LoadedRubric): EvaluatedCheck[] =>
  rubric.checks.map((c) =>
    c.id === "drawable_only"
      ? scored(c.id, 2, "mood word", ["very cinematic presence"])
      : scored(c.id, 5, "r"),
  );

async function store() {
  return new FileRunStore(await mkdtemp(path.join(tmpdir(), "runs-")));
}

// None of these tests exercise the quote-exactly retry, so a stub that is
// never expected to be called is enough.
const noRetry: RetryVerbatimFn = vi.fn();

describe("runToCompletion", () => {
  it("stops after one pass when everything passes", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(allPass(rubric));
    const repair: RepairFn = vi.fn();
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-1" },
    );
    expect(out.status).toBe("passed");
    expect(out.passes).toHaveLength(1);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs, re-scores, and passes on the second pass", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "a square jaw" }],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-2" },
    );
    expect(out.status).toBe("passed");
    expect(out.passes).toHaveLength(2);
    expect(out.finalDescription).toContain("a square jaw");
    expect(out.finalDescription).not.toContain("very cinematic presence");
  });

  it("gives up after three passes and says it still fails", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "very cinematic presence" }],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-3" },
    );
    expect(out.passes).toHaveLength(3);
    expect(out.status).toBe("no_improvement");
  });

  it("reports improved_still_failing when the failing set shrinks but is not empty", async () => {
    const rubric = await loadRubric("v1");
    const twoFail = rubric.checks.map((c) =>
      c.id === "drawable_only"
        ? scored(c.id, 2, "m", ["very cinematic presence"])
        : c.id === "wardrobe"
          ? scored(c.id, 2, "w", ["grey hoodie"])
          : scored(c.id, 5, "r"),
    );
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(twoFail)
      .mockResolvedValue(failDrawable(rubric));
    // Span-aware rather than a fixed reply: pass 2 only has one check still
    // failing, so only one span is sent to the repairer that time.
    const repair: RepairFn = vi.fn(async ({ spans }: Parameters<RepairFn>[0]) => ({
      replacements: spans.map((s) => ({
        spanId: s.spanId,
        newText:
          s.checkId === "wardrobe" ? "charcoal hoodie and white sneakers" : "very cinematic presence",
      })),
      rejected: [],
    }));
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-4" },
    );
    expect(out.status).toBe("improved_still_failing");
  });

  it("writes an eval file per pass to the store", async () => {
    const rubric = await loadRubric("v1");
    const s = await store();
    const spy = vi.spyOn(s, "writePass");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(allPass(rubric));
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: s },
      { rubric, description, runId: "run-5" },
    );
    expect(spy).toHaveBeenCalledWith("run-5", 1, "eval", expect.anything());
  });

  it("reports the negative-constraint invariant on every pass", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(allPass(rubric));
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: await store() },
      { rubric, description, runId: "run-6" },
    );
    expect(out.passes[0]?.negativeConstraintPresent).toBe(false);
  });

  it("never returns passed when a check came back not_evaluated", async () => {
    const rubric = await loadRubric("v1");
    const withNotEvaluated: EvaluatedCheck[] = rubric.checks.map((c) =>
      c.id === "no_real_person"
        ? { status: "not_evaluated", checkId: c.id, reason: "group safety failed to evaluate" }
        : scored(c.id, 5, "r"),
    );
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(withNotEvaluated);
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-7" },
    );
    // No quotes to repair for a not_evaluated check, so nothing is spliced and
    // the loop cannot make progress -- it must never claim "passed".
    expect(out.status).not.toBe("passed");
    expect(out.passes.every((p) => p.failing.includes("no_real_person"))).toBe(true);
  });
});

describe("runToCompletion: overlapping spans and repair selection", () => {
  const brandDescription =
    "A lean man, late 20s, with a square jaw, wearing a Nike hoodie and grey trousers.";

  it("sends the safety check's span to the repairer when it collides with a wardrobe span", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(
      rubric.checks.map((c) => {
        if (c.id === "wardrobe") return scored(c.id, 2, "brand on wardrobe", ["Nike hoodie"]);
        if (c.id === "no_brand_name") return scored(c.id, 1, "brand named", ["Nike"]);
        return scored(c.id, 5, "r");
      }),
    );
    const repair = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description: brandDescription, runId: "run-collision-1" },
    );

    expect(repair).toHaveBeenCalledTimes(1);
    const call = repair.mock.calls[0]?.[0] as { spans: Array<{ checkId: string }> } | undefined;
    const sentCheckIds = call?.spans.map((s) => s.checkId) ?? [];
    expect(sentCheckIds).toContain("no_brand_name");
    expect(sentCheckIds).not.toContain("wardrobe");
  });

  it("keeps the deferred span verified rather than marking it unverified", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(
      rubric.checks.map((c) => {
        if (c.id === "wardrobe") return scored(c.id, 2, "brand on wardrobe", ["Nike hoodie"]);
        if (c.id === "no_brand_name") return scored(c.id, 1, "brand named", ["Nike"]);
        return scored(c.id, 5, "r");
      }),
    );
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description: brandDescription, runId: "run-collision-2" },
    );

    const firstPass = out.passes[0];
    expect(firstPass?.spans.some((s) => s.checkId === "wardrobe" && s.quote === "Nike hoodie")).toBe(
      true,
    );
    expect(firstPass?.unverified.some((u) => u.checkId === "wardrobe")).toBe(false);
  });

  it("repairs the deferred span on a later pass once the collision is gone", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(
        rubric.checks.map((c) => {
          if (c.id === "wardrobe") return scored(c.id, 2, "brand on wardrobe", ["Nike hoodie"]);
          if (c.id === "no_brand_name") return scored(c.id, 1, "brand named", ["Nike"]);
          return scored(c.id, 5, "r");
        }),
      )
      .mockResolvedValueOnce(
        rubric.checks.map((c) =>
          c.id === "wardrobe"
            ? scored(c.id, 2, "no colour", ["plain hoodie"])
            : scored(c.id, 5, "r"),
        ),
      )
      .mockResolvedValue(allPass(rubric));
    const repair = vi
      .fn()
      .mockResolvedValueOnce({
        replacements: [{ spanId: "no_brand_name:0", newText: "plain" }],
        rejected: [],
      })
      .mockResolvedValueOnce({
        replacements: [{ spanId: "wardrobe:0", newText: "charcoal hoodie" }],
        rejected: [],
      });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description: brandDescription, runId: "run-collision-3" },
    );

    expect(repair).toHaveBeenCalledTimes(2);
    const secondCall = repair.mock.calls[1]?.[0] as { spans: Array<{ checkId: string }> } | undefined;
    const secondCallSpans = secondCall?.spans.map((s) => s.checkId) ?? [];
    expect(secondCallSpans).toContain("wardrobe");
    expect(out.finalDescription).toContain("charcoal hoodie");
  });
});

describe("runToCompletion: quote-exactly retry", () => {
  it("re-asks once when a quote does not match verbatim", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(
      rubric.checks.map((c) =>
        c.id === "drawable_only"
          ? scored(c.id, 2, "mood word", ["a cinematic presence"]) // paraphrase, not in description
          : scored(c.id, 5, "r"),
      ),
    );
    const retryVerbatim: RetryVerbatimFn = vi
      .fn()
      .mockResolvedValueOnce(
        rubric.checks
          .filter((c) => c.group === "drawable")
          .map((c) =>
            c.id === "drawable_only"
              ? scored(c.id, 2, "mood word", ["very cinematic presence"]) // exact this time
              : scored(c.id, 5, "r"),
          ),
      );
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const out = await runToCompletion(
      { evaluate, retryVerbatim, repair, store: await store() },
      { rubric, description, runId: "run-retry-1" },
    );

    expect(retryVerbatim).toHaveBeenCalledTimes(1);
    expect(retryVerbatim).toHaveBeenCalledWith(
      expect.objectContaining({ group: "drawable", description }),
    );
    expect(out.passes[0]?.unverified).toHaveLength(0);
    expect(
      out.passes[0]?.spans.some((s) => s.checkId === "drawable_only" && s.quote === "very cinematic presence"),
    ).toBe(true);
  });

  it("gives up after exactly one retry and marks the quote unverified", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(
      rubric.checks.map((c) =>
        c.id === "drawable_only"
          ? scored(c.id, 2, "mood word", ["a cinematic presence"])
          : scored(c.id, 5, "r"),
      ),
    );
    const retryVerbatim: RetryVerbatimFn = vi.fn().mockResolvedValue(
      rubric.checks
        .filter((c) => c.group === "drawable")
        .map((c) =>
          c.id === "drawable_only"
            ? scored(c.id, 2, "mood word", ["a cinematic presence"]) // still a paraphrase
            : scored(c.id, 5, "r"),
        ),
    );
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const out = await runToCompletion(
      { evaluate, retryVerbatim, repair, store: await store() },
      { rubric, description, runId: "run-retry-2" },
    );

    expect(retryVerbatim).toHaveBeenCalledTimes(1);
    expect(out.passes[0]?.unverified.some((u) => u.checkId === "drawable_only")).toBe(true);
    expect(repair).not.toHaveBeenCalled();
  });

  it("does not retry a group whose quotes all verified first time", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const retryVerbatim: RetryVerbatimFn = vi.fn();
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "a square jaw" }],
      rejected: [],
    });
    await runToCompletion(
      { evaluate, retryVerbatim, repair, store: await store() },
      { rubric, description, runId: "run-retry-3" },
    );

    expect(retryVerbatim).not.toHaveBeenCalled();
  });
});
