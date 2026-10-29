import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { labNew } from "../../src/lab/commands.js";
import { labCollect, redact, type TranscriptLine } from "../../src/lab/collect.js";
import { labReport } from "../../src/lab/metrics.js";
import { LabError } from "../../src/lab/runStore.js";
import { cleanLabEnvs, newLabEnv } from "./labEnv.js";

afterEach(cleanLabEnvs);

const PROJECTS = path.join(import.meta.dirname, "fixtures", "claude-projects");

describe("redact", () => {
  it("blanks keys, tokens and secrets", () => {
    const text = redact("ANTHROPIC_API_KEY=sk-ant-abc123 and Bearer abc.def and ghp_abcdefghijklmnopqrstu1234");
    expect(text).not.toContain("sk-ant");
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("ghp_");
    expect(text).toContain("[redacted]");
  });
});

describe("labCollect", () => {
  it("copies the lead and its subagents, one line per message, keys redacted", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "coordinator", brief: "an ad", url: null });
    const result = await labCollect(env, runId, ["s1"], PROJECTS);
    expect(result.files).toHaveLength(2);

    const raw = await readFile(path.join(env.root, runId, "transcript.jsonl"), "utf8");
    expect(raw).not.toContain("sk-ant-abc123");
    const lines = raw.trim().split("\n").map((line) => JSON.parse(line) as TranscriptLine);
    expect(lines.filter((line) => line.agent === "lead")).toHaveLength(5);
    expect(lines.filter((line) => line.agent === "lab-director")).toHaveLength(2);
    expect(lines.find((line) => line.text.startsWith("[tool] Bash"))).toBeDefined();
    expect(lines.find((line) => line.text.startsWith("[result]"))).toBeDefined();
  });

  it("counts an API request once, however many lines it has", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "coordinator", brief: "an ad", url: null });
    await labCollect(env, runId, ["s1"], PROJECTS);
    const metrics = await labReport(env, runId);
    expect(metrics.apiRequests).toBe(3);
    expect(metrics.tokens).toEqual({
      input: 360,
      output: 52,
      byAgent: { lead: { input: 130, output: 12 }, "lab-director": { input: 230, output: 40 } },
    });
    expect(metrics.invocations).toEqual({ lead: 1, "lab-director": 1 });
    expect(metrics.models.sort()).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(metrics.efforts).toEqual(["high"]);
  });

  it("refuses a session that is not there", async () => {
    const env = await newLabEnv();
    const { runId } = await labNew(env, { arch: "swarm", brief: "an ad", url: null });
    await expect(labCollect(env, runId, ["nope"], PROJECTS)).rejects.toBeInstanceOf(LabError);
  });
});
