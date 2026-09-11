import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PassResult } from "../../src/orchestrate/runPass.js";
import { loadRubric } from "../../src/rubric/load.js";

// The orchestrator is mocked at the module level, not injected through
// `main`'s signature -- `main(argv: string[]): Promise<number>` is the
// interface this task's spec fixes, so a throwing dependency has to be
// simulated without adding a test-only parameter to it. `runToCompletion`
// itself is never invoked by any other test in this file (the `main` tests
// below all return before constructing it), so mocking it here does not
// affect them. `vi.hoisted` is required because `vi.mock`'s factory runs
// before any local `const` would otherwise be initialized.
const { mockRunToCompletion } = vi.hoisted(() => ({ mockRunToCompletion: vi.fn() }));
vi.mock("../../src/orchestrate/runToCompletion.js", () => ({
  runToCompletion: (...args: unknown[]) => mockRunToCompletion(...args),
}));

const { formatPassResult, main } = await import("../../src/cli/score.js");

// A base PassResult with every field the type requires, so each test only
// overrides what it cares about instead of re-typing the whole shape.
function basePassResult(overrides: Partial<PassResult> & Pick<PassResult, "results">): PassResult {
  return {
    pass: 1,
    description: "x",
    failing: [],
    notEvaluated: [],
    spans: [],
    unverified: [],
    negativeConstraintPresent: false,
    rejected: [],
    ...overrides,
  };
}

describe("formatPassResult", () => {
  it("prints every check as a percentage with its quote", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      basePassResult({
        pass: 1,
        description: "A lean man with a very cinematic presence.",
        results: rubric.checks.map((c) =>
          c.id === "drawable_only"
            ? {
                status: "scored" as const,
                checkId: c.id,
                band: 2 as const,
                reason: "mood word",
                quotes: ["very cinematic presence"],
                missingEvidence: false,
              }
            : {
                status: "scored" as const,
                checkId: c.id,
                band: 5 as const,
                reason: "fine",
                quotes: [],
                missingEvidence: false,
              },
        ),
        failing: ["drawable_only"],
      }),
      rubric,
    );
    expect(out).toContain("drawable_only");
    expect(out).toContain("40%");
    expect(out).toContain("very cinematic presence");
    expect(out).toContain("100%");
  });

  it("flags unverified quotes rather than hiding them", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      basePassResult({
        results: rubric.checks.map((c) => ({
          status: "scored" as const,
          checkId: c.id,
          band: 5 as const,
          reason: "r",
          quotes: [],
          missingEvidence: false,
        })),
        failing: [],
        unverified: [{ checkId: "wardrobe", quote: "paraphrased", reason: "not_found" }],
      }),
      rubric,
    );
    expect(out).toMatch(/unverified quote/i);
    expect(out).toContain("paraphrased");
  });

  it("prints a not_evaluated check as not evaluated, never as a percentage", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      basePassResult({
        results: rubric.checks.map((c) =>
          c.id === "wardrobe"
            ? { status: "not_evaluated" as const, checkId: c.id, reason: "group safety failed to evaluate: boom" }
            : {
                status: "scored" as const,
                checkId: c.id,
                band: 5 as const,
                reason: "r",
                quotes: [],
                missingEvidence: false,
              },
        ),
        failing: ["wardrobe"],
        notEvaluated: ["wardrobe"],
      }),
      rubric,
    );
    expect(out).toMatch(/wardrobe.*not evaluated/is);
    const wardrobeLine = out.split("\n").find((line) => line.includes("wardrobe"));
    expect(wardrobeLine).toBeDefined();
    expect(wardrobeLine).not.toMatch(/\d+%/);
  });

  it("prints every one of the nine checks, never fewer", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      basePassResult({
        results: rubric.checks.map((c) => ({
          status: "scored" as const,
          checkId: c.id,
          band: 5 as const,
          reason: "r",
          quotes: [],
          missingEvidence: false,
        })),
      }),
      rubric,
    );
    for (const check of rubric.checks) expect(out).toContain(check.id);
  });

  it("never lets a failing run read as success", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      basePassResult({
        results: rubric.checks.map((c) => ({
          status: "scored" as const,
          checkId: c.id,
          band: 2 as const,
          reason: "r",
          quotes: ["something"],
          missingEvidence: false,
        })),
        failing: rubric.checks.map((c) => c.id),
      }),
      rubric,
    );
    expect(out).not.toMatch(/\bdone\b/i);
    expect(out).not.toMatch(/\bcomplete\b/i);
    expect(out).not.toContain("✓");
  });
});

describe("main", () => {
  it("fails with a clear message, not a stack trace, when ANTHROPIC_API_KEY is absent", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const code = await main(["node", "score.ts", "some-file.txt"]);
      expect(code).not.toBe(0);
      expect(errors.join("\n")).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      console.error = originalError;
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("returns exit code 1 and prints usage when no file is given", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const code = await main(["node", "score.ts"]);
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(/usage/i);
    } finally {
      console.error = originalError;
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("resolves to 2, prints the error message (not a stack trace), and still prints the run path, when the orchestrator throws", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";

    const dir = await mkdtemp(path.join(tmpdir(), "score-cli-"));
    const file = path.join(dir, "description.txt");
    await writeFile(file, "A lean man with a calm expression.", "utf8");

    mockRunToCompletion.mockRejectedValueOnce(new Error("simulated failure: rate limited"));

    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (msg?: unknown) => logs.push(String(msg));
    console.error = (msg?: unknown) => errors.push(String(msg));

    try {
      const code = await main(["node", "score.ts", file]);
      const combined = [...logs, ...errors].join("\n");

      expect(code).toBe(2);
      expect(combined).toContain("simulated failure: rate limited");
      // No stack trace: an Error's stack carries indented "at ..." frames,
      // which nothing we print deliberately includes.
      expect(combined).not.toContain("\n    at ");
      expect(combined).toMatch(/run: data\/runs\//);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
