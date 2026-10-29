import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { writeTextAtomic } from "../store/FileRunStore.js";
import type { LabEnv } from "./commands.js";
import { LabError, appendTrace, readRun } from "./runStore.js";

/**
 * Copies the Claude Code transcripts of a coordinator or swarm run into its folder, so the
 * teaching document can quote evidence a fresh clone can open. Only what the lesson needs
 * is kept (who, role, model, effort, text, usage), and anything that looks like a key or a
 * token is blanked. The owner reads `transcript.jsonl` before committing it.
 */
export type TranscriptLine = {
  session: string;
  agent: string;
  role: "user" | "assistant";
  model: string | null;
  effort: string | null;
  requestId: string | null;
  text: string;
  /** Set on the first line of each API request only, so a request is counted once. */
  usage: { input: number; output: number } | null;
};

const SNIPPET = 300;

const SECRETS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /Bearer\s+\S+/g,
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*)=\S+/g,
];

export function redact(text: string): string {
  return SECRETS.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
}

export function defaultProjectsDir(cwd: string = process.cwd()): string {
  return path.join(homedir(), ".claude", "projects", cwd.replaceAll("/", "-"));
}

type RawLine = {
  type?: string;
  requestId?: string;
  effort?: string;
  agentName?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
};

const clip = (text: string): string => (text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text);

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: Record<string, unknown>) => {
      switch (block.type) {
        case "text":
          return String(block.text ?? "");
        case "thinking":
          return `[thinking] ${clip(String(block.thinking ?? ""))}`;
        case "tool_use":
          return `[tool] ${String(block.name ?? "")} ${clip(JSON.stringify(block.input ?? {}))}`;
        case "tool_result": {
          const inner = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
          return `[result] ${clip(inner)}`;
        }
        default:
          return "";
      }
    })
    .filter((part) => part !== "")
    .join("\n");
}

async function readRawLines(file: string): Promise<RawLine[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RawLine];
      } catch {
        return [];
      }
    });
}

function toTranscript(session: string, agent: string, lines: RawLine[]): TranscriptLine[] {
  const seen = new Set<string>();
  const out: TranscriptLine[] = [];
  for (const line of lines) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    const message = line.message ?? {};
    const requestId = line.requestId ?? null;
    let usage: TranscriptLine["usage"] = null;
    if (line.type === "assistant" && message.usage && !(requestId !== null && seen.has(requestId))) {
      const u = message.usage;
      usage = {
        input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
      };
      if (requestId !== null) seen.add(requestId);
    }
    out.push({
      session,
      agent,
      role: line.type,
      model: message.model ?? null,
      effort: line.effort ?? null,
      requestId,
      text: redact(renderContent(message.content)),
      usage,
    });
  }
  return out;
}

async function subagentFiles(dir: string): Promise<Array<{ file: string; agent: string }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found: Array<{ file: string; agent: string }> = [];
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    const stem = name.slice(0, -".jsonl".length);
    let agent = stem;
    try {
      const meta = JSON.parse(await readFile(path.join(dir, `${stem}.meta.json`), "utf8")) as { agentType?: string };
      if (meta.agentType) agent = meta.agentType;
    } catch {
      // No meta file: keep the file name as the agent.
    }
    found.push({ file: path.join(dir, name), agent });
  }
  return found;
}

/**
 * The first session is the lead; a later one (a split-pane teammate runs as its own
 * session) is named by its `agentName` if a line carries one.
 */
export async function labCollect(
  env: LabEnv,
  runId: string,
  sessionIds: string[],
  projectsDir: string = defaultProjectsDir(),
): Promise<{ lines: number; files: string[] }> {
  await readRun(env.root, runId);
  if (sessionIds.length === 0) throw new LabError("name at least one Claude Code session id");

  const all: TranscriptLine[] = [];
  const files: string[] = [];
  for (const [index, session] of sessionIds.entries()) {
    if (!/^[\w-]+$/.test(session)) throw new LabError(`not a session id: ${session}`);
    const main = path.join(projectsDir, `${session}.jsonl`);
    let lines: RawLine[];
    try {
      // A session that never mentions the run is someone else's; collecting it would put
      // unrelated work (and its tokens) into this run's committed transcript.
      if (!(await readFile(main, "utf8")).includes(runId)) {
        throw new LabError(`session ${session} never mentions run ${runId}`);
      }
      lines = await readRawLines(main);
    } catch (error) {
      if (error instanceof LabError) throw error;
      throw new LabError(`no Claude Code session ${session} in ${projectsDir}`);
    }
    const named = lines.find((line) => typeof line.agentName === "string")?.agentName;
    const agent = index === 0 ? "lead" : (named ?? `session-${session.slice(0, 8)}`);
    all.push(...toTranscript(session, agent, lines));
    files.push(main);
    for (const sub of await subagentFiles(path.join(projectsDir, session, "subagents"))) {
      all.push(...toTranscript(session, sub.agent, await readRawLines(sub.file)));
      files.push(sub.file);
    }
  }

  await writeTextAtomic(
    path.join(env.root, runId, "transcript.jsonl"),
    all.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
  await appendTrace(env.root, runId, {
    actor: "lab",
    kind: "step",
    text: `collected ${all.length} transcript lines from ${files.length} files`,
  });
  return { lines: all.length, files };
}
