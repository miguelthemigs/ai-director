import type { ParseTransport } from "../api/client.js";
import { createAnthropicTransport } from "../api/client.js";
import { labCollect } from "../lab/collect.js";
import {
  labAssemble,
  labAvatars,
  labCheck,
  labLog,
  labNew,
  labSave,
  labScrape,
  labShow,
  labStop,
  type LabEnv,
} from "../lab/commands.js";
import { labCompare, labRate, labReport } from "../lab/metrics.js";
import { LAB_RUNS_DIR, LabError } from "../lab/runStore.js";
import { LAB_SPECIALIST_MODEL, sequentialAsk, sequentialFinish } from "../lab/sequential.js";
import { LAB_ARCHS, LAB_STEPS, type LabArch, type LabStep } from "../lab/types.js";

/**
 * `npm run -s lab -- <command>`: the architecture lab's toolbox, one command per rule.
 * The recipe calls these functions directly; the coordinator's and the swarm's agents call
 * this CLI through Bash. stdout is always one JSON value (`compare` prints markdown);
 * a refusal is `{ ok: false, error }` with exit 1; bad usage is exit 2.
 *
 * Only `sequential ask|finish` call a model, and only with ANTHROPIC_API_KEY set: the
 * owner's paid run. No command calls any image or video API.
 */
export type LabIo = {
  env: LabEnv;
  environ: Record<string, string | undefined>;
  stdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Built only when the recipe needs it. */
  transport: () => ParseTransport;
};

export const USAGE = `usage: npm run -s lab -- <command>
  new --arch <sequential|coordinator|swarm> --brief <text> [--url <url>]
  scrape <run> <url>
  avatars
  show <run> [file]
  save <run> <questions|answers|brief|plan|cameras> --by <agent>     (JSON on stdin)
  check <run> <plan|shots> --by <agent>
  assemble <run> --by <agent>
  stop <run> --by <agent> <reason>
  log <run> --from <agent> --to <agent> <text>
  report <run>
  compare [run...]
  rate <run> <1-5> <note>
  collect <run> <session-id...>
  sequential ask <run>
  sequential finish <run>
  export-agents`;

class UsageError extends Error {}

/** Splits `--name value` options from positional arguments. */
function parse(argv: string[]): { positional: string[]; options: Record<string, string> } {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function need<T extends string>(value: string | undefined, what: string, allowed?: readonly T[]): T {
  if (value === undefined || value === "") throw new UsageError(`missing ${what}`);
  if (allowed && !allowed.includes(value as T)) throw new UsageError(`${what} must be one of ${allowed.join(", ")}`);
  return value as T;
}

async function dispatch(argv: string[], io: LabIo): Promise<unknown> {
  const [command, ...rest] = argv;
  const { positional: p, options: o } = parse(rest);
  const env = io.env;
  switch (command) {
    case "new":
      return labNew(env, {
        arch: need<LabArch>(o.arch, "--arch", LAB_ARCHS),
        brief: need(o.brief, "--brief"),
        url: o.url ?? null,
      });
    case "scrape":
      return labScrape(env, need(p[0], "run"), need(p[1], "url"));
    case "avatars":
      return labAvatars(env);
    case "show":
      return labShow(env, need(p[0], "run"), p[1]);
    case "save":
      return labSave(env, need(p[0], "run"), need<LabStep>(p[1], "step", LAB_STEPS), await io.stdin(), need(o.by, "--by"));
    case "check":
      return labCheck(env, need(p[0], "run"), need(p[1], "plan or shots", ["plan", "shots"] as const), need(o.by, "--by"));
    case "assemble":
      return labAssemble(env, need(p[0], "run"), need(o.by, "--by"));
    case "stop":
      return labStop(env, need(p[0], "run"), p.slice(1).join(" "), need(o.by, "--by"));
    case "log":
      return labLog(env, need(p[0], "run"), { from: need(o.from, "--from"), to: need(o.to, "--to"), text: p.slice(1).join(" ") });
    case "report":
      return labReport(env, need(p[0], "run"));
    case "compare":
      return { markdown: await labCompare(env, p) };
    case "rate":
      return labRate(env, need(p[0], "run"), Number(need(p[1], "score")), p.slice(2).join(" "));
    case "collect":
      return labCollect(env, need(p[0], "run"), p.slice(1));
    case "sequential": {
      const which = need(p[0], "ask or finish", ["ask", "finish"] as const);
      const runId = need(p[1], "run");
      if (!io.environ.ANTHROPIC_API_KEY) {
        throw new LabError("ANTHROPIC_API_KEY is not set: the recipe calls the model, so it needs the key in .env");
      }
      const deps = { env, transport: io.transport(), print: (line: string) => io.stderr(`${line}\n`) };
      if (which === "ask") return { questions: await sequentialAsk(deps, runId) };
      const run = await sequentialFinish(deps, runId);
      return { run, metrics: await labReport(env, runId) };
    }
    default:
      throw new UsageError(command === undefined ? "no command" : `unknown command ${command}`);
  }
}

export async function runLabCli(argv: string[], io: LabIo): Promise<number> {
  try {
    const result = await dispatch(argv, io);
    if (argv[0] === "compare") io.stdout(`${(result as { markdown: string }).markdown}\n`);
    else io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n${USAGE}\n`);
      return 2;
    }
    if (error instanceof LabError) {
      io.stdout(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
      return 1;
    }
    throw error;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file; environment variables are expected to be set some other way.
  }
  runLabCli(process.argv.slice(2), {
    env: { root: LAB_RUNS_DIR, avatarsDir: "data/avatars" },
    environ: process.env,
    stdin: readStdin,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    transport: () => createAnthropicTransport(LAB_SPECIALIST_MODEL),
  })
    .then((code) => process.exit(code))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ ok: false, error: `unexpected: ${message}` }, null, 2)}\n`);
      process.exit(1);
    });
}
