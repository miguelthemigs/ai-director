import { describe, expect, it } from "vitest";
import { readComparisonSources, sha256 } from "../../src/compare/readSources.js";
import type { AvatarRecord, AvatarStore } from "../../src/store/AvatarStore.js";
import type { RunManifest, RunStore, StoredPass } from "../../src/store/RunStore.js";

const ORIGINAL = "A young man with wavy brown hair.";
const REPAIRED = "A young man with chestnut-brown wavy hair, shoulder-length, parted on the left.";

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

function stubRunStore(overrides: Partial<RunStore> = {}): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async () => MANIFEST,
    listRuns: async () => [MANIFEST],
    readPasses: async () => PASSES,
    ...overrides,
  };
}

function stubAvatarStore(record: AvatarRecord | null): AvatarStore {
  return {
    save: async () => {
      throw new Error("not used");
    },
    attachDescription: async () => {
      throw new Error("not used");
    },
    list: async () => (record ? [record] : []),
    get: async () => record,
    readImage: async () => null,
  };
}

const AVATAR: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-09-12T13:23:27.890Z",
  source: "generated",
  mediaType: "image/jpeg",
  description: ORIGINAL,
};

describe("sha256", () => {
  it("is 64 lowercase hex characters and differs for different text", () => {
    expect(sha256(ORIGINAL)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(ORIGINAL)).not.toBe(sha256(REPAIRED));
    expect(sha256(ORIGINAL)).toBe(sha256(ORIGINAL));
  });
});

describe("readComparisonSources", () => {
  it("takes before from pass 1 and after from the repaired final text", async () => {
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(AVATAR) },
      { runId: "run-1", avatarId: "avatar-1" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources.before.description).toBe(ORIGINAL);
    expect(result.sources.after.description).toBe(REPAIRED);
    expect(result.sources.before.descriptionSha256).toBe(sha256(ORIGINAL));
    expect(result.sources.after.descriptionSha256).toBe(sha256(REPAIRED));
  });

  it("carries the rubric version off the manifest and a null repairer version", async () => {
    const noVersion = { ...MANIFEST };
    delete (noVersion as { repairerPromptVersion?: string }).repairerPromptVersion;
    const result = await readComparisonSources(
      { runStore: stubRunStore({ getRun: async () => noVersion }), avatarStore: stubAvatarStore(AVATAR) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rubricVersion).toBe("v1");
    // Null means "this run predates the record", which is not the same claim as "v1".
    expect(result.repairerPromptVersion).toBeNull();
  });

  it("reads the repairer prompt version when a manifest records one", async () => {
    const withVersion = { ...MANIFEST, repairerPromptVersion: "v2" } as RunManifest;
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ getRun: async () => withVersion }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repairerPromptVersion).toBe("v2");
  });

  it("trusts the recorded avatarId over a description match when the manifest has one", async () => {
    // A run written since 2026-09-16 records which avatar it graded. That is the answer,
    // so a description that happens to differ (the same person re-described, say) no
    // longer refuses a comparison that is genuinely about that avatar.
    const recorded = { ...MANIFEST, avatarId: "avatar-1" } as RunManifest;
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ getRun: async () => recorded }),
        avatarStore: stubAvatarStore({ ...AVATAR, description: "re-described differently" }),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses when the recorded avatarId names a different person", async () => {
    const recorded = { ...MANIFEST, avatarId: "avatar-other" } as RunManifest;
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ getRun: async () => recorded }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("avatar-other") });
  });

  it("refuses a run whose description is not the avatar's", async () => {
    const other = { ...AVATAR, description: "Somebody else entirely." };
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(other) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/avatar/i) });
  });

  it("refuses an avatar with no description read off it yet", async () => {
    const undescribed = { ...AVATAR, description: undefined };
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(undescribed) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/description/i) });
  });

  it("refuses a run whose text never changed, rather than rendering the same prompt twice", async () => {
    const unrepaired: StoredPass[] = [{ pass: 1, evaluation: evaluation(ORIGINAL) }];
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ readPasses: async () => unrepaired }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/identical|unchanged/i) });
  });

  it("refuses a run with no passes on disk", async () => {
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ readPasses: async () => [] }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/pass/i) });
  });

  it("refuses a missing avatar and a missing run by name", async () => {
    const noAvatar = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(null) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(noAvatar).toEqual({ ok: false, reason: expect.stringContaining("avatar-1") });

    const noRun = await readComparisonSources(
      {
        runStore: stubRunStore({
          getRun: async () => {
            throw new Error("run missing-run not found");
          },
        }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "missing-run", avatarId: "avatar-1" },
    );
    expect(noRun).toEqual({ ok: false, reason: expect.stringContaining("missing-run") });
  });
});
