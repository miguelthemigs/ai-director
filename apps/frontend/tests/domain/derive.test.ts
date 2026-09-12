import { describe, expect, it } from "vitest";
import { splitLines, segmentLine, failingCount, meanPercent } from "../../src/domain/derive.js";
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

describe("segmentLine", () => {
  it("returns one segment covering the whole line when there are no spans", () => {
    const [line] = splitLines("plain text", []);
    const segments = segmentLine(line!);
    expect(segments).toEqual([{ start: 0, end: 10, spans: [] }]);
  });

  it("keeps two overlapping spans on the same segment rather than dropping the second", () => {
    // "A confident young man" (hair_spec) contains "young man" (age_build) nested inside it —
    // the exact shape of the improvedStillFailing fixture's pass 1.
    const description = "A confident young man with striking features.";
    const spans = [
      { spanId: "hair_spec-0", checkId: "hair_spec" as const, quote: "A confident young man", start: 0, end: 22 },
      { spanId: "age_build-0", checkId: "age_build" as const, quote: "young man", start: 12, end: 21 },
    ];
    const [line] = splitLines(description, spans);
    const segments = segmentLine(line!);

    // Three segments: hair_spec alone ("A confident "), both together ("young man"), hair_spec
    // alone again (the trailing "with striking features." falls outside both quotes, but the
    // point under test is the middle segment).
    const overlap = segments.find((s) => s.start === 12 && s.end === 21);
    expect(overlap?.spans.map((s) => s.spanId).sort()).toEqual(["age_build-0", "hair_spec-0"]);

    // Every offset in the line is still accounted for exactly once, in order.
    expect(segments.map((s) => s.start)).toEqual([0, ...segments.slice(1).map((s) => s.start)]);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]?.start).toBe(segments[i - 1]?.end);
    }
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
