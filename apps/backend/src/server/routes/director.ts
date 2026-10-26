import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  isValidVideoSeconds,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  reduceDirectorEvents,
  type AssembledPrompt,
  type CharacterOutcome,
  type DirectorEvent,
  type DirectorRunView,
  type GateAAnswers,
  type GateId,
} from "@ai-director/contract";
import { isSupportedMediaType, SUPPORTED_MEDIA_TYPES } from "../../describe/describeImage.js";
import { PHOTO_EXTENSION } from "../../orchestrate/director/agents.js";
import type { DirectorEventHub } from "../../orchestrate/director/hub.js";
import {
  nextRenderAttempt,
  resumeDirectorRenders,
  settleDirectorRender,
  submitDirectorRender,
} from "../../orchestrate/director/render.js";
import {
  driveDirectorRun,
  GateConflictError,
  resolveGate,
  resumeAllDirectorRuns,
  startDirectorRun,
  type RunnerDeps,
} from "../../orchestrate/director/runner.js";
import type { AvatarStore } from "../../store/AvatarStore.js";
import type { DirectorRunStore } from "../../store/DirectorRunStore.js";
import type { VideoTransport } from "../../video/openrouterClient.js";
import { formatDirectorSse } from "../sse.js";

/**
 * The Director's routes. Every answer that starts agents (a new run, a gate) replies 202 at
 * once and fires the drive; the browser follows the run on `/events`. Only gate C with
 * `decision: "render"` (and `render/again` after a failed render) can submit a render, and
 * that SPENDS MONEY, so it is the one place a request awaits a vendor call.
 */
export type DirectorRouteDeps = {
  runner: RunnerDeps;
  store: DirectorRunStore;
  /** Null when OPENROUTER_API_KEY is absent: the run can be planned, not rendered. */
  video: VideoTransport | null;
  avatars: AvatarStore;
  /** The same hub the runner's `publish` goes to; `/events` subscribes to it. */
  hub: DirectorEventHub;
};

const NOT_CONFIGURED = "the Director needs ANTHROPIC_API_KEY, GOOGLE_AI_KEY and UPLOADTHING_TOKEN";
const NO_VIDEO = "rendering needs OPENROUTER_API_KEY, and every render through it costs money";
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const KEEPALIVE_MS = 15_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const ASSET_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
};

const CreateRunBody = z.object({
  brief: z.string().trim().min(1, "brief must not be empty").max(300, "brief must be at most 300 characters"),
});

const GateABody = z.object({
  photo: z.object({
    imageBase64: z.string().min(1, "the product photo is empty").regex(BASE64, "the product photo is not base64"),
    mediaType: z
      .string()
      .refine(isSupportedMediaType, `the product photo must be one of ${SUPPORTED_MEDIA_TYPES.join(", ")}`),
  }),
  productKind: z.string().trim().min(1, "productKind must not be empty").max(200),
  seconds: z
    .number()
    .refine(
      isValidVideoSeconds,
      `seconds must be a whole number between ${MIN_VIDEO_SECONDS} and ${MAX_VIDEO_SECONDS}`,
    ),
  mustNotAppear: z.array(z.string().trim().min(1).max(200)).max(30),
  cast: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("avatar"), avatarId: z.string().min(1).max(200) }),
    z.object({ kind: z.literal("new") }),
  ]),
});

const Reject = z.object({ decision: z.literal("reject"), reason: z.string().trim().min(1).max(500) });
const GateBBody = z.discriminatedUnion("decision", [z.object({ decision: z.literal("approve") }), Reject]);
const GateCBody = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("render"), acceptNotPassed: z.boolean().optional() }),
  Reject,
]);

const firstIssue = (error: z.ZodError): string => error.issues[0]?.message ?? "invalid body";
const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
/** The store refuses an id or ref that could leave its folder; that is the caller's mistake. */
const isRefused = (err: unknown): boolean => err instanceof Error && / invalid (run id|ref|asset ref) /.test(err.message);

type IdParams = { Params: { id: string } };

/** After a restart: drives every unfinished run, and settles every render left in flight. Never awaited. */
export function resumeDirectorAfterRestart(
  deps: DirectorRouteDeps,
  log: (err: unknown, what: string) => void,
): void {
  void resumeAllDirectorRuns(deps.runner).catch((err: unknown) => log(err, "director run resume failed"));
  // Without a video transport nothing can be polled; a claimed render waits for the key.
  if (deps.video) {
    // Polls for up to 15 minutes, so it must never sit in front of `listen`.
    void resumeDirectorRenders({ store: deps.store, video: deps.video, publish: deps.hub.publish }).catch(
      (err: unknown) => log(err, "director render resume failed"),
    );
  }
}

export function registerDirectorRoutes(app: FastifyInstance, deps: DirectorRouteDeps | undefined): void {
  if (!deps) {
    const refuse = async (_request: unknown, reply: FastifyReply) => reply.code(503).send({ error: NOT_CONFIGURED });
    app.all("/director", refuse);
    app.all("/director/*", refuse);
    return;
  }
  const { store, hub } = deps;

  const fail = (what: string, runId: string) => (err: unknown) => app.log.error({ err, runId }, what);
  const drive = (runId: string) => void driveDirectorRun(deps.runner, runId).catch(fail("director drive failed", runId));

  /** The run's log and its view, or null when there is no such run. */
  async function loadRun(id: string): Promise<{ events: DirectorEvent[]; view: DirectorRunView } | null> {
    let events: DirectorEvent[];
    try {
      events = await store.events(id);
    } catch (err) {
      if (isRefused(err)) return null;
      throw err;
    }
    const view = reduceDirectorEvents(events);
    return view.id === "" ? null : { events, view };
  }

  const notFound = (reply: FastifyReply, id: string) => reply.code(404).send({ error: `run "${id}" not found` });
  const notWaiting = (reply: FastifyReply, view: DirectorRunView, gate: GateId) =>
    reply.code(409).send({
      error: `the run is waiting at ${view.waitingAt === null ? "no gate" : `gate ${view.waitingAt}`}, not gate ${gate}`,
    });

  /** Resolves without driving; a race lost to another answer is a 409, not a 500. Returns false then. */
  async function resolve(
    reply: FastifyReply,
    id: string,
    gate: GateId,
    decision: Parameters<typeof resolveGate>[3],
  ): Promise<boolean> {
    try {
      await resolveGate(deps!.runner, id, gate, decision, { drive: false });
      return true;
    } catch (err) {
      if (!(err instanceof GateConflictError)) throw err;
      await reply.code(409).send({ error: err.message });
      return false;
    }
  }

  /** Claims the next attempt and submits it once; the settle is fired, never awaited. */
  async function submitRender(reply: FastifyReply, id: string, video: VideoTransport) {
    const events = await store.events(id);
    const view = reduceDirectorEvents(events);
    // One past the settled attempts, never `view.render.attempt + 1` (a submit that failed
    // before `render.submitted` still settles its own attempt).
    const attempt = nextRenderAttempt(events);
    const promptRef = view.nodes.assembler.outputRef;
    if (view.seconds === null || promptRef === null) {
      throw new Error(`run ${id} has no approved length or no assembled prompt to render`);
    }
    const prompt = await store.readOutput<AssembledPrompt>(id, promptRef);
    const renderDeps = { store, video, publish: hub.publish };
    const outcome = await submitDirectorRender(renderDeps, { runId: id, attempt, prompt, seconds: view.seconds });
    if (outcome === "already_claimed") {
      return reply.code(409).send({ error: `render attempt ${attempt} is already claimed` });
    }
    if (outcome === "submitted") {
      void settleDirectorRender(renderDeps, { runId: id, attempt }).catch(fail("director render settle failed", id));
    }
    return reply.code(202).send({ id, attempt, outcome });
  }

  app.post("/director/runs", async (request, reply) => {
    const parsed = CreateRunBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const id = await startDirectorRun(deps.runner, parsed.data.brief);
    drive(id);
    return reply.code(202).send({ id });
  });

  app.get("/director/runs", async () => store.listRuns());

  app.get<IdParams>("/director/runs/:id", async (request, reply) => {
    const run = await loadRun(request.params.id);
    if (!run) return notFound(reply, request.params.id);
    return run.view;
  });

  app.get<IdParams & { Querystring: { ref?: string } }>("/director/runs/:id/output", async (request, reply) => {
    const { id } = request.params;
    const ref = request.query.ref ?? "";
    if (!ref.startsWith("nodes/")) return reply.code(400).send({ error: "ref must be nodes/<file>" });
    if (!(await loadRun(id))) return notFound(reply, id);
    try {
      return await store.readOutput<unknown>(id, ref);
    } catch (err) {
      if (isRefused(err)) return reply.code(400).send({ error: `ref "${ref}" is not a node output` });
      if (isMissing(err)) return reply.code(404).send({ error: `no output at ${ref}` });
      throw err;
    }
  });

  async function sendAsset(reply: FastifyReply, id: string, ref: string) {
    let bytes: Buffer;
    try {
      bytes = await store.readAsset(id, ref);
    } catch (err) {
      if (isRefused(err)) return reply.code(400).send({ error: `ref "${ref}" is not an asset` });
      if (isMissing(err)) return reply.code(404).send({ error: `no asset at ${ref}` });
      throw err;
    }
    const ext = ref.slice(ref.lastIndexOf(".") + 1).toLowerCase();
    return reply
      .code(200)
      .header("Content-Type", ASSET_MEDIA_TYPES[ext] ?? "application/octet-stream")
      // An asset is written once and never changes. A miss above is not cached: a clip may
      // simply not have downloaded yet.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      // A <video> element cannot seek a response that does not advertise range support.
      .header("Accept-Ranges", "bytes")
      .send(bytes);
  }

  app.get<IdParams & { Querystring: { ref?: string } }>("/director/runs/:id/asset", async (request, reply) => {
    const { id } = request.params;
    const ref = request.query.ref ?? "";
    if (!ref.startsWith("assets/")) return reply.code(400).send({ error: "ref must be assets/<file>" });
    if (!(await loadRun(id))) return notFound(reply, id);
    return sendAsset(reply, id, ref);
  });

  app.get<IdParams & { Querystring: { attempt?: string } }>("/director/runs/:id/clip", async (request, reply) => {
    const { id } = request.params;
    const attempt = Number(request.query.attempt);
    if (!Number.isInteger(attempt) || attempt < 1) {
      return reply.code(400).send({ error: "attempt must be a whole number from 1" });
    }
    if (!(await loadRun(id))) return notFound(reply, id);
    return sendAsset(reply, id, `assets/clip.${attempt}.mp4`);
  });

  app.post<IdParams>("/director/runs/:id/gates/A", async (request, reply) => {
    const { id } = request.params;
    const run = await loadRun(id);
    if (!run) return notFound(reply, id);
    const parsed = GateABody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const { photo, productKind, seconds, mustNotAppear, cast } = parsed.data;

    const bytes = Buffer.from(photo.imageBase64, "base64");
    if (bytes.length > MAX_PHOTO_BYTES) {
      return reply.code(400).send({ error: `the product photo is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB` });
    }
    if (run.view.waitingAt !== "A") return notWaiting(reply, run.view, "A");
    if (cast.kind === "avatar") {
      const avatar = await deps.avatars.get(cast.avatarId);
      if (!avatar?.description?.trim()) {
        return reply.code(422).send({ error: `avatar "${cast.avatarId}" does not exist or has no description` });
      }
    }

    const mediaType = photo.mediaType as keyof typeof PHOTO_EXTENSION;
    const productPhotoAsset = await store.saveAsset(id, `photo.${PHOTO_EXTENSION[mediaType]}`, bytes);
    const answers: GateAAnswers = { productPhotoAsset, productKind, seconds, mustNotAppear, cast };
    if (!(await resolve(reply, id, "A", { decision: "approve", answers }))) return reply;
    drive(id);
    return reply.code(202).send({ id });
  });

  app.post<IdParams>("/director/runs/:id/gates/B", async (request, reply) => {
    const { id } = request.params;
    const run = await loadRun(id);
    if (!run) return notFound(reply, id);
    const parsed = GateBBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    if (run.view.waitingAt !== "B") return notWaiting(reply, run.view, "B");

    if (!(await resolve(reply, id, "B", parsed.data))) return reply;
    if (parsed.data.decision === "approve") drive(id);
    return reply.code(202).send({ id });
  });

  app.post<IdParams>("/director/runs/:id/gates/C", async (request, reply) => {
    const { id } = request.params;
    const run = await loadRun(id);
    if (!run) return notFound(reply, id);
    const parsed = GateCBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    if (run.view.waitingAt !== "C") return notWaiting(reply, run.view, "C");

    if (parsed.data.decision === "reject") {
      if (!(await resolve(reply, id, "C", parsed.data))) return reply;
      return reply.code(202).send({ id });
    }

    const characterRef = run.view.nodes.character.outputRef;
    if (characterRef === null) throw new Error(`run ${id} is waiting at gate C with no character`);
    const character = await store.readOutput<CharacterOutcome>(id, characterRef);
    if (!character.passed && parsed.data.acceptNotPassed !== true) {
      return reply.code(422).send({
        error: `the character description ended ${character.status}; render anyway only with acceptNotPassed`,
      });
    }
    if (deps.video === null) return reply.code(503).send({ error: NO_VIDEO });

    if (!(await resolve(reply, id, "C", { decision: "approve" }))) return reply;
    return submitRender(reply, id, deps.video);
  });

  app.post<IdParams>("/director/runs/:id/render/again", async (request, reply) => {
    const { id } = request.params;
    const run = await loadRun(id);
    if (!run) return notFound(reply, id);
    if (run.view.status !== "render_failed") {
      return reply.code(409).send({ error: `the run is ${run.view.status}; only a failed render can render again` });
    }
    if (deps.video === null) return reply.code(503).send({ error: NO_VIDEO });
    return submitRender(reply, id, deps.video);
  });

  // Server-sent events, replayed from the store (not memory) so a reconnect after a restart
  // still sees everything after its `Last-Event-ID`.
  app.get<IdParams>("/director/runs/:id/events", async (request, reply) => {
    const { id } = request.params;
    if (!(await loadRun(id))) return notFound(reply, id);
    const header = request.headers["last-event-id"];
    const after = typeof header === "string" && /^\d+$/.test(header.trim()) ? Number(header.trim()) : 0;

    let sent = after;
    let live = false;
    let closed = false;
    const buffered: DirectorEvent[] = [];
    const write = (event: DirectorEvent) => {
      if (closed || event.seq <= sent) return;
      reply.raw.write(formatDirectorSse(event));
      sent = event.seq;
    };
    // Subscribed BEFORE the replay is read: an event appended in between is buffered here,
    // and the seq check drops whichever copy arrives second.
    const unsubscribe = hub.subscribe(id, (event) => (live ? write(event) : buffered.push(event)));

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // A comment frame for intermediaries, not an event: it governs the transport, not the UI.
    const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), KEEPALIVE_MS);
    reply.raw.on("close", () => {
      closed = true;
      clearInterval(keepalive);
      unsubscribe();
    });

    try {
      for (const event of await store.events(id, after)) write(event);
    } catch (err) {
      app.log.error({ err, runId: id }, "director event replay failed");
      reply.raw.end();
      return;
    }
    for (const event of buffered.sort((a, b) => a.seq - b.seq)) write(event);
    buffered.length = 0;
    live = true;
  });
}
