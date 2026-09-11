import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RunManifest, RunStatus, RunStore } from "./RunStore.js";

const MANIFEST_FILE = "manifest.json";

export class FileRunStore implements RunStore {
  constructor(private readonly root: string) {}

  private dir(runId: string): string {
    return path.join(this.root, runId);
  }

  async createRun(manifest: RunManifest): Promise<void> {
    await mkdir(this.dir(manifest.runId), { recursive: true });
    await this.save(manifest);
  }

  async writePass(
    runId: string,
    pass: number,
    kind: "eval" | "repair",
    payload: unknown,
  ): Promise<void> {
    await mkdir(this.dir(runId), { recursive: true });
    await this.writeJsonAtomic(
      path.join(this.dir(runId), `pass-${pass}-${kind}.json`),
      payload,
    );
  }

  async finishRun(runId: string, status: RunStatus, passes: number): Promise<void> {
    const manifest = await this.getRun(runId);
    await this.save({ ...manifest, status, passes, finishedAt: new Date().toISOString() });
  }

  async getRun(runId: string): Promise<RunManifest> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.dir(runId), MANIFEST_FILE), "utf8");
    } catch {
      throw new Error(`FileRunStore: no run found with id "${runId}"`);
    }
    return JSON.parse(raw) as RunManifest;
  }

  async listRuns(): Promise<RunManifest[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const manifests = await Promise.all(
      entries.filter((e) => e.isDirectory()).map((e) => this.getRun(e.name)),
    );
    return manifests.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async save(manifest: RunManifest): Promise<void> {
    await this.writeJsonAtomic(
      path.join(this.dir(manifest.runId), MANIFEST_FILE),
      manifest,
    );
  }

  // Write to a temp file in the same directory, then rename over the target.
  // rename() is atomic on POSIX and Windows for same-volume paths, so a crash
  // mid-write can never leave a partially-written manifest/pass file that a
  // later read would parse as valid (or invalid) JSON.
  private async writeJsonAtomic(target: string, payload: unknown): Promise<void> {
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    await rename(tmp, target);
  }
}
