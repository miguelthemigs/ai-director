import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  COMPARISON_SIDES,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_SIZES,
  type ComparisonSide,
} from "@ai-director/contract";
import { readComparisonSources } from "../../compare/readSources.js";
import { refreshComparison, startComparison } from "../../compare/runComparison.js";
import type { AvatarStore } from "../../store/AvatarStore.js";
import type { ComparisonStore } from "../../store/ComparisonStore.js";
import type { RunStore } from "../../store/RunStore.js";
import type { VideoTransport } from "../../video/openrouterClient.js";

/**
 * The side-by-side comparison.
 *
 * `POST /compare` SPENDS MONEY — about $0.82 for a pair at the default size — and is
 * unreachable unless the server was built with a transport, which happens only when
 * `OPENROUTER_API_KEY` is present. Absent the key it answers 503 with a readable reason
 * rather than pretending, exactly as `/avatar/sheet` does for a missing image key.
 *
 * There is no event stream here. The contract's `EVENT_NAMES` enumerates the nine names
 * spec §6 defines, and `docs/decision-log.md` (2026-09-11) records that adding to that
 * list is a spec change rather than a bug fix. The Compare screen polls `GET /compare/:id`,
 * and every poll that returns is a real state change it may render.
 */
export type CompareRouteDeps = {
  /** Always wired when a store directory exists: a comparison rendered yesterday is worth
   *  listing and serving today, with or without a key. */
  store?: ComparisonStore;
  runStore?: RunStore;
  avatarStore?: AvatarStore;
  /** Absent means no key was configured; `POST /compare` then 503s. */
  transport?: VideoTransport;
  /** Kicks the render off, unawaited. Injected so a route test never starts a real drive. */
  drive?: (comparisonId: string) => void;
};

const CreateBodySchema = z.object({
  avatarId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  seconds: z
    .number()
    .int(`seconds must be a whole number between ${MIN_VIDEO_SECONDS} and ${MAX_VIDEO_SECONDS}`)
    .min(MIN_VIDEO_SECONDS)
    .max(MAX_VIDEO_SECONDS),
  // An enum, not a string: an unprobed size is a paid render finding out.
  size: z.enum(VIDEO_SIZES),
});

function isSide(value: string): value is ComparisonSide {
  return (COMPARISON_SIDES as readonly string[]).includes(value);
}

export function registerCompareRoutes(app: FastifyInstance, deps: CompareRouteDeps): void {
  app.post("/compare", async (request, reply) => {
    if (!deps.store || !deps.runStore || !deps.avatarStore) {
      return reply.code(503).send({ error: "the comparison store is not configured" });
    }
    if (!deps.transport) {
      return reply.code(503).send({
        error:
          "video comparison is not configured: OPENROUTER_API_KEY is required, and every render through it costs money",
      });
    }

    const parsed = CreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }

    const sources = await readComparisonSources(
      { runStore: deps.runStore, avatarStore: deps.avatarStore },
      { runId: parsed.data.runId, avatarId: parsed.data.avatarId },
    );
    if (!sources.ok) {
      // A 400 and not a 404: the ids may both exist and still not make a comparison, and
      // the reason is the useful part. Nothing has been submitted at this point.
      return reply.code(400).send({ error: sources.reason });
    }

    const row = await startComparison(
      { store: deps.store, transport: deps.transport },
      {
        avatarId: parsed.data.avatarId,
        runId: parsed.data.runId,
        seconds: parsed.data.seconds,
        size: parsed.data.size,
        rubricVersion: sources.rubricVersion,
        repairerPromptVersion: sources.repairerPromptVersion,
        sources: sources.sources,
      },
    );

    // Fire-and-forget, like `POST /runs`: a pair takes minutes and the browser needs the
    // id now to start polling. Any failure is recorded on the row by `driveComparison`
    // itself, so there is nothing left to do with it here.
    deps.drive?.(row.comparisonId);

    return reply.code(202).send(row);
  });

  app.get("/compare", async (_request, reply) => {
    if (!deps.store) return reply.code(200).send([]);
    return reply.code(200).send(await deps.store.list());
  });

  app.get<{ Params: { id: string } }>("/compare/:id", async (request, reply) => {
    if (!deps.store) return reply.code(404).send({ error: "not found" });
    const row = await deps.store.get(request.params.id);
    if (!row) return reply.code(404).send({ error: `comparison "${request.params.id}" not found` });
    return reply.code(200).send(row);
  });

  app.post<{ Params: { id: string } }>("/compare/:id/refresh", async (request, reply) => {
    if (!deps.store || !deps.transport) {
      return reply.code(503).send({ error: "video comparison is not configured" });
    }
    const existing = await deps.store.get(request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: `comparison "${request.params.id}" not found` });
    }
    // Reads status, never submits — see `refreshComparison`.
    const row = await refreshComparison(
      { store: deps.store, transport: deps.transport },
      request.params.id,
    );
    return reply.code(200).send(row);
  });

  app.get<{ Params: { id: string; side: string } }>(
    "/compare/:id/:side/clip",
    async (request, reply) => {
      const { id, side } = request.params;
      if (!isSide(side)) {
        return reply.code(400).send({ error: `side must be "before" or "after"` });
      }
      if (!deps.store) return reply.code(404).send({ error: "not found" });

      const clip = await deps.store.readClip(id, side);
      // No cache header on a miss: a clip's absence is temporary — the download may not
      // have landed yet — and a cached 404 would outlive it.
      if (!clip) return reply.code(404).send({ error: "not found" });

      return reply
        .code(200)
        .header("Content-Type", clip.mediaType)
        // A clip's bytes never change once written, the same as an avatar's.
        .header("Cache-Control", "public, max-age=31536000, immutable")
        // Without this a <video> element cannot seek: Chrome refuses to scrub a response
        // that does not advertise range support.
        .header("Accept-Ranges", "bytes")
        .send(clip.bytes);
    },
  );
}
