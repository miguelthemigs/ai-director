import { appendFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
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

  it("hasRenderClaim reads a claim without taking it", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    expect(await store.hasRenderClaim(id, 1)).toBe(false);
    expect(await store.hasRenderClaim(id, 1)).toBe(false);
    expect(await store.claimRender(id, 1)).toBe("claimed");
    expect(await store.hasRenderClaim(id, 1)).toBe(true);
    expect(await store.hasRenderClaim(id, 2)).toBe(false);
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

  it("answers are replaced atomically, leaving no temp file behind", async () => {
    const { store, root } = await newStore();
    const id = await store.createRun("b");
    expect(await store.readAnswers(id)).toBeNull();
    const answers = { seconds: 15 } as unknown as GateAAnswers;
    await store.writeAnswers(id, answers);
    expect(await store.readAnswers(id)).toEqual(answers);
    // A crash after the write and before gate.resolved A must not lock gate A forever.
    const again = { seconds: 20 } as unknown as GateAAnswers;
    await store.writeAnswers(id, again);
    expect(await store.readAnswers(id)).toEqual(again);
    expect((await readdir(path.join(root, id))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
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

  it("listRuns keeps a billed attempt 1 after a not-billed render again", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    await store.append(id, { type: "render.submitted", attempt: 1, taskId: "t1", estimatedMicroUsd: 3_470_000 });
    await store.append(id, {
      type: "render.settled", attempt: 1, estimatedMicroUsd: 3_470_000, status: "failed",
      billing: "billed", actualMicroUsd: 1_200_000, failure: "moderated",
    });
    await store.append(id, { type: "run.finished", status: "render_failed", reason: "moderated" });
    await store.append(id, {
      type: "render.settled", attempt: 2, estimatedMicroUsd: 3_470_000, status: "failed",
      billing: "not_billed", actualMicroUsd: null, failure: "refused",
    });
    expect((await store.listRuns())[0]).toMatchObject({ id, billedMicroUsd: 1_200_000 });
  });

  it("listRuns shows 0, not null, for a billed attempt whose cost was not reported", async () => {
    const { store } = await newStore();
    const id = await store.createRun("b");
    await store.append(id, {
      type: "render.settled", attempt: 1, estimatedMicroUsd: 1, status: "succeeded",
      billing: "billed", actualMicroUsd: null, failure: null,
    });
    expect((await store.listRuns())[0]).toMatchObject({ id, billedMicroUsd: 0 });
  });

  it("survives a torn final line: events, append and listRuns keep working", async () => {
    const { store, root } = await newStore();
    const id = await store.createRun("b");
    await store.append(id, { type: "gate.opened", gate: "A" });
    const file = path.join(root, id, "events.jsonl");
    await appendFile(file, '{"type":"gate.opened","ga');
    expect((await store.events(id)).map((e) => e.seq)).toEqual([1, 2]);
    const next = await store.append(id, { type: "gate.opened", gate: "B" });
    expect(next.seq).toBe(3);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3]);
    expect((await store.listRuns()).map((r) => r.id)).toEqual([id]);
  });

  it("a complete final line without a newline stays separate from the next append", async () => {
    const { store, root } = await newStore();
    const id = await store.createRun("b");
    const file = path.join(root, id, "events.jsonl");
    const raw = await readFile(file, "utf8");
    await rm(file);
    await appendFile(file, raw.trimEnd());
    const next = await store.append(id, { type: "gate.opened", gate: "A" });
    expect(next.seq).toBe(2);
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2]);
  });

  it("mid-file corruption still throws", async () => {
    const { store, root } = await newStore();
    const id = await store.createRun("b");
    const file = path.join(root, id, "events.jsonl");
    const raw = await readFile(file, "utf8");
    await rm(file);
    await appendFile(file, `garbage\n${raw}`);
    await expect(store.events(id)).rejects.toThrow();
  });
});
