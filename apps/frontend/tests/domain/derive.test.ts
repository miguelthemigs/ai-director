import { describe, expect, it } from "vitest";
import { splitLines, failingCount, meanPercent } from "../../src/domain/derive.js";
import { FIXTURE_RUNS, isScoredCheck } from "@ai-director/contract";

describe("splitLines", () => {
  it("returns one model per line of the description", () => {
    const lines = splitLines("one\ntwo\nthree", []);
    expect(lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3]);
  });

  it("assigns each span to the line its start offset falls on", () => {
    const description = "alpha\nbravo charlie";
    const spans = [
      { spanId: "s1", checkId: "wardrobe" as const, quote: "bravo", start: 6, end: 11 },
    ];
    const lines = splitLines(description, spans);
    expect(lines[0]?.spans).toEqual([]);
    expect(lines[1]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
  });

  it("splits a span that straddles a newline rather than dropping it", () => {
    const description = "alpha bravo\ncharlie delta";
    const spans = [
      { spanId: "s1", checkId: "wardrobe" as const, quote: "bravo\ncharlie", start: 6, end: 19 },
    ];
    const lines = splitLines(description, spans);
    expect(lines[0]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
    expect(lines[1]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
  });

  it("leaves the text reconstructable, so nothing is lost in rendering", () => {
    const description = FIXTURE_RUNS.improvedStillFailing.passes[0]!.description;
    const spans = FIXTURE_RUNS.improvedStillFailing.passes[0]!.results
      .filter(isScoredCheck)
      .flatMap((r) => r.spans);
    const lines = splitLines(description, spans);
    expect(lines.map((l) => l.text).join("\n")).toBe(description);
  });
});

describe("failingCount and meanPercent", () => {
  it("counts checks below band 4", () => {
    const pass = FIXTURE_RUNS.passed.passes[0]!;
    expect(failingCount(pass.results)).toBe(0);
  });

  it("means the nine percentages, not the bands", () => {
    const results = FIXTURE_RUNS.passed.passes[0]!.results;
    const scored = results.filter(isScoredCheck);
    const expected = scored.reduce((sum, r) => sum + r.percent, 0) / scored.length;
    expect(meanPercent(results)).toBeCloseTo(expected, 10);
  });
});
