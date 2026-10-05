import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { StartRun } from "../../src/server/routes/runs.js";
import type { AvatarStore } from "../../src/store/AvatarStore.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";

/**
 * `POST /runs` only ever starts a grounded run.
 *
 * Every run starts from an avatar: render or upload the sheet, describe it, grade the
 * description, repair it. The route loads that avatar's sheet before answering, and refuses
 * the run when there is none, so the Repairer never runs blind (prompt v1, the one that
 * fabricated details on run `bee3bcd6`).
 */

const stubRunStore: RunStore = {
  createRun: async () => {},
  writePass: async () => {},
  finishRun: async () => {},
  getRun: async () => {
    throw new Error("not used");
  },
  listRuns: async () => [],
  readPasses: async () => [],
};

const stubVersionStore: VersionStore = {
  list: async () => [],
  get: async () => {
    throw new Error("not used");
  },
  compare: async () => {
    throw new Error("not used");
  },
};

/** One stored avatar, `avatar-1`, with a JPEG sheet and a brief. */
const avatarStore = {
  get: async (id: string) =>
    id === "avatar-1"
      ? {
          id,
          createdAt: "2026-10-05T00:00:00.000Z",
          source: "generated" as const,
          mediaType: "image/jpeg",
          authoredPrompt: "BUILD: about 1.78m",
        }
      : null,
  readImage: async (id: string) =>
    id === "avatar-1" ? { bytes: Buffer.from("jpeg"), mediaType: "image/jpeg" } : null,
} as unknown as AvatarStore;

function appWith(startRun: ReturnType<typeof vi.fn>, store: AvatarStore | null = avatarStore) {
  return loadRubric("v1").then((rubric) =>
    buildApp({
      store: stubRunStore,
      rubric,
      startRun: startRun as unknown as StartRun,
      versionStore: stubVersionStore,
      ...(store ? { avatar: { store } } : {}),
    }),
  );
}

describe("POST /runs and the avatar that grounds the Repairer", () => {
  it("hands startRun the avatar id and its loaded sheet and brief", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun);

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man with wavy brown hair.", avatarId: "avatar-1" },
    });

    expect(res.statusCode).toBe(202);
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "A young man with wavy brown hair.",
        avatarId: "avatar-1",
        grounding: {
          sheet: { imageBase64: Buffer.from("jpeg").toString("base64"), mediaType: "image/jpeg" },
          statedFacts: "BUILD: about 1.78m",
        },
      }),
    );
  });

  it("refuses a description with no avatar", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun);

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man with wavy brown hair." },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/avatarId/);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses an empty avatar id", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun);

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man.", avatarId: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses an avatar with no stored sheet instead of running the Repairer blind", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun);

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man.", avatarId: "avatar-gone" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/avatar-gone/);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("refuses every run when the server has no avatar store", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun, null);

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man.", avatarId: "avatar-1" },
    });

    expect(res.statusCode).toBe(422);
    expect(startRun).not.toHaveBeenCalled();
  });
});
