import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EvaluatedCheck } from "../../src/agents/evaluator/run.js";
import type { ParseTransport } from "../../src/api/client.js";
import { loadRubric } from "../../src/rubric/load.js";

// `evaluateAllGroups` is mocked at the module level (same pattern as
// cli/score.test.ts mocking runToCompletion): `compareProviders` calls it
// once per transport per description, so tests control exactly what each
// provider "scored" for each check without needing a realistic fake
// Anthropic/OpenAI client, and without ever touching a network.
const { mockEvaluateAllGroups } = vi.hoisted(() => ({ mockEvaluateAllGroups: vi.fn() }));
vi.mock("../../src/agents/evaluator/run.js", () => ({
  evaluateAllGroups: (...args: unknown[]) => mockEvaluateAllGroups(...args),
}));

const { compareProviders, parseDescriptions, main } = await import("../../src/cli/bias.js");

// Two distinct no-op transports, used only as identity tokens: the mocked
// `evaluateAllGroups` below switches its returned results on which of these
// two it was called with (`deps.transport === transportA`), the same way a
// real call would differ by which provider's client actually ran.
const transportA: ParseTransport = async () => ({ parsed_output: null });
const transportB: ParseTransport = async () => ({ parsed_output: null });

function scored(checkId: string, band: 1 | 2 | 3 | 4 | 5): EvaluatedCheck {
  return { status: "scored", checkId, band, reason: "r", quotes: band < 4 ? ["q"] : [], missingEvidence: false };
}
function notEvaluated(checkId: string): EvaluatedCheck {
  return { status: "not_evaluated", checkId, reason: "group failed to evaluate" };
}

describe("parseDescriptions", () => {
  it("splits on blank lines and drops empty blocks", () => {
    const raw = "\nFirst description.\nStill first.\n\n\nSecond description.\n\n   \n";
    expect(parseDescriptions(raw)).toEqual(["First description.\nStill first.", "Second description."]);
  });
});

describe("compareProviders", () => {
  it("gives overall 1 and full per-check agreement when both transports agree on every check for every description", async () => {
    const rubric = await loadRubric("v1");
    mockEvaluateAllGroups.mockImplementation(async () => rubric.checks.map((c) => scored(c.id, 5)));

    const result = await compareProviders(
      { a: transportA, b: transportB },
      { rubric, descriptions: ["d1", "d2"] },
    );

    expect(result.overall).toBe(1);
    expect(result.n).toBe(rubric.checks.length * 2);
    expect(result.excluded).toBe(0);
    for (const check of rubric.checks) {
      expect(result.perCheck[check.id]).toEqual({ agree: 2, disagree: 0, excluded: 0, kappa: 1 });
    }
  });

  it("reports per-check disagreement on the pass/fail decision, not the raw band", async () => {
    const rubric = await loadRubric("v1");
    mockEvaluateAllGroups.mockImplementation(async (deps: { transport: ParseTransport }) => {
      const isA = deps.transport === transportA;
      return rubric.checks.map((c) =>
        // A always fails wardrobe (band 3), B always passes it (band 4): a
        // real disagreement, on opposite sides of the pass threshold.
        c.id === "wardrobe" ? scored(c.id, isA ? 3 : 4) : scored(c.id, 5),
      );
    });

    const result = await compareProviders(
      { a: transportA, b: transportB },
      { rubric, descriptions: ["d1", "d2", "d3"] },
    );

    const wardrobe = result.perCheck.wardrobe;
    expect(wardrobe).toBeDefined();
    expect(wardrobe?.agree).toBe(0);
    expect(wardrobe?.disagree).toBe(3);
    expect(wardrobe?.kappa).toBeLessThan(1);
    // Every other check still agrees fully.
    expect(result.perCheck.age_build).toEqual({ agree: 3, disagree: 0, excluded: 0, kappa: 1 });
    expect(result.overall).toBeLessThan(1);
  });

  it("treats an ordinal band difference on the same side of the pass threshold as agreement, not disagreement", async () => {
    const rubric = await loadRubric("v1");
    mockEvaluateAllGroups.mockImplementation(async (deps: { transport: ParseTransport }) => {
      const isA = deps.transport === transportA;
      // Both providers pass every check; they just pick different bands
      // (4 vs 5) above the threshold. That must never register as a
      // disagreement -- the product only acts on isPass(band).
      return rubric.checks.map((c) => scored(c.id, isA ? 4 : 5));
    });

    const result = await compareProviders(
      { a: transportA, b: transportB },
      { rubric, descriptions: ["d1"] },
    );

    expect(result.overall).toBe(1);
    for (const check of rubric.checks) {
      expect(result.perCheck[check.id]?.disagree).toBe(0);
    }
  });

  it("excludes a description-check pair when either transport's group failed to evaluate, and never counts it as agreement", async () => {
    const rubric = await loadRubric("v1");
    const lookIds = rubric.checks.filter((c) => c.group === "look").map((c) => c.id);
    mockEvaluateAllGroups.mockImplementation(async (deps: { transport: ParseTransport }) => {
      const isA = deps.transport === transportA;
      // B's "look" group fails to evaluate entirely on every call.
      return rubric.checks.map((c) =>
        !isA && c.group === "look" ? notEvaluated(c.id) : scored(c.id, 5),
      );
    });

    const result = await compareProviders(
      { a: transportA, b: transportB },
      { rubric, descriptions: ["d1"] },
    );

    expect(result.excluded).toBe(lookIds.length);
    expect(result.n).toBe(rubric.checks.length - lookIds.length);
    for (const id of lookIds) {
      // Unmeasured, not agreement: the check must not appear in perCheck at
      // all, and must never be counted toward n or overall.
      expect(result.perCheck[id]).toBeUndefined();
    }
    // The checks outside "look" were unaffected and still fully agree.
    for (const check of rubric.checks.filter((c) => c.group !== "look")) {
      expect(result.perCheck[check.id]).toEqual({ agree: 1, disagree: 0, excluded: 0, kappa: 1 });
    }
  });

  it("reports a check with zero comparable pairs as unmeasured, never as kappa 0", async () => {
    const rubric = await loadRubric("v1");
    mockEvaluateAllGroups.mockImplementation(async (deps: { transport: ParseTransport }) => {
      const isA = deps.transport === transportA;
      // wardrobe never evaluates on B, across every description.
      return rubric.checks.map((c) => (c.id === "wardrobe" && !isA ? notEvaluated(c.id) : scored(c.id, 5)));
    });

    const result = await compareProviders(
      { a: transportA, b: transportB },
      { rubric, descriptions: ["d1", "d2"] },
    );

    expect(result.perCheck.wardrobe).toBeUndefined();
    expect(result.excluded).toBe(2);
    expect(result.perCheck.age_build).toBeDefined();
  });
});

describe("main", () => {
  it("prints usage and returns 1 when no file is given", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => errors.push(String(msg));
    try {
      const code = await main(["node", "bias.ts"]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/usage/i);
    } finally {
      console.error = originalError;
    }
  });

  it("refuses to run without RUN_LIVE_API=1, before touching any file or API key", async () => {
    const previousLive = process.env.RUN_LIVE_API;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.RUN_LIVE_API;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => errors.push(String(msg));
    try {
      // A file that does not exist: if this ever got past the RUN_LIVE_API
      // gate it would throw on the missing path, not print this message --
      // so a passing test here proves the gate runs first.
      const code = await main(["node", "bias.ts", "/nonexistent/does-not-exist.txt"]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/RUN_LIVE_API/);
    } finally {
      console.error = originalError;
      if (previousLive !== undefined) process.env.RUN_LIVE_API = previousLive;
      if (previousAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOpenAi !== undefined) process.env.OPENAI_API_KEY = previousOpenAi;
    }
  });

  it("requires both API keys once RUN_LIVE_API=1 is set", async () => {
    const previousLive = process.env.RUN_LIVE_API;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOpenAi = process.env.OPENAI_API_KEY;
    process.env.RUN_LIVE_API = "1";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => errors.push(String(msg));
    try {
      const code = await main(["node", "bias.ts", "/nonexistent/does-not-exist.txt"]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/ANTHROPIC_API_KEY/);
      expect(errors.join("\n")).toMatch(/OPENAI_API_KEY/);
    } finally {
      console.error = originalError;
      if (previousLive === undefined) delete process.env.RUN_LIVE_API;
      else process.env.RUN_LIVE_API = previousLive;
      if (previousAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOpenAi !== undefined) process.env.OPENAI_API_KEY = previousOpenAi;
    }
  });

  it("reports no descriptions found without making any keys-gated call, when the file is empty", async () => {
    const previousLive = process.env.RUN_LIVE_API;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousOpenAi = process.env.OPENAI_API_KEY;
    process.env.RUN_LIVE_API = "1";
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.OPENAI_API_KEY = "test-key";

    const dir = await mkdtemp(path.join(tmpdir(), "bias-cli-"));
    const file = path.join(dir, "descriptions.txt");
    await writeFile(file, "\n\n   \n", "utf8");

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg?: unknown) => errors.push(String(msg));
    try {
      const code = await main(["node", "bias.ts", file]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/no descriptions/i);
    } finally {
      console.error = originalError;
      if (previousLive === undefined) delete process.env.RUN_LIVE_API;
      else process.env.RUN_LIVE_API = previousLive;
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAi;
    }
  });
});
