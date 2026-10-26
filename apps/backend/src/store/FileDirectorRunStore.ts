import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  reduceDirectorEvents,
  type DirectorEvent,
  type DirectorEventBody,
  type DirectorNodeId,
  type DirectorRunSummary,
  type GateAAnswers,
} from "@ai-director/contract";
import type { DirectorRunStore } from "./DirectorRunStore.js";
import { writeJsonAtomic, writeTextAtomic } from "./FileRunStore.js";

const REF = /^(nodes|assets)\/[\w.-]+$/;
const NAME = /^[\w.-]+$/;
const RUN_ID = /^[\w.-]+$/;

/**
 * Parses a JSONL log. An unparseable FINAL line is dropped (a torn write); one anywhere else
 * throws. `keep` is the text to retain on disk: every valid line, each newline-terminated.
 */
function parseLog(raw: string): { events: DirectorEvent[]; keep: string } {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const events: DirectorEvent[] = [];
  const kept: string[] = [];
  lines.forEach((line, i) => {
    try {
      events.push(JSON.parse(line) as DirectorEvent);
      kept.push(line);
    } catch (err) {
      if (i !== lines.length - 1) throw err;
    }
  });
  return { events, keep: kept.map((l) => `${l}\n`).join("") };
}

export class FileDirectorRunStore implements DirectorRunStore {
  /** Tail of each run's append chain: the next append waits for it. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  private dir(runId: string): string {
    if (!RUN_ID.test(runId) || runId === "." || runId === "..") {
      throw new Error(`FileDirectorRunStore: invalid run id "${runId}"`);
    }
    return path.join(this.root, runId);
  }

  private resolveRef(runId: string, ref: string): string {
    if (!REF.test(ref) || ref.slice(ref.indexOf("/") + 1).startsWith("..")) {
      throw new Error(`FileDirectorRunStore: invalid ref "${ref}"`);
    }
    return path.join(this.dir(runId), ref);
  }

  async createRun(brief: string): Promise<string> {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const dir = this.dir(runId);
    await mkdir(path.join(dir, "nodes"), { recursive: true });
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeJsonAtomic(path.join(dir, "manifest.json"), {
      runId,
      brief,
      startedAt: new Date().toISOString(),
    });
    await this.append(runId, { type: "run.started", brief });
    return runId;
  }

  append(runId: string, body: DirectorEventBody): Promise<DirectorEvent> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const file = path.join(this.dir(runId), "events.jsonl");
        await this.repairTail(file);
        const existing = await this.events(runId);
        const last = existing.length > 0 ? existing[existing.length - 1]!.seq : 0;
        const event = { ...body, runId, seq: last + 1, at: new Date().toISOString() } as DirectorEvent;
        await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
        return event;
      });
    this.chains.set(runId, next);
    return next;
  }

  async events(runId: string, afterSeq = 0): Promise<DirectorEvent[]> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.dir(runId), "events.jsonl"), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return parseLog(raw).events.filter((event) => event.seq > afterSeq);
  }

  /** A crash mid-append can leave a torn or unterminated last line; fix it before writing more. */
  private async repairTail(file: string): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    if (raw.length === 0 || raw.endsWith("\n")) return;
    const { keep } = parseLog(raw);
    // Replaced whole, never rewritten in place: a crash mid-repair must not tear the log again.
    await writeTextAtomic(file, keep);
  }

  async writeOutput(
    runId: string,
    node: DirectorNodeId,
    attempt: number,
    payload: unknown,
  ): Promise<string> {
    const ref = `nodes/${node}.${attempt}.json`;
    await mkdir(path.join(this.dir(runId), "nodes"), { recursive: true });
    await writeJsonAtomic(this.resolveRef(runId, ref), payload);
    return ref;
  }

  async readOutput<T>(runId: string, ref: string): Promise<T> {
    return JSON.parse(await readFile(this.resolveRef(runId, ref), "utf8")) as T;
  }

  async saveAsset(runId: string, name: string, bytes: Buffer): Promise<string> {
    const ref = `assets/${name}`;
    if (!NAME.test(name)) throw new Error(`FileDirectorRunStore: invalid asset name "${name}"`);
    const target = this.resolveRef(runId, ref);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return ref;
  }

  async readAsset(runId: string, ref: string): Promise<Buffer> {
    if (!ref.startsWith("assets/")) throw new Error(`FileDirectorRunStore: invalid asset ref "${ref}"`);
    return readFile(this.resolveRef(runId, ref));
  }

  async writeAnswers(runId: string, answers: GateAAnswers): Promise<void> {
    // Replaced atomically, never refused: a crash after this write and before `gate.resolved A`
    // leaves gate A waiting, and the next answer must be able to replace this one. Double
    // answers are refused by the runner (waiting at A, under the run lock), not here.
    await writeJsonAtomic(path.join(this.dir(runId), "answers.json"), answers);
  }

  async readAnswers(runId: string): Promise<GateAAnswers | null> {
    try {
      return JSON.parse(await readFile(path.join(this.dir(runId), "answers.json"), "utf8")) as GateAAnswers;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async claimRender(runId: string, attempt: number): Promise<"claimed" | "already_claimed"> {
    const claim = path.join(this.dir(runId), `render.${attempt}.claim`);
    try {
      // "wx" is the whole mechanism: create-if-absent, atomically, or EEXIST.
      await writeFile(claim, new Date().toISOString(), { flag: "wx" });
      return "claimed";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return "already_claimed";
      throw err;
    }
  }

  async hasRenderClaim(runId: string, attempt: number): Promise<boolean> {
    try {
      await access(path.join(this.dir(runId), `render.${attempt}.claim`));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async listIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async listRuns(): Promise<DirectorRunSummary[]> {
    const ids = await this.listIds();
    const results = await Promise.allSettled(
      ids.map(async (id): Promise<DirectorRunSummary> => {
        const events = await this.events(id);
        const view = reduceDirectorEvents(events);
        if (view.id === "") throw new Error(`run "${id}" has no events`);
        const everBilled = events.some((event) => event.type === "render.settled" && event.billing === "billed");
        return {
          id: view.id,
          brief: view.brief,
          status: view.status,
          waitingAt: view.waitingAt,
          seconds: view.seconds,
          textMicroUsd: view.textMicroUsd,
          startedAt: view.startedAt,
          billedMicroUsd: everBilled ? view.billedMicroUsd : null,
        };
      }),
    );
    return results
      .flatMap((r, i) => {
        if (r.status === "fulfilled") return [r.value];
        console.warn(`FileDirectorRunStore: skipping run "${ids[i]}": ${String(r.reason)}`);
        return [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
