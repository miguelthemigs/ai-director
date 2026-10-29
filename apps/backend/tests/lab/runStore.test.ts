import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTrace, createRun, readRun, readTrace, LabError } from "../../src/lab/runStore.js";

const roots: string[] = [];
async function newRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lab-store-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const NOW = new Date("2026-10-29T12:34:56Z");

describe("the lab run store", () => {
  it("creates a running run with every counter at zero", async () => {
    const root = await newRoot();
    const run = await createRun(root, { arch: "sequential", brief: "an ad for Apple", url: null, now: NOW });

    expect(run.id).toMatch(/^\d{8}-\d{6}-sequential$/);
    expect(run.id).toBe("20261029-123456-sequential");
    expect(run.status).toBe("running");
    expect(run.attempts).toEqual({ plan: 0, cameras: 0 });
    expect(Object.values(run.refusedInARow).every((n) => n === 0)).toBe(true);
    expect(Object.values(run.refusedTotal).every((n) => n === 0)).toBe(true);
    expect(run.lastChecks).toEqual({ plan: null, shots: null });
    expect(run.pendingReshoot).toBeNull();

    const onDisk = JSON.parse(await readFile(path.join(root, run.id, "run.json"), "utf8"));
    expect(onDisk).toEqual(run);
  });

  it("gives two runs started in the same second distinct ids", async () => {
    const root = await newRoot();
    const first = await createRun(root, { arch: "swarm", brief: "a", url: null, now: NOW });
    const second = await createRun(root, { arch: "swarm", brief: "b", url: null, now: NOW });
    expect(second.id).not.toBe(first.id);
    expect(second.id).toBe("20261029-123456-2-swarm");
  });

  it("appends trace lines in order, each stamped with the time", async () => {
    const root = await newRoot();
    const run = await createRun(root, { arch: "coordinator", brief: "a", url: null, now: NOW });
    await appendTrace(root, run.id, { actor: "director", kind: "save", text: "plan 1" });
    await appendTrace(root, run.id, { actor: "lab", kind: "check", text: "plan checks: 5 of 5 passed" });

    const trace = await readTrace(root, run.id);
    expect(trace.map((line) => line.text)).toEqual(["plan 1", "plan checks: 5 of 5 passed"]);
    expect(trace.every((line) => typeof line.at === "string" && line.at.length > 0)).toBe(true);
  });

  it("refuses to read a run that does not exist", async () => {
    const root = await newRoot();
    await expect(readRun(root, "20261029-000000-swarm")).rejects.toBeInstanceOf(LabError);
  });
});
