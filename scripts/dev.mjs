/**
 * `npm run dev` — the API and the web server as one process that lives and dies once.
 *
 * ── The bug this exists to stop ─────────────────────────────────────────────────────
 * The script used to be `npm run dev:server & npm run dev:web`. Backgrounding the first
 * half with `&` detaches its lifetime from the second, and both failure modes were bad:
 *
 *   - `dev:web` exits (it did, for want of a `vite` binary) and the shell prompt comes
 *     back while Fastify is still listening on 8787. The only thing left serving is the
 *     API, so the obvious move is to open 8787 in a browser — which answers
 *     `Route GET:/ not found`, because that server speaks JSON and nothing else.
 *   - Ctrl-C reaches the foreground half only. Vite stops, `tsx watch` does not, and the
 *     next `npm run dev` fails on `EADDRINUSE` against a server nobody remembers starting.
 *
 * ── How this fixes it ───────────────────────────────────────────────────────────────
 * Each half is started in its own process group (`detached`), so a group signal reaches
 * the whole tree — `sh`, `tsx`, and the server `tsx` spawned underneath it — and not just
 * the shell in front. Whichever half exits first, for any reason, takes the other down
 * with it, and Ctrl-C is forwarded to both. The command bodies are still read from
 * `package.json`, so `dev:server` and `dev:web` remain the single definition of each half
 * and stay runnable on their own.
 *
 * POSIX only, which is what this repo is developed on. `process.kill(-pid)` has no
 * Windows equivalent.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const scripts = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).scripts;

// npm puts this on PATH when it runs a script; node does not, and the halves call `tsx`
// and `vite` by bare name.
const binDir = fileURLToPath(new URL("node_modules/.bin", root));

/** Every half still running, by the name of the script that started it. */
const running = new Map();
let stopping = false;

function start(name) {
  const command = scripts[name];
  if (!command) throw new Error(`package.json has no "${name}" script`);

  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    cwd: fileURLToPath(root),
    detached: true,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  running.set(child, name);
  child.on("exit", (code, signal) => {
    running.delete(child);
    if (!stopping) {
      process.exitCode = code === 0 ? 0 : 1;
      stop(`${name} exited ${signal ? `on ${signal}` : `with code ${code}`}`);
    }
  });
}

function stop(reason) {
  if (stopping) return;
  stopping = true;
  if (running.size > 0) {
    console.error(`\n[dev] ${reason} — stopping ${[...running.values()].join(" and ")}.`);
  }
  for (const child of running.keys()) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone between the exit event and this signal; nothing to stop.
    }
  }
  // A half that ignores SIGTERM must not hold the terminal. This timer only fires while
  // something else is keeping the loop alive, which is exactly that case.
  setTimeout(() => {
    for (const child of running.keys()) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Same race as above.
      }
    }
  }, 5000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(`received ${signal}`));
}

console.log("[dev] api: http://localhost:8787 — JSON only. Open the app on the Vite url below.");
start("dev:server");
start("dev:web");
