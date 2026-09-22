import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";
import type { CompareRouteDeps } from "../../src/server/routes/compare.js";
import type { AvatarRecord, AvatarStore } from "../../src/store/AvatarStore.js";
import type { RunManifest, RunStore, StoredPass } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";
import type { VideoTransport } from "../../src/video/openrouterClient.js";

const ORIGINAL = "A young man with wavy brown hair.";
const REPAIRED = "A young man with chestnut-brown wavy hair, parted on the left.";

const MANIFEST: RunManifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "improved_still_failing",
  startedAt: "2026-09-12T13:38:30.943Z",
  finishedAt: "2026-09-12T13:39:08.735Z",
  passes: 2,
};

function evaluation(description: string) {
  return {
    description,
    results: [],
    failing: [],
    notEvaluated: [],
    spans: [],
    unverified: [],
    negativeConstraintPresent: true,
  };
}

const PASSES: StoredPass[] = [
  {
    pass: 1,
    evaluation: evaluation(ORIGINAL),
    repair: { from: ORIGINAL, to: REPAIRED, rejected: [] },
  },
  { pass: 2, evaluation: evaluation(REPAIRED) },
];

const AVATAR: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-09-12T13:23:27.890Z",
  source: "generated",
  mediaType: "image/jpeg",
  description: ORIGINAL,
};

function runStore(): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id) => {
      if (id !== "run-1") throw new Error(`run ${id} not found`);
      return MANIFEST;
    },
    listRuns: async () => [MANIFEST],
    readPasses: async () => PASSES,
  };
}

function avatarStore(): AvatarStore {
  return {
    save: async () => {
      throw new Error("not used");
    },
    attachDescription: async () => {
      throw new Error("not used");
    },
    list: async () => [AVATAR],
    get: async (id) => (id === "avatar-1" ? AVATAR : null),
    readImage: async () => null,
  };
}

const stubVersionStore: VersionStore = {
  list: async () => [],
  get: async () => {
    throw new Error("not used");
  },
  compare: async () => {
    throw new Error("not used");
  },
};

const transport: VideoTransport = {
  submit: async () => ({ taskId: "task-1" }),
  check: async (taskId) => ({
    taskId,
    status: "succeeded",
    failureCode: null,
    failure: null,
    actualMicroUsd: 410_000,
  }),
  fetchClip: async () => ({ bytes: Buffer.from([1, 2, 3]), mediaType: "video/mp4" }),
};

async function appWith(compare: CompareRouteDeps) {
  return buildApp({
    store: runStore(),
    rubric: await loadRubric("v1"),
    startRun: async () => {
      throw new Error("not used");
    },
    versionStore: stubVersionStore,
    compare,
  });
}

async function withDeps<T>(fn: (deps: CompareRouteDeps) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "compare-routes-"));
  try {
    return await fn({
      store: new FileComparisonStore(root),
      runStore: runStore(),
      avatarStore: avatarStore(),
      transport,
      drive: vi.fn(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BODY = { avatarId: "avatar-1", runId: "run-1", seconds: 4, size: "480x854" };

describe("POST /compare", () => {
  it("answers 202 with a queued pair and its estimate, and starts the drive", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.before.status).toBe("queued");
      expect(body.after.status).toBe("queued");
      expect(body.before.estimatedMicroUsd).toBe(411_201);
      expect(body.before.description).toBe(ORIGINAL);
      expect(body.after.description).toBe(REPAIRED);
      expect(deps.drive).toHaveBeenCalledWith(body.comparisonId);
    });
  });

  it("503s with a readable reason when no key built a transport", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({ ...deps, transport: undefined });
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("OPENROUTER_API_KEY");
    });
  });

  it("refuses a size that is not offered, and a duration outside 4..30", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);

      const badSize = await app.inject({
        method: "POST",
        url: "/compare",
        payload: { ...BODY, size: "1920x1080" },
      });
      expect(badSize.statusCode).toBe(400);

      for (const seconds of [3, 31, 4.5]) {
        const res = await app.inject({
          method: "POST",
          url: "/compare",
          payload: { ...BODY, seconds },
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  it("refuses a run that is not the avatar's, with the reason in the body", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({
        ...deps,
        avatarStore: {
          ...avatarStore(),
          get: async () => ({ ...AVATAR, description: "Somebody else." }),
        },
      });
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/avatar/i);
    });
  });

  it("spends nothing when validation fails", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      await app.inject({ method: "POST", url: "/compare", payload: { ...BODY, seconds: 99 } });
      expect(deps.drive).not.toHaveBeenCalled();
    });
  });
});

describe("GET /compare/preview", () => {
  it("returns both prompts, built by the same function the submit path uses, and spends nothing", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({
        method: "GET",
        url: "/compare/preview?avatarId=avatar-1&runId=run-1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sources.before.description).toBe(ORIGINAL);
      expect(body.sources.after.description).toBe(REPAIRED);
      // Each prompt carries its own description, wrapped in the shared shot wrapper.
      expect(body.sources.before.prompt).toContain(ORIGINAL);
      expect(body.sources.after.prompt).toContain(REPAIRED);
      expect(body.model).toBe("bytedance/seedance-2.5");
      expect(body.shotPromptVersion).toBe("v1");

      // The claim the whole screen rests on: strip each side's own description and the
      // remainders are byte-identical.
      expect(body.sources.before.prompt.replace(ORIGINAL, "")).toBe(
        body.sources.after.prompt.replace(REPAIRED, ""),
      );
      // Nothing was created and nothing was submitted.
      expect((await app.inject({ method: "GET", url: "/compare" })).json()).toEqual([]);
      expect(deps.drive).not.toHaveBeenCalled();
    });
  });

  it("answers without a transport, because reading what would be sent needs no key", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({ ...deps, transport: undefined });
      const res = await app.inject({
        method: "GET",
        url: "/compare/preview?avatarId=avatar-1&runId=run-1",
      });
      expect(res.statusCode).toBe(200);
    });
  });

  it("gives the same refusal POST would, free and before the money", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({
        ...deps,
        avatarStore: {
          ...avatarStore(),
          get: async () => ({ ...AVATAR, description: "Somebody else." }),
        },
      });
      const res = await app.inject({
        method: "GET",
        url: "/compare/preview?avatarId=avatar-1&runId=run-1",
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/avatar/i);
    });
  });

  it("needs both ids", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({ method: "GET", url: "/compare/preview?avatarId=avatar-1" });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("GET /compare and /compare/:id", () => {
  it("lists nothing for a fresh store and 404s an unknown id", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      expect((await app.inject({ method: "GET", url: "/compare" })).json()).toEqual([]);

      const missing = await app.inject({ method: "GET", url: "/compare/nope" });
      expect(missing.statusCode).toBe(404);
    });
  });

  it("returns a created row whole", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();

      const res = await app.inject({ method: "GET", url: `/compare/${created.comparisonId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().comparisonId).toBe(created.comparisonId);

      const list = (await app.inject({ method: "GET", url: "/compare" })).json();
      expect(list).toHaveLength(1);
      expect(list[0].estimatedMicroUsd).toBe(822_402);
    });
  });
});

describe("GET /compare/:id/:side/clip", () => {
  it("serves stored bytes with a range header, and 404s a side with no clip", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();
      await deps.store?.writeClip(
        created.comparisonId,
        "before",
        Buffer.from([9, 9]),
        "video/mp4",
      );

      const hit = await app.inject({
        method: "GET",
        url: `/compare/${created.comparisonId}/before/clip`,
      });
      expect(hit.statusCode).toBe(200);
      expect(hit.headers["content-type"]).toBe("video/mp4");
      expect(hit.headers["accept-ranges"]).toBe("bytes");

      const miss = await app.inject({
        method: "GET",
        url: `/compare/${created.comparisonId}/after/clip`,
      });
      expect(miss.statusCode).toBe(404);
      expect(miss.headers["cache-control"]).toBeUndefined();
    });
  });

  it("refuses a side that is not before or after", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({ method: "GET", url: "/compare/anything/sideways/clip" });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("POST /compare/:id/refresh", () => {
  it("re-reads an unfinished side without submitting anything", async () => {
    await withDeps(async (deps) => {
      const submit = vi.fn();
      const app = await appWith({ ...deps, transport: { ...transport, submit } });
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();
      await deps.store?.stampTaskId(created.comparisonId, "before", "task-1");

      const res = await app.inject({
        method: "POST",
        url: `/compare/${created.comparisonId}/refresh`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().before.status).toBe("succeeded");
      expect(submit).not.toHaveBeenCalled();
    });
  });
});
