import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { RunManifestSchema, type RunManifest, type RunStatus, type RunStore } from "./RunStore.js";

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
    return this.readManifest(runId);
  }

  // NOTE: if `root` itself does not exist (the store was never initialised —
  // e.g. no run has ever been created against this root), this resolves to
  // `[]`, the same result as "root exists and is empty". Callers must not
  // read an empty list as confirmation that zero runs exist; it may instead
  // mean the store was never initialised. Distinguish the two cases upstream
  // if that distinction matters (e.g. check for the root directory first).
  async listRuns(): Promise<RunManifest[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    // A single corrupt or foreign manifest.json must not fail visibility
    // into every other run, so listRuns skips entries that fail validation
    // rather than rejecting the whole call. It also must never let a
    // corrupt manifest appear in the result as if it were valid — skipping
    // it entirely satisfies that. getRun is the strict boundary: asking for
    // one specific run's details always rejects loudly on corruption.
    const results = await Promise.allSettled(
      entries.filter((e) => e.isDirectory()).map((e) => this.readManifest(e.name)),
    );
    const manifests = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    return manifests.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async save(manifest: RunManifest): Promise<void> {
    await this.writeJsonAtomic(
      path.join(this.dir(manifest.runId), MANIFEST_FILE),
      manifest,
    );
  }

  private async readManifest(runId: string): Promise<RunManifest> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.dir(runId), MANIFEST_FILE), "utf8");
    } catch {
      throw new Error(`FileRunStore: no run found with id "${runId}"`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`FileRunStore: manifest for run "${runId}" is not valid JSON: ${reason}`);
    }

    const result = RunManifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `FileRunStore: manifest for run "${runId}" is invalid: ${result.error.message}`,
      );
    }
    return result.data;
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
