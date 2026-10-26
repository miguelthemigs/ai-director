import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GateAAnswers } from "@ai-director/contract";
import { FileDirectorRunStore } from "../../src/store/FileDirectorRunStore.js";

const roots: string[] = [];
async function newStore(): Promise<{ store: FileDirectorRunStore; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "director-runs-"));
  roots.push(root);
  return { store: new FileDirectorRunStore(root), root };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("FileDirectorRunStore", () => {
  it("createRun writes run.started as seq 1", async () => {
    const { store } = await newStore();
    const id = await store.createRun("a brief");
    const events = await store.events(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.started", brief: "a brief", seq: 1, runId: id });
  });

  it("20 concurrent appends get seqs 1..20 with 20 lines on disk", async () => {
    const { store, root } = await newStore();
    const id = await store.createRun("b");
    const done = await Promise.all(
      Array.from({ length: 19 }, () => store.append(id, { type: "gate.opened", gate: "A" })),
    );
    expect(done.map((e) => e.seq).sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, i) => i + 2));
    const lines = (await readFile(path.join(root, id, "events.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(20);
    expect((await store.events(id)).map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("events(id, 5) returns seq 6 and later", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    for (let i = 0; i < 9; i++) await store.append(id, { type: "gate.opened", gate: "A" });
    expect((await store.events(id, 5)).map((e) => e.seq)).toEqual([6, 7, 8, 9, 10]);
  });

  it("claimRender is claimed once, then already_claimed", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    expect(await store.claimRender(id, 1)).toBe("claimed");
    expect(await store.claimRender(id, 1)).toBe("already_claimed");
    expect(await store.claimRender(id, 2)).toBe("claimed");
  });

  it("outputs and assets round-trip; traversal refs and names are rejected", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    const ref = await store.writeOutput(id, "director", 2, { a: 1 });
    expect(ref).toBe("nodes/director.2.json");
    expect(await store.readOutput(id, ref)).toEqual({ a: 1 });
    const asset = await store.saveAsset(id, "pic.png", Buffer.from([1, 2, 3]));
    expect(asset).toBe("assets/pic.png");
    expect([...(await store.readAsset(id, asset))]).toEqual([1, 2, 3]);
    await expect(store.readOutput(id, "../manifest.json")).rejects.toThrow();
    await expect(store.readOutput(id, "nodes/../../manifest.json")).rejects.toThrow();
    await expect(store.readAsset(id, "assets/../manifest.json")).rejects.toThrow();
    await expect(store.saveAsset(id, "../evil.png", Buffer.from([1]))).rejects.toThrow();
  });

  it("answers are written once", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    expect(await store.readAnswers(id)).toBeNull();
    const answers = { seconds: 15 } as unknown as GateAAnswers;
    await store.writeAnswers(id, answers);
    expect(await store.readAnswers(id)).toEqual(answers);
    await expect(store.writeAnswers(id, answers)).rejects.toThrow();
  });

  it("listRuns is newest first, carries waitingAt and billedMicroUsd", async () => {
    const { store } = await newStore();
    const first = await store.createRun("first");
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.createRun("second");
    await store.append(second, { type: "gate.opened", gate: "A" });
    const runs = await store.listRuns();
    expect(runs.map((r) => r.id)).toEqual([second, first]);
    expect(runs[0]).toMatchObject({ brief: "second", waitingAt: "A", billedMicroUsd: null });
    expect(await store.listIds()).toEqual(expect.arrayContaining([first, second]));
  });
});
