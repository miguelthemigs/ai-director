import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";

let root: string;
let store: FileComparisonStore;

const SOURCES = {
  before: {
    description: "The raw description.",
    descriptionSha256: "a".repeat(64),
    prompt: "WRAPPER\n\nThe raw description.\n\nTAIL",
  },
  after: {
    description: "The repaired description.",
    descriptionSha256: "b".repeat(64),
    prompt: "WRAPPER\n\nThe repaired description.\n\nTAIL",
  },
};

async function create() {
  return store.create({
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    rubricVersion: "v1",
    repairerPromptVersion: null,
    estimatedMicroUsd: 411_201,
    sources: SOURCES,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "comparisons-"));
  store = new FileComparisonStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("create", () => {
  it("writes a row with both sides queued, estimated and unbilled", async () => {
    const row = await create();

    expect(row.comparisonId).toMatch(/[0-9a-f-]{36}/);
    expect(row.before.status).toBe("queued");
    expect(row.after.status).toBe("queued");
    expect(row.before.taskId).toBeNull();
    expect(row.before.estimatedMicroUsd).toBe(411_201);
    expect(row.after.estimatedMicroUsd).toBe(411_201);
    expect(row.before.actualMicroUsd).toBeNull();
    expect(row.after.actualMicroUsd).toBeNull();
    expect(row.before.polls).toBe(0);
  });

  it("keeps each side's own description and hash", async () => {
    const row = await create();
    expect(row.before.description).toBe("The raw description.");
    expect(row.after.description).toBe("The repaired description.");
    expect(row.before.descriptionSha256).not.toBe(row.after.descriptionSha256);
    // The whole prompt, kept as sent, so a screen can show the two side by side.
    expect(row.before.prompt).toBe(SOURCES.before.prompt);
    expect(row.after.prompt).toBe(SOURCES.after.prompt);
  });

  it("stamps the provenance both sides share", async () => {
    const row = await create();
    expect(row.shotPromptVersion).toBe("v1");
    expect(row.before.rubricVersion).toBe("v1");
    expect(row.after.rubricVersion).toBe("v1");
    expect(row.before.repairerPromptVersion).toBeNull();
  });

  it("is readable back off disk", async () => {
    const row = await create();
    expect(await store.get(row.comparisonId)).toEqual(row);
  });
});

describe("claimSubmit", () => {
  it("succeeds once per side and refuses every later attempt", async () => {
    const row = await create();
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("claimed");
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("already_claimed");
    // The other side is a separate claim.
    expect(await store.claimSubmit(row.comparisonId, "after")).toBe("claimed");
  });

  it("survives a process restart, because the claim is a file and is never deleted", async () => {
    const row = await create();
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("claimed");

    const second = new FileComparisonStore(root);
    expect(await second.claimSubmit(row.comparisonId, "before")).toBe("already_claimed");
  });

  it("lets exactly one of many concurrent callers through", async () => {
    const row = await create();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.claimSubmit(row.comparisonId, "before")),
    );
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
  });
});

describe("stampTaskId and patchRender", () => {
  it("writes the task id to disk before anything else touches the row", async () => {
    const row = await create();
    await store.stampTaskId(row.comparisonId, "before", "task-1");

    const raw = JSON.parse(
      await readFile(path.join(root, row.comparisonId, "row.json"), "utf8"),
    ) as { before: { taskId: string; submittedAt: string } };
    expect(raw.before.taskId).toBe("task-1");
    expect(raw.before.submittedAt).toEqual(expect.any(String));
  });

  it("merges a patch onto one side and leaves the other untouched", async () => {
    const row = await create();
    await store.patchRender(row.comparisonId, "before", {
      status: "succeeded",
      actualMicroUsd: 410_000,
      finishedAt: "2026-09-16T10:00:00.000Z",
    });

    const after = await store.get(row.comparisonId);
    expect(after?.before.status).toBe("succeeded");
    expect(after?.before.actualMicroUsd).toBe(410_000);
    expect(after?.before.description).toBe("The raw description.");
    expect(after?.after.status).toBe("queued");
  });

  it("sets finishedAt on the comparison only when both sides are terminal", async () => {
    const row = await create();
    await store.patchRender(row.comparisonId, "before", { status: "succeeded" });
    expect((await store.get(row.comparisonId))?.finishedAt).toBeNull();

    await store.patchRender(row.comparisonId, "after", { status: "failed" });
    expect((await store.get(row.comparisonId))?.finishedAt).toEqual(expect.any(String));
  });

  it("throws for a comparison that does not exist, rather than writing a new one", async () => {
    await expect(store.patchRender("nope", "before", { status: "failed" })).rejects.toThrow(
      /nope/,
    );
  });
});

describe("clips", () => {
  it("round-trips bytes and their media type", async () => {
    const row = await create();
    await store.writeClip(row.comparisonId, "before", Buffer.from([1, 2, 3]), "video/mp4");

    const clip = await store.readClip(row.comparisonId, "before");
    expect(clip?.mediaType).toBe("video/mp4");
    expect([...(clip?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("returns null for a side with no clip", async () => {
    const row = await create();
    expect(await store.readClip(row.comparisonId, "after")).toBeNull();
  });
});

describe("list", () => {
  it("is empty for a store nothing has written to", async () => {
    expect(await new FileComparisonStore(path.join(root, "never")).list()).toEqual([]);
  });

  it("summarises newest first, and reports a pair total only when both sides billed", async () => {
    const first = await create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await create();

    await store.patchRender(first.comparisonId, "before", {
      status: "succeeded",
      actualMicroUsd: 410_000,
    });

    let rows = await store.list();
    expect(rows[0]?.comparisonId).toBe(second.comparisonId);
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.actualMicroUsd).toBeNull();
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.estimatedMicroUsd).toBe(
      822_402,
    );

    await store.patchRender(first.comparisonId, "after", {
      status: "succeeded",
      actualMicroUsd: 412_000,
    });
    rows = await store.list();
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.actualMicroUsd).toBe(822_000);
  });
});
