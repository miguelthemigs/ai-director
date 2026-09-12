import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@ai-director/contract";
import type { EvaluatedCheck } from "../../src/agents/evaluator/run.js";
import type { EventSink } from "../../src/orchestrate/events.js";
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
      replacements: [
        { spanId: "drawable_only:0", newText: "a square jaw", rationale: "swaps a mood word for a drawable feature" },
      ],
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

  it("carries the applied replacements, rationale included, on the pass that repaired something", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [
        { spanId: "drawable_only:0", newText: "a square jaw", rationale: "swaps a mood word for a drawable feature" },
      ],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-2b" },
    );
    expect(out.passes[0]?.replacements).toEqual([
      { spanId: "drawable_only:0", newText: "a square jaw", rationale: "swaps a mood word for a drawable feature" },
    ]);
    // The second pass is the final pass: it never calls the repairer, so it
    // carries no applied replacements of its own.
    expect(out.passes[1]?.replacements).toEqual([]);
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
    // The final pass (pass 3) evaluates and stops -- it never calls the
    // repairer, so only passes 1 and 2 do.
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("does not call the repairer on the final pass, even while checks still fail", async () => {
    const rubric = await loadRubric("v1");
    // Pass 2 (the final pass here) reports the failure with no quote -- it
    // must still count as failing, but by then the text has already been
    // spliced by pass 1's repair, so a stale quote would wrongly (and
    // separately) trigger the quote-exactly retry instead of exercising the
    // no-repair-on-final-pass rule this test targets.
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(
        rubric.checks.map((c) =>
          c.id === "drawable_only" ? scored(c.id, 2, "still a mood word") : scored(c.id, 5, "r"),
        ),
      );
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "a square jaw" }],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-final-pass-1", maxPasses: 2 },
    );
    expect(out.passes).toHaveLength(2);
    expect(repair).toHaveBeenCalledTimes(1); // pass 1 only; pass 2 is final
    // finalDescription is exactly what the final pass's own scores describe,
    // never text a repair changed after the last evaluation.
    expect(out.finalDescription).toBe(out.passes[1]?.description);
    expect(out.passes[1]?.repairedDescription).toBeUndefined();
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
        rationale: "r",
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

  it("reports the negative-constraint invariant honestly for both presence and absence", async () => {
    // Weak in the original version: it only ever asserted `false`, which a
    // hardcoded `false` would also satisfy. Assert both directions.
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(allPass(rubric));

    const without = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: await store() },
      { rubric, description, runId: "run-6a" },
    );
    expect(without.passes[0]?.negativeConstraintPresent).toBe(false);

    const with_ = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: await store() },
      {
        rubric,
        description: `${description} No identity drift across every cut.`,
        runId: "run-6b",
      },
    );
    expect(with_.passes[0]?.negativeConstraintPresent).toBe(true);
  });

  it("never returns passed when a check came back not_evaluated, and distinguishes it from a scored failure", async () => {
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
    // notEvaluated is the display-only breakdown: a check with no band is not
    // "below band 4", so the presenter needs to tell the two apart even
    // though both fold into the `passed` gate the same way.
    expect(out.passes.every((p) => p.notEvaluated.includes("no_real_person"))).toBe(true);
  });

  it("continues past a transient not_evaluated instead of giving up early", async () => {
    const rubric = await loadRubric("v1");
    const transientFailure: EvaluatedCheck[] = rubric.checks.map((c) =>
      c.id === "no_real_person"
        ? { status: "not_evaluated", checkId: c.id, reason: "transient network error" }
        : scored(c.id, 5, "r"),
    );
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(transientFailure)
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-transient-1" },
    );
    // Pass 1 has nothing repairable (a not_evaluated check carries no
    // quotes), but it must not be treated as genuinely unrepairable: the
    // loop re-evaluates on pass 2, where the transient failure is gone.
    expect(out.passes).toHaveLength(2);
    expect(out.status).toBe("passed");
  });

  it("finishes the run as failed and rethrows when a pass throws", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair: RepairFn = vi.fn().mockRejectedValue(new Error("repairer exploded"));
    const s = await store();
    await expect(
      runToCompletion(
        { evaluate, retryVerbatim: noRetry, repair, store: s },
        { rubric, description, runId: "run-fail-1" },
      ),
    ).rejects.toThrow("repairer exploded");

    const manifest = await s.getRun("run-fail-1");
    expect(manifest.status).toBe("failed");
  });

  it("writes rejected replacements into the pass's repair payload instead of only logging them", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [],
      rejected: [{ spanId: "drawable_only:0", reason: "empty_text" }],
    });
    const s = await store();
    const spy = vi.spyOn(s, "writePass");
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: s },
      { rubric, description, runId: "run-rejected-1" },
    );
    expect(spy).toHaveBeenCalledWith(
      "run-rejected-1",
      1,
      "repair",
      expect.objectContaining({
        rejected: [{ spanId: "drawable_only:0", reason: "empty_text" }],
      }),
    );
  });

  it("classifies a run as improved_still_failing when a band rose even though the failing count did not shrink", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(
        rubric.checks.map((c) =>
          c.id === "drawable_only"
            ? scored(c.id, 1, "bad", ["very cinematic presence"])
            : scored(c.id, 5, "r"),
        ),
      )
      .mockResolvedValueOnce(
        rubric.checks.map((c) =>
          c.id === "drawable_only" ? scored(c.id, 3, "better") : scored(c.id, 5, "r"),
        ),
      );
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "cinematic presence" }],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-band-rose-1", maxPasses: 2 },
    );
    // Both passes leave exactly one check failing (drawable_only never
    // reaches band 4), so a count-only rule would call this no_improvement.
    // Its band rose 1 -> 3, so it must be improved_still_failing instead.
    expect(out.passes[0]?.failing).toHaveLength(1);
    expect(out.passes[1]?.failing).toHaveLength(1);
    expect(out.status).toBe("improved_still_failing");
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

describe("runToCompletion: event emission", () => {
  function collectEmit(): { emit: EventSink; events: RunEvent[] } {
    const events: RunEvent[] = [];
    return { emit: (event) => events.push(event), events };
  }

  it("produces identical output to Task 9 when no emit is given, so the CLI is unaffected", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [
        { spanId: "drawable_only:0", newText: "a square jaw", rationale: "swaps a mood word for a drawable feature" },
      ],
      rejected: [],
    });
    const out = await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store() },
      { rubric, description, runId: "run-no-emit" },
    );
    // Same shape and values Task 9's own "repairs, re-scores, and passes on
    // the second pass" test asserts -- deps carries no `emit` here, exactly
    // like every call in this file above this describe block.
    expect(out.status).toBe("passed");
    expect(out.passes).toHaveLength(2);
    expect(out.finalDescription).toContain("a square jaw");
    expect(out.finalDescription).not.toContain("very cinematic presence");
  });

  it("emits run.started once, first, with the run's identity", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(allPass(rubric));
    const { emit, events } = collectEmit();
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: await store(), emit },
      { rubric, description, runId: "run-events-1" },
    );
    expect(events[0]).toMatchObject({
      id: "0-0",
      name: "run.started",
      runId: "run-events-1",
      rubricVersion: rubric.version,
      description,
    });
    expect(events.filter((e) => e.name === "run.started")).toHaveLength(1);
  });

  it("emits pass.started and pass.completed with sequential ids that reset per pass", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [{ spanId: "drawable_only:0", newText: "a square jaw", rationale: "r" }],
      rejected: [],
    });
    const { emit, events } = collectEmit();
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store(), emit },
      { rubric, description, runId: "run-events-2" },
    );

    const passStarted = events.filter((e) => e.name === "pass.started");
    expect(passStarted.map((e) => e.id)).toEqual(["1-0", "2-0"]);

    const passCompleted = events.filter((e) => e.name === "pass.completed");
    expect(passCompleted).toHaveLength(2);
    expect(passCompleted[0]).toMatchObject({ pass: 1, failing: ["drawable_only"] });
    expect(passCompleted[1]).toMatchObject({ pass: 2, failing: [] });
  });

  // Fix round 1: pass.completed now carries the pass's fully-verified results (real spans, not
  // the always-empty ones evaluator.group.completed necessarily carries), since verification has
  // already fully resolved by the time runPass returns. This is the earliest a live run can hand
  // a frontend a clickable fragment.
  it("gives pass.completed's results a verified, non-empty span for the failing check", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({ replacements: [], rejected: [] });
    const { emit, events } = collectEmit();
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store(), emit },
      { rubric, description, runId: "run-events-6", maxPasses: 1 },
    );

    const passCompleted = events.find((e) => e.name === "pass.completed");
    if (!passCompleted || passCompleted.name !== "pass.completed") {
      throw new Error("expected a pass.completed event");
    }
    const drawable = passCompleted.results.find((r) => r.checkId === "drawable_only");
    if (!drawable || drawable.status !== "scored") {
      throw new Error("expected drawable_only to be scored in pass.completed's results");
    }
    expect(drawable.spans.length).toBeGreaterThan(0);
    expect(drawable.spans[0]?.quote).toBe("very cinematic presence");

    // Meanwhile the group event for the same check, earlier in the same pass, carries no span at
    // all -- verification hadn't happened yet when it fired.
    const groupCompleted = events.filter((e) => e.name === "evaluator.group.completed");
    for (const g of groupCompleted) {
      for (const r of g.results) {
        if (r.status === "scored") expect(r.spans).toEqual([]);
      }
    }
  });

  it("emits evaluator.group.completed in real settle order, not the order groups were issued", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn(async ({ rubric: r, onGroupEvent }) => {
      onGroupEvent?.({ type: "started", group: "look" });
      onGroupEvent?.({ type: "started", group: "safety" });
      onGroupEvent?.({ type: "started", group: "drawable" });
      // Settles out of issue order on purpose: safety first, then drawable,
      // then look -- a recorder keyed to array/issue order would get this
      // wrong.
      onGroupEvent?.({ type: "completed", group: "safety", results: [] });
      onGroupEvent?.({ type: "completed", group: "drawable", results: [] });
      onGroupEvent?.({ type: "completed", group: "look", results: [] });
      return allPass(r);
    });
    const { emit, events } = collectEmit();
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair: vi.fn(), store: await store(), emit },
      { rubric, description, runId: "run-events-3" },
    );

    const groupEvents = events.filter(
      (e) => e.name === "evaluator.group.started" || e.name === "evaluator.group.completed",
    ) as Array<{ name: string; group: string; id: string }>;
    expect(groupEvents.map((e) => `${e.name}:${e.group}`)).toEqual([
      "evaluator.group.started:look",
      "evaluator.group.started:safety",
      "evaluator.group.started:drawable",
      "evaluator.group.completed:safety",
      "evaluator.group.completed:drawable",
      "evaluator.group.completed:look",
    ]);
    // Ids are sequential within the pass, continuing on from pass.started.
    expect(groupEvents.map((e) => e.id)).toEqual(["1-1", "1-2", "1-3", "1-4", "1-5", "1-6"]);
  });

  it("emits repairer.started/completed only on a pass that actually repairs something", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair: RepairFn = vi.fn().mockResolvedValue({
      replacements: [
        { spanId: "drawable_only:0", newText: "a square jaw", rationale: "swaps a mood word for a drawable feature" },
      ],
      rejected: [],
    });
    const { emit, events } = collectEmit();
    await runToCompletion(
      { evaluate, retryVerbatim: noRetry, repair, store: await store(), emit },
      { rubric, description, runId: "run-events-4" },
    );

    const repairerEvents = events.filter(
      (e): e is Extract<RunEvent, { name: "repairer.started" | "repairer.completed" }> =>
        e.name === "repairer.started" || e.name === "repairer.completed",
    );
    // Pass 1 repairs (one started + one completed); pass 2 is the final
    // pass and never calls the repairer, so it contributes none.
    expect(repairerEvents).toHaveLength(2);
    expect(repairerEvents.every((e) => e.pass === 1)).toBe(true);
    const completed = repairerEvents.find((e) => e.name === "repairer.completed");
    expect(completed).toMatchObject({
      replacements: [
        expect.objectContaining({ spanId: "drawable_only:0", newText: "a square jaw" }),
      ],
    });
  });

  it("emits run.failed with the error message when a pass throws, and never emits run.completed itself", async () => {
    const rubric = await loadRubric("v1");
    const evaluate: EvaluateFn = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair: RepairFn = vi.fn().mockRejectedValue(new Error("repairer exploded"));
    const { emit, events } = collectEmit();
    await expect(
      runToCompletion(
        { evaluate, retryVerbatim: noRetry, repair, store: await store(), emit },
        { rubric, description, runId: "run-events-5" },
      ),
    ).rejects.toThrow("repairer exploded");

    expect(events.some((e) => e.name === "run.completed")).toBe(false);
    const failed = events.at(-1);
    expect(failed).toMatchObject({ name: "run.failed", error: "repairer exploded" });
  });
});
