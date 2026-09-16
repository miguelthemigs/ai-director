import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { StartRun } from "../../src/server/routes/runs.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";

/**
 * `POST /runs` carries the avatar id through to `startRun`.
 *
 * This is the link a code review found missing: prompt v2, `statedFactsFor` and the
 * version vocabulary all existed and all passed their own tests, and no request could
 * reach any of them, so every run recorded v1 and the Versions tab sealed a v2 nothing
 * could run. The unit tests did not catch it because each unit was correct.
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

function appWith(startRun: ReturnType<typeof vi.fn>) {
  return loadRubric("v1").then((rubric) =>
    buildApp({
      store: stubRunStore,
      rubric,
      startRun: startRun as unknown as StartRun,
      versionStore: stubVersionStore,
    }),
  );
}

describe("POST /runs and the avatar that grounds the Repairer", () => {
  it("hands the avatar id to startRun, which is what selects prompt v2", async () => {
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
      }),
    );
  });

  it("omits it entirely for a description that belongs to no avatar", async () => {
    const startRun = vi.fn().mockResolvedValue({});
    const app = await appWith(startRun);

    await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "A young man with wavy brown hair." },
    });

    // Absent, not undefined: absent is what the server reads as "blind v1", and it is the
    // honest reading of text somebody typed.
    const args = startRun.mock.calls[0]![0] as Record<string, unknown>;
    expect("avatarId" in args).toBe(false);
  });

  it("refuses an empty avatar id rather than treating it as absent", async () => {
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
});
