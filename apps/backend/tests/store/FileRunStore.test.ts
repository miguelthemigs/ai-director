import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRunStore } from "../../src/store/FileRunStore.js";

const manifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "running" as const,
  startedAt: "2026-09-10T10:00:00.000Z",
  passes: 0,
};

const roots: string[] = [];

async function newRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "runs-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileRunStore", () => {
  it("writes a manifest and reads it back", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    expect((await store.getRun("run-1")).rubricVersion).toBe("v1");
  });

  it("writes one file per pass and kind", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.writePass("run-1", 1, "eval", { results: [] });
    const raw = await readFile(path.join(root, "run-1", "pass-1-eval.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ results: [] });
  });

  it("records the terminal status and pass count", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.finishRun("run-1", "improved_still_failing", 3);
    const saved = await store.getRun("run-1");
    expect(saved.status).toBe("improved_still_failing");
    expect(saved.passes).toBe(3);
    expect(saved.finishedAt).toBeTruthy();
  });

  it("lists runs newest first", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.createRun({ ...manifest, runId: "run-2", startedAt: "2026-09-10T11:00:00.000Z" });
    expect((await store.listRuns()).map((r) => r.runId)).toEqual(["run-2", "run-1"]);
  });

  it("rejects when the run does not exist", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await expect(store.getRun("does-not-exist")).rejects.toThrow(/does-not-exist/);
  });

  it("rejects getRun when the manifest has an unknown status", async () => {
    const root = await newRoot();
    await mkdir(path.join(root, "run-bad-status"), { recursive: true });
    await writeFile(
      path.join(root, "run-bad-status", "manifest.json"),
      JSON.stringify({ ...manifest, runId: "run-bad-status", status: "totally_done" }),
      "utf8",
    );
    const store = new FileRunStore(root);
    await expect(store.getRun("run-bad-status")).rejects.toThrow(/run-bad-status/);
  });

  it("rejects getRun when the manifest is missing a required field", async () => {
    const root = await newRoot();
    const { passes: _passes, ...withoutPasses } = manifest;
    await mkdir(path.join(root, "run-missing-field"), { recursive: true });
    await writeFile(
      path.join(root, "run-missing-field", "manifest.json"),
      JSON.stringify({ ...withoutPasses, runId: "run-missing-field" }),
      "utf8",
    );
    const store = new FileRunStore(root);
    await expect(store.getRun("run-missing-field")).rejects.toThrow(/run-missing-field/);
  });

  /* ── Why readPasses exists ────────────────────────────────────────────────────────────
     Every pass has been written to disk since this store shipped, but nothing could read
     one back: the interface stopped at the manifest. So a finished run's results lived
     only in the server's in-memory `runViews` map, and any process restart -- a file save
     under `tsx watch`, a laptop closing -- lost every result the run had produced while
     its files sat right there on disk. */
  it("reads a run's passes back, eval and repair together, in pass order", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.writePass("run-1", 2, "eval", { description: "second", results: [] });
    await store.writePass("run-1", 1, "eval", { description: "first", results: [] });
    await store.writePass("run-1", 1, "repair", { from: "first", to: "second", rejected: [] });

    const passes = await store.readPasses("run-1");

    expect(passes.map((p) => p.pass)).toEqual([1, 2]);
    expect(passes[0]?.evaluation).toEqual({ description: "first", results: [] });
    expect(passes[0]?.repair).toEqual({ from: "first", to: "second", rejected: [] });
    // Pass 2 is the final pass, which never calls the Repairer, so it has no repair file.
    expect(passes[1]?.repair).toBeUndefined();
  });

  it("returns no passes for a run that has none, rather than failing", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    expect(await store.readPasses("run-1")).toEqual([]);
  });

  it("excludes a corrupt manifest from listRuns instead of throwing or including it", async () => {
    const root = await newRoot();
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await mkdir(path.join(root, "run-bad"), { recursive: true });
    await writeFile(
      path.join(root, "run-bad", "manifest.json"),
      JSON.stringify({ ...manifest, runId: "run-bad", status: "not_a_real_status" }),
      "utf8",
    );
    const runs = await store.listRuns();
    expect(runs.map((r) => r.runId)).toEqual(["run-1"]);
  });
});
