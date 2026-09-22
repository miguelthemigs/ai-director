import { createHash } from "node:crypto";
import type { ComparisonSide } from "@ai-director/contract";
import { rebuildRunView } from "../present/rebuildRunView.js";
import { buildShotPrompt } from "../video/shotPrompt/v1.js";
import type { AvatarStore } from "../store/AvatarStore.js";
import type { ComparisonSource } from "../store/ComparisonStore.js";
import type { RunStore } from "../store/RunStore.js";

/**
 * Where the two descriptions come from, and what has to be true before either is rendered.
 *
 * ── Why this goes through `rebuildRunView` ──────────────────────────────────────────
 * "The original text" and "the text as it finished" are already derived there, the same
 * way the live path derives them, and that file's own header explains why a second
 * assembler is worse than none: two derivations drift, and a comparison built on a
 * drifted "after" is a measurement of the drift.
 *
 * ── Why the avatar is checked against the run ───────────────────────────────────────
 * The avatar's sheet is shown beside the two clips as the reference of what the person is
 * meant to look like. If the run came from a different avatar the whole screen is a lie,
 * and nothing about it would look wrong. The run store records no avatar id, so the link
 * is the one fact that ties them: the run's original description is exactly what the
 * describe step wrote onto the avatar record.
 *
 * ── Why an unrepaired run is refused ────────────────────────────────────────────────
 * A run that passed on pass 1 has no "after". Rendering it would spend about $0.82 on two
 * identical prompts and produce two clips whose only difference is the seed.
 */

/** The discriminator that works with no version record at all: two descriptions produced
 *  by two prompt versions hash differently, and the full text is stored beside the hash. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type ComparisonSourcesResult =
  | {
      ok: true;
      sources: Record<ComparisonSide, ComparisonSource>;
      rubricVersion: string;
      repairerPromptVersion: string | null;
    }
  | { ok: false; reason: string };

export type ReadSourcesDeps = {
  runStore: RunStore;
  avatarStore: AvatarStore;
};

export async function readComparisonSources(
  deps: ReadSourcesDeps,
  args: { runId: string; avatarId: string },
): Promise<ComparisonSourcesResult> {
  const avatar = await deps.avatarStore.get(args.avatarId);
  if (!avatar) return { ok: false, reason: `avatar "${args.avatarId}" not found` };
  if (!avatar.description) {
    return {
      ok: false,
      reason: `avatar "${args.avatarId}" has no description read off it yet`,
    };
  }

  let manifest;
  try {
    manifest = await deps.runStore.getRun(args.runId);
  } catch {
    return { ok: false, reason: `run "${args.runId}" not found` };
  }

  const passes = await deps.runStore.readPasses(args.runId);
  if (passes.length === 0) {
    return { ok: false, reason: `run "${args.runId}" has no completed pass on disk` };
  }

  const view = rebuildRunView(manifest, passes);

  // Which avatar a run graded is now RECORDED on the manifest, so when it is there it is
  // the answer and no inference is needed. For runs written before 2026-09-16 the field is
  // absent, and the only link is the one that was always true: the run's original
  // description is exactly what the describe step wrote onto the avatar record. Both
  // paths refuse rather than guess, because a comparison built from a different person's
  // run looks completely normal on screen.
  const recordedAvatar = (manifest as { avatarId?: unknown }).avatarId;
  if (typeof recordedAvatar === "string") {
    if (recordedAvatar !== args.avatarId) {
      return {
        ok: false,
        reason: `run "${args.runId}" graded avatar "${recordedAvatar}", not "${args.avatarId}"`,
      };
    }
  } else if (view.originalDescription !== avatar.description) {
    return {
      ok: false,
      reason: `run "${args.runId}" did not come from avatar "${args.avatarId}": its original description is not the one stored on that avatar`,
    };
  }

  if (view.finalDescription === view.originalDescription) {
    return {
      ok: false,
      reason: `run "${args.runId}" repaired nothing, so its before and after are identical and rendering both would pay twice for one clip`,
    };
  }

  // Off the manifest when it records one, else null. Read defensively rather than
  // asserted: null is a real answer here, meaning "this run predates the record", which
  // is a different claim from "v1".
  const recorded = (manifest as { repairerPromptVersion?: unknown }).repairerPromptVersion;
  const repairerPromptVersion = typeof recorded === "string" ? recorded : null;

  return {
    ok: true,
    sources: {
      before: {
        description: view.originalDescription,
        descriptionSha256: sha256(view.originalDescription),
        // Built here, once, from the one wrapper both sides share. Building it at submit
        // time instead would mean the stored prompt and the sent prompt were two
        // expressions that merely happened to agree.
        prompt: buildShotPrompt(view.originalDescription),
      },
      after: {
        description: view.finalDescription,
        descriptionSha256: sha256(view.finalDescription),
        prompt: buildShotPrompt(view.finalDescription),
      },
    },
    rubricVersion: manifest.rubricVersion,
    repairerPromptVersion,
  };
}
