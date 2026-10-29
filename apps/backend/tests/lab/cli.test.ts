import { afterEach, describe, expect, it, vi } from "vitest";
import { runLabCli, type LabIo } from "../../src/cli/lab.js";
import type { LabEnv } from "../../src/lab/commands.js";
import { boardPlan } from "../orchestrate/director/planFixture.js";
import { cleanLabEnvs, newLabEnv, runWithBrief } from "./labEnv.js";

afterEach(cleanLabEnvs);

function io(env: LabEnv, stdin = "", environ: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const transport = vi.fn();
  const value: LabIo = {
    env,
    environ,
    stdin: async () => stdin,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    transport: () => transport,
  };
  return { value, out, err, transport, json: () => JSON.parse(out.join("")) };
}

describe("the lab CLI", () => {
  it("starts a run and prints its id", async () => {
    const env = await newLabEnv();
    const t = io(env);
    expect(await runLabCli(["new", "--arch", "coordinator", "--brief", "an ad for Apple"], t.value)).toBe(0);
    expect(t.json().runId).toMatch(/-coordinator$/);
  });

  it("saves a plan read from stdin", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    const t = io(env, JSON.stringify(boardPlan()));
    expect(await runLabCli(["save", id, "plan", "--by", "director"], t.value)).toBe(0);
    expect(t.json()).toEqual({ ok: true, file: "plan.1.json", attempt: 1 });
  });

  it("prints a refusal as { ok: false, error } and exits 1", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env);
    const t = io(env, "```json\n{}\n```");
    expect(await runLabCli(["save", id, "plan", "--by", "director"], t.value)).toBe(1);
    expect(t.json()).toMatchObject({ ok: false });
    expect(t.json().error).toContain("not a single JSON value");
  });

  it("exits 2 with the usage on an unknown command", async () => {
    const env = await newLabEnv();
    const t = io(env);
    expect(await runLabCli(["fly"], t.value)).toBe(2);
    expect(t.err.join("")).toContain("usage");
  });

  it("refuses the recipe without an API key, before any model call", async () => {
    const env = await newLabEnv();
    const id = await runWithBrief(env, "sequential");
    const t = io(env);
    expect(await runLabCli(["sequential", "ask", id], t.value)).toBe(1);
    expect(t.json().error).toContain("ANTHROPIC_API_KEY");
    expect(t.transport).not.toHaveBeenCalled();
  });

  it("prints the comparison as markdown, not JSON", async () => {
    const env = await newLabEnv();
    await runWithBrief(env);
    const t = io(env);
    expect(await runLabCli(["compare"], t.value)).toBe(0);
    expect(t.out.join("")).toContain("| Run | Architecture |");
  });
});
