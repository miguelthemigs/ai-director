import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseEventId, type RunView } from "@ai-director/contract";
import type { RunEventBus } from "../../orchestrate/events.js";
import type { Rubric } from "../../rubric/load.js";
import type { RunStore } from "../../store/RunStore.js";
import { formatSse } from "../sse.js";

/** How often to write an SSE keepalive comment on an open `/events` stream. */
const KEEPALIVE_MS = 15_000;

/**
 * Drives one run to completion and resolves with its full wire view. The
 * route calls this without awaiting it (see `POST /runs` below) -- a run
 * takes tens of seconds and the browser needs the id immediately to open its
 * event stream (Task 18).
 */
export type StartRun = (args: { runId: string; description: string }) => Promise<RunView>;

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
});

export function registerRunRoutes(app: FastifyInstance, deps: RunRouteDeps): void {
  // `RunStore` (Task 8) persists only the manifest as an audit trail -- runId,
  // status, pass count, timestamps -- and exposes no way to read pass-level
  // detail back. `startRun` is the only thing that ever holds a run's full
  // `RunView`, so this cache is the sole source `GET /runs/:id` has for a
  // run's body. Consequence, flagged in this task's report: a run that is
  // still in progress, or that failed, or that was in flight when the
  // process last restarted, has no entry here and 404s even though its
  // manifest exists in the store.
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
      .startRun({ runId, description: parsed.data.description })
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

    try {
      await deps.store.getRun(id);
    } catch {
      return reply.code(404).send({ error: `run "${id}" not found` });
    }
    // The manifest exists, but no completed view is cached for it yet (see
    // the comment on `runViews` above).
    return reply.code(404).send({ error: `run "${id}" has no completed view yet` });
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
