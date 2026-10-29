import { access, appendFile, mkdir, readFile, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import type { CallLog } from "@ai-director/contract";
import { writeJsonAtomic } from "../store/FileRunStore.js";
import { LAB_STEPS, type LabArch, type LabRun, type LabStep, type TraceLine } from "./types.js";

/**
 * One lab run is one folder, `<root>/<runId>/`: `run.json` (the state every rule reads),
 * the agents' saved outputs, `trace.jsonl` (who did what, in order) and, for the recipe,
 * `calls.jsonl` (every model call it made). Every architecture writes the same files, so
 * the runs can be compared side by side.
 */
export const LAB_RUNS_DIR = "data/lab-runs";

/** A refusal: the CLI prints it as `{ ok: false, error }`, and an agent reads why. */
export class LabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabError";
  }
}

const RUN_ID = /^[\w.-]+$/;
const FILE = /^[\w.-]+$/;

function runDir(root: string, id: string): string {
  if (!RUN_ID.test(id)) throw new LabError(`not a run id: ${id}`);
  return path.join(root, id);
}

function filePath(root: string, id: string, file: string): string {
  if (!FILE.test(file)) throw new LabError(`not a run file: ${file}`);
  return path.join(runDir(root, id), file);
}

const zeros = (): Record<LabStep, number> =>
  Object.fromEntries(LAB_STEPS.map((step) => [step, 0])) as Record<LabStep, number>;

/** `YYYYMMDD-HHMMSS` in UTC. */
function stamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function createRun(
  root: string,
  args: { arch: LabArch; brief: string; url: string | null; now?: Date },
): Promise<LabRun> {
  const now = args.now ?? new Date();
  let id = `${stamp(now)}-${args.arch}`;
  for (let n = 2; await exists(path.join(root, id)); n += 1) id = `${stamp(now)}-${n}-${args.arch}`;
  await mkdir(path.join(root, id), { recursive: true });

  const run: LabRun = {
    id,
    arch: args.arch,
    brief: args.brief,
    url: args.url,
    startedAt: now.toISOString(),
    finishedAt: null,
    status: "running",
    reason: null,
    attempts: { plan: 0, cameras: 0 },
    refusedInARow: zeros(),
    refusedTotal: zeros(),
    lastChecks: { plan: null, shots: null },
    pendingReshoot: null,
    rating: null,
  };
  await writeRun(root, run);
  return run;
}

export async function readRun(root: string, id: string): Promise<LabRun> {
  const run = await readJson<LabRun>(root, id, "run.json");
  if (run === null) throw new LabError(`no run ${id}`);
  return run;
}

export async function writeRun(root: string, run: LabRun): Promise<void> {
  await writeJson(root, run.id, "run.json", run);
}

/** The file's JSON, or null when it does not exist. */
export async function readJson<T>(root: string, id: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath(root, id, file), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJson(root: string, id: string, file: string, value: unknown): Promise<void> {
  await writeJsonAtomic(filePath(root, id, file), value);
}

async function readLines<T>(root: string, id: string, file: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath(root, id, file), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendTrace(
  root: string,
  id: string,
  line: Omit<TraceLine, "at">,
  now: Date = new Date(),
): Promise<void> {
  const full: TraceLine = { at: now.toISOString(), ...line };
  await appendFile(filePath(root, id, "trace.jsonl"), `${JSON.stringify(full)}\n`, "utf8");
}

export async function readTrace(root: string, id: string): Promise<TraceLine[]> {
  return readLines<TraceLine>(root, id, "trace.jsonl");
}

export async function appendCalls(root: string, id: string, calls: CallLog[]): Promise<void> {
  if (calls.length === 0) return;
  const text = calls.map((call) => `${JSON.stringify(call)}\n`).join("");
  await appendFile(filePath(root, id, "calls.jsonl"), text, "utf8");
}

export async function readCalls(root: string, id: string): Promise<CallLog[]> {
  return readLines<CallLog>(root, id, "calls.jsonl");
}

const LOCK_WAIT_MS = 20;
const LOCK_GIVE_UP_MS = 15_000;
/** A lock older than this was left by a process that died mid-command; it is broken. */
const LOCK_STALE_MS = 60_000;

/**
 * One command at a time per run. Swarm teammates are separate processes that read
 * `run.json`, await, and write it back whole; without this, one's write would silently
 * undo another's (a saved plan the run no longer counts). `mkdir` is atomic, so the
 * lock is a directory in the run folder.
 */
export async function withRunLock<T>(root: string, id: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(runDir(root, id), ".lock");
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LabError(`no run ${id}`);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) {
        await rmdir(lock).catch(() => undefined);
        continue;
      }
      if (Date.now() - started > LOCK_GIVE_UP_MS) throw new LabError(`run ${id} is busy; try again`);
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  try {
    return await work();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}
