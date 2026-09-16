import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  driveComparison,
  refreshComparison,
  startComparison,
} from "../../src/compare/runComparison.js";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";
import type { VideoTaskResult, VideoTransport } from "../../src/video/openrouterClient.js";
import { OpenRouterHttpError } from "../../src/video/openrouterClient.js";

const START = {
  avatarId: "avatar-1",
  runId: "run-1",
  seconds: 4,
  size: "480x854",
  rubricVersion: "v1",
  repairerPromptVersion: null,
  sources: {
    before: { description: "The raw description.", descriptionSha256: "a".repeat(64) },
    after: { description: "The repaired description.", descriptionSha256: "b".repeat(64) },
  },
} as const;

function terminal(taskId: string, over: Partial<VideoTaskResult> = {}): VideoTaskResult {
  return {
    taskId,
    status: "succeeded",
    failureCode: null,
    failure: null,
    actualMicroUsd: 410_000,
    ...over,
  };
}

function fakeTransport(over: Partial<VideoTransport> = {}): VideoTransport {
  let submitted = 0;
  return {
    submit: vi.fn(async () => ({ taskId: `task-${++submitted}` })),
    check: vi.fn(async (taskId: string) => terminal(taskId)),
    fetchClip: vi.fn(async () => ({ bytes: Buffer.from([1, 2]), mediaType: "video/mp4" })),
    ...over,
  };
}

async function withStore<T>(fn: (store: FileComparisonStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "compare-run-"));
  try {
    return await fn(new FileComparisonStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const NO_SLEEP = async () => {};

describe("startComparison", () => {
  it("creates the row with the derived estimate and the shot prompt version, and calls nothing", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);

      expect(row.before.estimatedMicroUsd).toBe(411_201);
      expect(row.after.estimatedMicroUsd).toBe(411_201);
      expect(row.model).toBe("bytedance/seedance-2.5");
      expect(row.shotPromptVersion).toBe("v1");
      expect(transport.submit).not.toHaveBeenCalled();
    });
  });
});

describe("driveComparison", () => {
  it("submits both sides with the same wrapper, the same size and the same seconds", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      const calls = (transport.submit as ReturnType<typeof vi.fn>).mock.calls.map(
        ([req]) => req as Record<string, unknown>,
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]?.size).toBe("480x854");
      expect(calls[0]?.duration).toBe(4);
      expect(calls[0]?.generate_audio).toBe(false);
      expect(calls[0]?.model).toBe("bytedance/seedance-2.5");
      expect(calls[0]?.size).toBe(calls[1]?.size);
      expect(calls[0]?.duration).toBe(calls[1]?.duration);

      // The ONLY difference between the two prompts is the description.
      const prompts = calls.map((c) => String(c.prompt));
      const beforePrompt = prompts.find((p) => p.includes("The raw description.")) ?? "";
      const afterPrompt = prompts.find((p) => p.includes("The repaired description.")) ?? "";
      expect(beforePrompt.replace("The raw description.", "")).toBe(
        afterPrompt.replace("The repaired description.", ""),
      );
      expect(beforePrompt).not.toBe("");
      expect(afterPrompt).not.toBe("");
    });
  });

  it("never sends an image reference", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      for (const [req] of (transport.submit as ReturnType<typeof vi.fn>).mock.calls) {
        expect(JSON.stringify(req)).not.toContain("input_references");
        expect(JSON.stringify(req)).not.toContain("frame_images");
      }
    });
  });

  it("stamps the task id before the first status read", async () => {
    await withStore(async (store) => {
      // The property: at the moment a task is polled, that task's id is ALREADY on disk.
      // A status read that runs before the stamp lands means a crash mid-poll would leave
      // a paid render with no id recorded anywhere.
      const onDiskAtCheck: boolean[] = [];
      let rowId = "";
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => {
          const current = await store.get(rowId);
          onDiskAtCheck.push(
            current?.before.taskId === taskId || current?.after.taskId === taskId,
          );
          return terminal(taskId);
        }),
      });
      const created = await startComparison({ store, transport }, START);
      rowId = created.comparisonId;
      await driveComparison({ store, transport, sleep: NO_SLEEP }, rowId);

      expect(onDiskAtCheck).toHaveLength(2);
      expect(onDiskAtCheck.every(Boolean)).toBe(true);
    });
  });

  it("stores the clip bytes and points the row at this server's own path", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("succeeded");
      expect(done.before.clipUrl).toBe(`/compare/${row.comparisonId}/before/clip`);
      expect(done.after.clipUrl).toBe(`/compare/${row.comparisonId}/after/clip`);
      expect(done.before.clipUrl).not.toContain("openrouter.ai");
      expect((await store.readClip(row.comparisonId, "before"))?.mediaType).toBe("video/mp4");
    });
  });

  it("records the vendor's bill without touching the estimate", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => terminal(taskId, { actualMicroUsd: 398_500 })),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.actualMicroUsd).toBe(398_500);
      expect(done.before.estimatedMicroUsd).toBe(411_201);
    });
  });

  it("leaves actualMicroUsd null when the terminal task reported no cost, never zero", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => terminal(taskId, { actualMicroUsd: null })),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);
      expect(done.before.actualMicroUsd).toBeNull();
    });
  });

  it("counts polls, so the screen can show progress without a spinner", async () => {
    await withStore(async (store) => {
      let reads = 0;
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          ++reads < 6
            ? terminal(taskId, { status: "running", actualMicroUsd: null })
            : terminal(taskId),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);
      expect(done.before.polls).toBeGreaterThan(1);
      expect(done.after.polls).toBeGreaterThan(1);
    });
  });

  it("finishes the losing side even when the other side's submit throws", async () => {
    await withStore(async (store) => {
      // Keyed to the SIDE, not to call order: both sides submit concurrently by design,
      // so "the first call" is whichever one won the race that run.
      const transport = fakeTransport({
        submit: vi.fn(async (req: { prompt: string }) => {
          if (req.prompt.includes("The raw description.")) {
            throw new OpenRouterHttpError("size not supported", 400);
          }
          return { taskId: "task-2" };
        }),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("failed");
      expect(done.before.failure).toContain("size not supported");
      expect(done.after.status).toBe("succeeded");
      expect(done.finishedAt).toEqual(expect.any(String));
    });
  });

  it("NEVER resubmits a side whose claim is held with no task id", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);

      // Simulate a process that died between claiming and stamping.
      await store.claimSubmit(row.comparisonId, "before");

      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("failed");
      expect(done.before.failureCode).toBe("OPENROUTER_UNKNOWN_OUTCOME");
      expect(done.before.failure).toMatch(/unknown|resubmit/i);
      expect((transport.submit as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  it("settles a side failed on the deadline but keeps its task id", async () => {
    await withStore(async (store) => {
      let clock = 0;
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          terminal(taskId, { status: "running", actualMicroUsd: null }),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison(
        {
          store,
          transport,
          sleep: async () => {
            clock += 60_000;
          },
          now: () => clock,
        },
        row.comparisonId,
      );

      expect(done.before.status).toBe("failed");
      expect(done.before.failureCode).toBe("OPENROUTER_POLL_TIMEOUT");
      expect(done.before.taskId).not.toBeNull();
    });
  });

  it("does not treat a cancelled clip as a success", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          terminal(taskId, { status: "cancelled", actualMicroUsd: null }),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("cancelled");
      expect(done.before.clipUrl).toBeNull();
      expect(transport.fetchClip).not.toHaveBeenCalled();
    });
  });

  it("keeps the render succeeded when the clip download fails, and says the clip is missing", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        fetchClip: vi.fn(async () => {
          throw new OpenRouterHttpError("gone", 404);
        }),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      // The render happened and was billed. Calling it failed would misreport the bill.
      expect(done.before.status).toBe("succeeded");
      expect(done.before.clipUrl).toBeNull();
      expect(done.before.failureCode).toBe("CLIP_DOWNLOAD_FAILED");
    });
  });
});

describe("refreshComparison", () => {
  it("takes one status read per unfinished side and leaves finished ones alone", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await store.stampTaskId(row.comparisonId, "before", "task-1");
      await store.patchRender(row.comparisonId, "after", {
        status: "succeeded",
        actualMicroUsd: 410_000,
      });

      const done = await refreshComparison({ store, transport }, row.comparisonId);

      expect((transport.check as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(done.before.status).toBe("succeeded");
    });
  });

  it("never rewrites a billed, succeeded render into a failure", async () => {
    // The CLIP_DOWNLOAD_FAILED shape: the render HAPPENED and WAS BILLED, and only the
    // bytes are missing. A later status read is not better evidence about a settled past;
    // OpenRouter may answer `expired` by then, which classifies as failed and carries no
    // cost, so re-checking would rewrite a $0.41 render as a free failure.
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          terminal(taskId, { status: "failed", failureCode: "EXPIRED", actualMicroUsd: null }),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      await store.stampTaskId(row.comparisonId, "before", "task-1");
      await store.patchRender(row.comparisonId, "before", {
        status: "succeeded",
        actualMicroUsd: 410_000,
        failureCode: "CLIP_DOWNLOAD_FAILED",
        failure: "the render succeeded and was billed, but its clip could not be downloaded",
      });

      const done = await refreshComparison({ store, transport }, row.comparisonId);

      expect(done.before.status).toBe("succeeded");
      expect(done.before.actualMicroUsd).toBe(410_000);
      expect(transport.check).not.toHaveBeenCalled();
      // The clip alone is retried, which is the one thing that could still change.
      expect(transport.fetchClip).toHaveBeenCalled();
      expect(done.before.clipUrl).toBe(`/compare/${row.comparisonId}/before/clip`);
    });
  });

  it("settles a side whose claim is held with no task id, instead of polling it forever", async () => {
    // A process that died between claiming and stamping. `driveComparison` only ever runs
    // on a freshly created row, so nothing else can reach this side: without this it stays
    // `queued` for good and the screen polls it for the life of the tab.
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await store.claimSubmit(row.comparisonId, "before");

      const done = await refreshComparison({ store, transport }, row.comparisonId);

      expect(done.before.status).toBe("failed");
      expect(done.before.failureCode).toBe("OPENROUTER_UNKNOWN_OUTCOME");
      expect(transport.submit).not.toHaveBeenCalled();
    });
  });

  it("does not take the claim for a side nobody ever submitted", async () => {
    // Probing must not become claiming: a claim taken here would permanently block a
    // submit that has every right to happen later.
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);

      await refreshComparison({ store, transport }, row.comparisonId);

      expect(await store.isSubmitClaimed(row.comparisonId, "before")).toBe(false);
      expect((await store.get(row.comparisonId))?.before.status).toBe("queued");
      // And a real drive afterwards still works.
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);
      expect(done.before.status).toBe("succeeded");
    });
  });

  it("never submits, even for a side that was never claimed", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await refreshComparison({ store, transport }, row.comparisonId);
      expect(transport.submit).not.toHaveBeenCalled();
    });
  });
});
