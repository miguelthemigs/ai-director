import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseTransport } from "../../src/api/client.js";
import { buildRetryVerbatim, coachDescription } from "../../src/orchestrate/coach.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileAvatarStore } from "../../src/store/AvatarStore.js";
import { FileRunStore } from "../../src/store/FileRunStore.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "coach-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Answers an evaluator call with the given band for every check named in its prompt. */
function evaluatorFake(band: 1 | 2 | 3 | 4 | 5, ids: string[]): ParseTransport {
  return async ({ system }) => ({
    parsed_output: {
      results: ids
        .filter((id) => system.includes(`Check ${id} `))
        .map((checkId) => ({ checkId, band, reason: "fake", quotes: [] })),
    },
  });
}

async function seed(description: string | null) {
  const avatars = new FileAvatarStore(path.join(dir, "avatars"));
  const record = await avatars.save({ imageBase64: "aGk=", mediaType: "image/png", source: "generated" });
  if (description !== null) {
    await avatars.attachDescription(record.id, { description });
  }
  return { avatars, id: record.id };
}

describe("coachDescription", () => {
  it("runs the coach on the avatar's description and reports a passed outcome", async () => {
    const rubric = await loadRubric("v1");
    const runs = new FileRunStore(path.join(dir, "runs"));
    const { avatars, id } = await seed("  A tall woman, short black hair.  ");
    const emit = vi.fn();

    const outcome = await coachDescription(
      {
        transport: evaluatorFake(5, rubric.checks.map((c) => c.id)),
        avatars,
        runs,
        rubric,
        emit,
      },
      { avatarId: id, runId: "run-1" },
    );

    expect(outcome).toEqual({
      avatarId: id,
      coachRunId: "run-1",
      status: "passed",
      description: "A tall woman, short black hair.",
      passed: true,
    });
    expect((await runs.getRun("run-1")).status).toBe("passed");
    expect(emit).toHaveBeenCalled();
  });

  it("is not passed when the run does not end passed", async () => {
    const rubric = await loadRubric("v1");
    const runs = new FileRunStore(path.join(dir, "runs"));
    const { avatars, id } = await seed("A woman.");
    // Every check fails without a quote: nothing is repairable, so nothing improves.
    const outcome = await coachDescription(
      { transport: evaluatorFake(2, rubric.checks.map((c) => c.id)), avatars, runs, rubric },
      { avatarId: id, runId: "run-2" },
    );
    expect(outcome.status).not.toBe("passed");
    expect(outcome.passed).toBe(false);
    expect(outcome.description).toBe("A woman.");
  });

  it("refuses an avatar that has not been described, and one that does not exist", async () => {
    const rubric = await loadRubric("v1");
    const runs = new FileRunStore(path.join(dir, "runs"));
    const { avatars, id } = await seed(null);
    const transport = vi.fn();
    await expect(
      coachDescription({ transport, avatars, runs, rubric }, { avatarId: id, runId: "r" }),
    ).rejects.toThrow(/not been described/);
    await expect(
      coachDescription({ transport, avatars, runs, rubric }, { avatarId: "nope", runId: "r" }),
    ).rejects.toThrow(/no character sheet/);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("buildRetryVerbatim", () => {
  it("throws on a retry that omits a check of the group", async () => {
    const rubric = await loadRubric("v1");
    const retry = buildRetryVerbatim(async () => ({ parsed_output: { results: [] } }));
    await expect(retry({ rubric, description: "x", group: rubric.checks[0]!.group })).rejects.toThrow(/missing result/);
  });
});
