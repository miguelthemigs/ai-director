import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseEventId, type RunView } from "@ai-director/contract";
import type { RunEventBus } from "../../orchestrate/events.js";
import type { Rubric } from "../../rubric/load.js";
import type { RunStore } from "../../store/RunStore.js";
import { rebuildRunView } from "../../present/rebuildRunView.js";
import { formatSse } from "../sse.js";

/** How often to write an SSE keepalive comment on an open `/events` stream. */
const KEEPALIVE_MS = 15_000;

/**
 * Drives one run to completion and resolves with its full wire view. The
 * route calls this without awaiting it (see `POST /runs` below) -- a run
 * takes tens of seconds and the browser needs the id immediately to open its
 * event stream (Task 18).
 */
export type StartRun = (args: {
  runId: string;
  description: string;
  /**
   * Which stored avatar this description was read off, when the caller knows.
   *
   * Optional, and absent is the ordinary case: a description typed into the textarea
   * belongs to no avatar. When it IS present the Repairer is given that avatar's sheet
   * and brief and runs prompt v2 (`agents/repairer/prompt-v2.ts`); without it the
   * Repairer is blind and runs v1, which is the prompt that fabricated the hair length,
   * the height and the build on run `bee3bcd6`. See `docs/repairer-cannot-see.md`.
   */
  avatarId?: string;
}) => Promise<RunView>;

export type RunRouteDeps = {
  store: RunStore;
  rubric: Rubric;
  startRun: StartRun;
  bus: RunEventBus;
};

const CreateRunBodySchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "description must not be empty")
    .max(20_000, "description must be at most 20000 characters"),
  /** Naming the avatar is what upgrades the Repairer from blind v1 to sighted v2. */
  avatarId: z.string().min(1).max(200).optional(),
});

export function registerRunRoutes(app: FastifyInstance, deps: RunRouteDeps): void {
  // A completed run's assembled view, kept so the common case -- asking for the
  // run this process just finished -- answers without touching the disk.
  //
  // This map used to be the ONLY source `GET /runs/:id` had, which made every
  // finished run unreachable the moment the process restarted: under `tsx
  // watch` that is any file save, and closing a laptop takes the dev server
  // with it. The run's files were on disk the whole time and nothing could
  // read them. `rebuildRunView` is now the fallback, so the cache is an
  // optimisation rather than the system of record.
  const runViews = new Map<string, RunView>();

  app.post("/runs", async (request, reply) => {
    const parsed = CreateRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "description is invalid";
      return reply.code(400).send({ error: message });
    }

    const runId = randomUUID();
    // Fire-and-forget: must not block the response on the agents. Any
    // rejection here is already recorded through the store by whatever
    // `startRun` does internally (`finishRun(runId, "failed", ...)`), so
    // there is nothing left to do with it at this layer.
    void deps
      .startRun({
        runId,
        description: parsed.data.description,
        ...(parsed.data.avatarId === undefined ? {} : { avatarId: parsed.data.avatarId }),
      })
      .then((view) => runViews.set(runId, view))
      .catch(() => {});

    return reply.code(202).send({ runId, status: "running" });
  });

  app.get("/runs", async () => {
    const manifests = await deps.store.listRuns();
    // Sorted here too, defensively, so this route's contract ("newest
    // first") holds regardless of whether a given `RunStore` implementation
    // already orders its own results.
    return [...manifests].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const { id } = request.params;

    const cached = runViews.get(id);
    if (cached) return cached;

    let manifest;
    try {
      manifest = await deps.store.getRun(id);
    } catch {
      return reply.code(404).send({ error: `run "${id}" not found` });
    }

    const stored = await deps.store.readPasses(id);
    if (stored.length === 0) {
      // The manifest exists but the run has written no pass yet -- it is still in its
      // first pass, or it failed before finishing one. There is nothing to show, and
      // saying so is better than an empty run that looks like a run with no findings.
      return reply.code(404).send({ error: `run "${id}" has not finished a pass yet` });
    }

    try {
      return rebuildRunView(manifest, stored);
    } catch (err) {
      // A pass file that cannot be parsed back into a view is a real failure of this
      // route, not a missing run: 404 would tell the caller to stop looking for a run
      // that is right there on disk.
      request.log.error({ err, runId: id }, "could not rebuild run view from disk");
      return reply.code(500).send({ error: `run "${id}" could not be read back from disk` });
    }
  });

  // Server-sent events, not WebSocket: traffic here is server to client only,
  // and `EventSource` reconnects on its own with `Last-Event-ID`, which the
  // three-pass loop needs (spec §6). This is what makes `GET /runs/:id`
  // never serving a run that's still in flight (see the comment on
  // `runViews` above) fine -- the frontend builds its view from this stream
  // and never needs to fetch mid-run.
  app.get<{ Params: { id: string } }>("/runs/:id/events", (request, reply) => {
    const { id } = request.params;
    const lastEventId = request.headers["last-event-id"];
    let from: string | undefined = typeof lastEventId === "string" ? lastEventId : undefined;
    if (from !== undefined) {
      try {
        parseEventId(from);
      } catch {
        // A malformed Last-Event-ID (not this server's own doing -- EventSource
        // always echoes back an id we minted) is treated as "replay
        // everything" rather than crashing an already-hijacked response.
        from = undefined;
      }
    }

    // Fastify must not try to send its own reply once we start writing to
    // the raw response ourselves -- `hijack()` takes the response fully out
    // of its lifecycle.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const unsubscribe = deps.bus.subscribe(id, from, (event) => {
      reply.raw.write(formatSse(event));
    });

    // A comment frame, not an event -- EventSource ignores it, and it exists
    // only to keep intermediaries from timing out an idle connection. This
    // governs the transport, not the UI's no-ambient-motion rule.
    const keepalive = setInterval(() => {
      reply.raw.write(": keepalive\n\n");
    }, KEEPALIVE_MS);

    // Without this, every subscription from a client that has since gone
    // away stays registered on the bus for the life of the process -- a
    // leak that accumulates for as long as the server runs.
    request.raw.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });
}
