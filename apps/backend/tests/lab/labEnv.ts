import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LabEnv } from "../../src/lab/commands.js";
import { createRun, writeJson } from "../../src/lab/runStore.js";
import type { LabArch, LabBrief } from "../../src/lab/types.js";
import { labBrief } from "./labFixture.js";

export const AVATAR_ID = "eaa18108-4b38-408f-b683-2fc897ce2537";
export const AVATAR_DESCRIPTION = "A young man in his mid-twenties with wavy brown hair, green eyes, light stubble.";

const roots: string[] = [];

/** A temp lab root and avatars dir holding one described avatar. */
export async function newLabEnv(): Promise<LabEnv> {
  const base = await mkdtemp(path.join(tmpdir(), "lab-"));
  roots.push(base);
  const avatarsDir = path.join(base, "avatars");
  await mkdir(path.join(avatarsDir, AVATAR_ID), { recursive: true });
  await writeFile(
    path.join(avatarsDir, AVATAR_ID, "record.json"),
    JSON.stringify({
      id: AVATAR_ID,
      createdAt: "2026-09-12T13:23:27.890Z",
      source: "uploaded",
      mediaType: "image/jpeg",
      description: AVATAR_DESCRIPTION,
    }),
  );
  return { root: path.join(base, "runs"), avatarsDir, now: () => new Date("2026-10-29T12:00:00Z") };
}

export async function cleanLabEnvs(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/** A run whose brief is already filled, ready for a plan. */
export async function runWithBrief(env: LabEnv, arch: LabArch = "coordinator", brief: Partial<LabBrief> = {}): Promise<string> {
  const run = await createRun(env.root, { arch, brief: "an ad for our headphones", url: null, now: env.now?.() });
  await writeJson(env.root, run.id, "brief.json", labBrief(brief));
  return run.id;
}
