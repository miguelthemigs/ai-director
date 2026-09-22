import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  RunManifestSchema,
  type RunManifest,
  type RunStatus,
  type RunStore,
  type StoredPass,
} from "./RunStore.js";

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

  /**
   * Reads back what `writePass` wrote, driven by the directory listing rather than by the
   * manifest's `passes` count: a run that was interrupted has files for the passes it
   * finished and a count that never caught up, and the files are the thing that actually
   * exists. A pass file that is not valid JSON is skipped rather than failing the whole
   * run, for the same reason `listRuns` skips a corrupt manifest -- one unreadable pass
   * must not hide the passes either side of it.
   */
  async readPasses(runId: string): Promise<StoredPass[]> {
    let names: string[];
    try {
      names = await readdir(this.dir(runId));
    } catch {
      return [];
    }

    const byPass = new Map<number, StoredPass>();
    for (const name of names.sort()) {
      const match = /^pass-(\d+)-(eval|repair)\.json$/.exec(name);
      if (!match) continue;
      const pass = Number(match[1]);
      const kind = match[2] as "eval" | "repair";

      let payload: unknown;
      try {
        payload = JSON.parse(await readFile(path.join(this.dir(runId), name), "utf8"));
      } catch {
        continue;
      }

      const existing = byPass.get(pass) ?? { pass, evaluation: undefined };
      byPass.set(
        pass,
        kind === "eval" ? { ...existing, evaluation: payload } : { ...existing, repair: payload },
      );
    }

    return [...byPass.values()]
      .filter((stored) => stored.evaluation !== undefined)
      .sort((a, b) => a.pass - b.pass);
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
