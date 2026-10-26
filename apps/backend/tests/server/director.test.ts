import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssembledPrompt,
  CharacterOutcome,
  CheckOutcome,
  DirectorEvent,
  DirectorRunSummary,
  DirectorRunView,
} from "@ai-director/contract";
import { DirectorEventHub } from "../../src/orchestrate/director/hub.js";
import { buildRecipe, type DirectorAgents, type NodeResult } from "../../src/orchestrate/director/recipe.js";
import { buildApp } from "../../src/server/app.js";
import { resumeDirectorAfterRestart, type DirectorRouteDeps } from "../../src/server/routes/director.js";
import { formatDirectorSse } from "../../src/server/sse.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileAvatarStore } from "../../src/store/AvatarStore.js";
import { FileDirectorRunStore } from "../../src/store/FileDirectorRunStore.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";
import type { VideoTaskResult, VideoTransport } from "../../src/video/openrouterClient.js";

type AgentId = keyof DirectorAgents;

const roots: string[] = [];
const apps: Array<{ close: () => Promise<unknown> }> = [];
const stores: FileDirectorRunStore[] = [];
afterEach(async () => {
  // The routes fire drives and settles without awaiting them: let every run come to rest
  // (at a gate or finished) before its folder is removed under it.
  for (const store of stores.splice(0)) {
    await vi.waitFor(
      async () => {
        const runs = await store.listRuns();
        expect(runs.filter((run) => run.status === "running" || run.status === "rendering")).toEqual([]);
      },
      { timeout: 2000, interval: 5 },
    );
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const PNG = Buffer.from("a small png").toString("base64");
const pass = (id: CheckOutcome["id"], owner: CheckOutcome["owner"]): CheckOutcome => ({
  id,
  owner,
  passed: true,
  detail: null,
  shots: [],
});
const CHARACTER = (passed: boolean): CharacterOutcome => ({
  avatarId: "avatar-x",
  coachRunId: "coach-1",
  status: passed ? "passed" : "improved_still_failing",
  description: "A tall woman.",
  passed,
});
const PROMPT: AssembledPrompt = { text: "the final prompt", sha256: "abc", references: [] };

function fakeAgents(
  bodies: Partial<Record<AgentId, () => Promise<unknown>>> = {},
  characterPassed = true,
): DirectorAgents {
  const defaults: Record<AgentId, () => unknown> = {
    interrogator: () => ({ brief: "filled" }),
    director: () => ({ plan: "p" }),
    planChecks: () => [pass("length_fits", "director")],
    product: () => null,
    location: () => null,
    character: () => CHARACTER(characterPassed),
    cinematographer: () => ({ cameras: [] }),
    assembler: () => PROMPT,
    promptChecks: () => [pass("camera_per_shot", "cinematographer")],
  };
  return Object.fromEntries(
    (Object.keys(defaults) as AgentId[]).map((id) => [
      id,
      async (): Promise<NodeResult> => {
        const body = bodies[id];
        return { output: body ? await body() : defaults[id](), summary: `${id} done`, calls: [] };
      },
    ]),
  ) as unknown as DirectorAgents;
}

function fakeVideo(status: VideoTaskResult["status"] = "succeeded") {
  const submits: unknown[] = [];
  const video: VideoTransport = {
    submit: async (req) => {
      submits.push(req);
      return { taskId: `task-${submits.length}` };
    },
    check: async (taskId) => ({
      taskId,
      status,
      failureCode: null,
      failure: status === "succeeded" ? null : "the model refused",
      actualMicroUsd: 3_000_000,
    }),
    fetchClip: async () => ({ bytes: Buffer.from("mp4-bytes"), mediaType: "video/mp4" }),
  };
  return { video, submits };
}

const unusedRunStore = {} as RunStore;
const unusedVersionStore = {} as VersionStore;

async function setup(
  opts: { agents?: DirectorAgents; video?: VideoTransport | null; director?: false } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "director-routes-"));
  roots.push(root);
  const store = new FileDirectorRunStore(path.join(root, "runs"));
  stores.push(store);
  const avatars = new FileAvatarStore(path.join(root, "avatars"));
  const hub = new DirectorEventHub();
  const director: DirectorRouteDeps = {
    runner: { store, recipe: buildRecipe(opts.agents ?? fakeAgents()), publish: hub.publish },
    store,
    video: opts.video === undefined ? fakeVideo().video : opts.video,
    avatars,
    hub,
  };
  const app = buildApp({
    store: unusedRunStore,
    rubric: await loadRubric("v1"),
    startRun: async () => {
      throw new Error("not used");
    },
    versionStore: unusedVersionStore,
    ...(opts.director === false ? {} : { director }),
  });
  apps.push(app);
  return { app, store, avatars, root, director };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

async function view(app: App, id: string): Promise<DirectorRunView> {
  return (await app.inject({ method: "GET", url: `/director/runs/${id}` })).json();
}

/** Polls the run until `done` holds (the drives are fired, not awaited, by the routes). */
async function until(app: App, id: string, done: (v: DirectorRunView) => boolean): Promise<DirectorRunView> {
  for (let i = 0; i < 400; i++) {
    const current = await view(app, id);
    if (done(current)) return current;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`run ${id} never reached the state; last: ${JSON.stringify(await view(app, id))}`);
}

async function start(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/director/runs", payload: { brief: "cool ad for my water" } });
  expect(res.statusCode).toBe(202);
  return res.json().id;
}

const gateA = (overrides: Record<string, unknown> = {}) => ({
  photo: { imageBase64: PNG, mediaType: "image/png" },
  productKind: "a glass bottle",
  seconds: 15,
  mustNotAppear: ["dogs"],
  cast: { kind: "new" },
  ...overrides,
});

async function toGateC(app: App): Promise<string> {
  const id = await start(app);
  await until(app, id, (v) => v.waitingAt === "A");
  expect((await app.inject({ method: "POST", url: `/director/runs/${id}/gates/A`, payload: gateA() })).statusCode).toBe(202);
  await until(app, id, (v) => v.waitingAt === "B");
  expect(
    (await app.inject({ method: "POST", url: `/director/runs/${id}/gates/B`, payload: { decision: "approve" } })).statusCode,
  ).toBe(202);
  await until(app, id, (v) => v.waitingAt === "C");
  return id;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Director routes", () => {
  it("answers 503 on every /director route when the Director is not configured", async () => {
    const { app } = await setup({ director: false });
    for (const [method, url] of [
      ["POST", "/director/runs"],
      ["GET", "/director/runs"],
      ["GET", "/director/runs/x"],
      ["POST", "/director/runs/x/gates/C"],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        error: "the Director needs ANTHROPIC_API_KEY, GOOGLE_AI_KEY and UPLOADTHING_TOKEN",
      });
    }
  });

  it("runs the happy path through gates A, B and C to a rendered clip", async () => {
    const { video, submits } = fakeVideo();
    const { app, store } = await setup({ video });
    const id = await toGateC(app);

    // Gate A saved the photo and handed its ref on as the answer.
    const answers = await store.readAnswers(id);
    expect(answers).toEqual({
      productPhotoAsset: "assets/photo.png",
      productKind: "a glass bottle",
      seconds: 15,
      mustNotAppear: ["dogs"],
      cast: { kind: "new" },
    });
    const photo = await app.inject({ method: "GET", url: `/director/runs/${id}/asset?ref=assets/photo.png` });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/png");
    expect(photo.rawPayload).toEqual(Buffer.from(PNG, "base64"));

    const c = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    expect(c.statusCode).toBe(202);
    const done = await until(app, id, (v) => v.status === "rendered");
    expect(done.render).toMatchObject({ attempt: 1, billing: "billed", actualMicroUsd: 3_000_000 });
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ prompt: "the final prompt", duration: 15 });

    const clip = await app.inject({ method: "GET", url: `/director/runs/${id}/clip?attempt=1` });
    expect(clip.statusCode).toBe(200);
    expect(clip.headers["content-type"]).toBe("video/mp4");
    expect(clip.rawPayload).toEqual(Buffer.from("mp4-bytes"));
    expect((await app.inject({ method: "GET", url: `/director/runs/${id}/clip?attempt=2` })).statusCode).toBe(404);

    const output = await app.inject({
      method: "GET",
      url: `/director/runs/${id}/output?ref=${done.nodes.assembler.outputRef}`,
    });
    expect(output.json()).toEqual(PROMPT);

    const list: DirectorRunSummary[] = (await app.inject({ method: "GET", url: "/director/runs" })).json();
    expect(list).toEqual([expect.objectContaining({ id, status: "rendered", billedMicroUsd: 3_000_000 })]);
  });

  it("answers 202 before the agents finish: a run start, and a gate", async () => {
    const interrogating = deferred();
    const shooting = deferred();
    const { app } = await setup({
      agents: fakeAgents({
        interrogator: async () => {
          await interrogating.promise;
          return { brief: "filled" };
        },
        cinematographer: async () => {
          await shooting.promise;
          return { cameras: [] };
        },
      }),
    });
    const id = await start(app);
    await until(app, id, (v) => v.nodes.interrogator.status === "running");
    interrogating.resolve();

    await until(app, id, (v) => v.waitingAt === "A");
    await app.inject({ method: "POST", url: `/director/runs/${id}/gates/A`, payload: gateA() });
    await until(app, id, (v) => v.waitingAt === "B");
    const b = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/B`, payload: { decision: "approve" } });
    expect(b.statusCode).toBe(202);
    await until(app, id, (v) => v.nodes.cinematographer.status === "running");
    shooting.resolve();
    await until(app, id, (v) => v.waitingAt === "C");
  });

  it("answers 409 to a gate answered out of order, and changes nothing", async () => {
    const { app, store } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    const before = await store.events(id);
    const res = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/B`, payload: { decision: "approve" } });
    expect(res.statusCode).toBe(409);
    const c = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    expect(c.statusCode).toBe(409);
    expect(await store.events(id)).toEqual(before);
  });

  it("refuses a 7 MB photo with 400 and writes nothing", async () => {
    const { app, store, root } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    const big = Buffer.alloc(7 * 1024 * 1024, 1).toString("base64");
    const res = await app.inject({
      method: "POST",
      url: `/director/runs/${id}/gates/A`,
      payload: gateA({ photo: { imageBase64: big, mediaType: "image/png" } }),
    });
    expect(res.statusCode).toBe(400);
    expect(await readdir(path.join(root, "runs", id, "assets"))).toEqual([]);
    expect(await store.readAnswers(id)).toBeNull();
    expect((await view(app, id)).waitingAt).toBe("A");
  });

  it("validates the rest of gate A: media type, seconds, and the avatar cast", async () => {
    const { app, avatars } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/director/runs/${id}/gates/A`, payload });

    expect((await post(gateA({ photo: { imageBase64: PNG, mediaType: "application/pdf" } }))).statusCode).toBe(400);
    expect((await post(gateA({ seconds: 3 }))).statusCode).toBe(400);
    expect((await post(gateA({ seconds: 12.5 }))).statusCode).toBe(400);
    expect((await post(gateA({ cast: { kind: "avatar", avatarId: "nobody" } }))).statusCode).toBe(422);
    const bare = await avatars.save({ imageBase64: PNG, mediaType: "image/png", source: "uploaded" });
    expect((await post(gateA({ cast: { kind: "avatar", avatarId: bare.id } }))).statusCode).toBe(422);
    expect((await view(app, id)).waitingAt).toBe("A");

    await avatars.attachDescription(bare.id, { description: "A tall woman." });
    expect((await post(gateA({ cast: { kind: "avatar", avatarId: bare.id } }))).statusCode).toBe(202);
  });

  it("answers 409 to a second render press, and submits once", async () => {
    const { video, submits } = fakeVideo();
    const { app } = await setup({ video });
    const id = await toGateC(app);
    const press = () =>
      app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    const [first, second] = await Promise.all([press(), press()]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([202, 409]);
    await until(app, id, (v) => v.status === "rendered");
    expect((await press()).statusCode).toBe(409);
    expect(submits).toHaveLength(1);
  });

  it("answers 422 when the character did not pass, unless the user accepts it", async () => {
    const { video, submits } = fakeVideo();
    const { app } = await setup({ video, agents: fakeAgents({}, false) });
    const id = await toGateC(app);
    const res = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    expect(res.statusCode).toBe(422);
    expect(submits).toHaveLength(0);
    expect((await view(app, id)).waitingAt).toBe("C");

    const accepted = await app.inject({
      method: "POST",
      url: `/director/runs/${id}/gates/C`,
      payload: { decision: "render", acceptNotPassed: true },
    });
    expect(accepted.statusCode).toBe(202);
    expect(submits).toHaveLength(1);
  });

  it("answers 503 to a render with no video transport, and leaves the gate waiting", async () => {
    const { app } = await setup({ video: null });
    const id = await toGateC(app);
    const res = await app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    expect(res.statusCode).toBe(503);
    expect((await view(app, id)).waitingAt).toBe("C");
  });

  it("rejecting at B ends the run rejected with the reason stored", async () => {
    const { app } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    await app.inject({ method: "POST", url: `/director/runs/${id}/gates/A`, payload: gateA() });
    await until(app, id, (v) => v.waitingAt === "B");
    const res = await app.inject({
      method: "POST",
      url: `/director/runs/${id}/gates/B`,
      payload: { decision: "reject", reason: "too many shots" },
    });
    expect(res.statusCode).toBe(202);
    const done = await view(app, id);
    expect(done.status).toBe("rejected");
    expect(done.reason).toBe("too many shots");
  });

  it("rejecting at C ends the run rejected, and submits nothing", async () => {
    const { video, submits } = fakeVideo();
    const { app } = await setup({ video });
    const id = await toGateC(app);
    const res = await app.inject({
      method: "POST",
      url: `/director/runs/${id}/gates/C`,
      payload: { decision: "reject", reason: "not the look" },
    });
    expect(res.statusCode).toBe(202);
    expect(await view(app, id)).toMatchObject({ status: "rejected", reason: "not the look" });
    expect(submits).toHaveLength(0);
  });

  it("renders again only after a failed render, as the next attempt", async () => {
    const { video, submits } = fakeVideo("failed");
    const { app } = await setup({ video });
    const id = await toGateC(app);
    const again = () => app.inject({ method: "POST", url: `/director/runs/${id}/render/again` });
    expect((await again()).statusCode).toBe(409);

    await app.inject({ method: "POST", url: `/director/runs/${id}/gates/C`, payload: { decision: "render" } });
    await until(app, id, (v) => v.status === "render_failed");
    const res = await again();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ attempt: 2 });
    const failedTwice = await until(app, id, (v) => v.status === "render_failed" && v.render?.attempt === 2);
    expect(failedTwice.render?.failure).toBe("the model refused");
    expect(submits).toHaveLength(2);
  });

  it("answers 404 for a run that does not exist, or an id the store refuses", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/director/runs/run-nope" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/director/runs/bad%20id" })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: "POST", url: "/director/runs/run-nope/gates/B", payload: { decision: "approve" } }))
        .statusCode,
    ).toBe(404);
  });

  it("refuses an output or asset ref outside its folder with 400", async () => {
    const { app } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    expect((await app.inject({ method: "GET", url: `/director/runs/${id}/output?ref=assets/x.json` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/director/runs/${id}/asset?ref=nodes/x.json` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/director/runs/${id}/asset?ref=assets/../x` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/director/runs/${id}/clip?attempt=0` })).statusCode).toBe(400);
  });
});

describe("GET /director/runs/:id/events", () => {
  /** Reads SSE frames off a real socket until `count` have arrived. */
  async function frames(url: string, headers: Record<string, string>, count: number, onOpen?: () => void) {
    const abort = new AbortController();
    const res = await fetch(url, { headers, signal: abort.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    onOpen?.();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const parsed: DirectorEvent[] = [];
    while (parsed.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const blocks = text.split("\n\n");
      text = blocks.pop()!;
      for (const block of blocks) {
        const data = block.split("\n").find((line) => line.startsWith("data: "));
        if (data) parsed.push(JSON.parse(data.slice(6)));
      }
    }
    abort.abort();
    return parsed;
  }

  it("replays from the store after Last-Event-ID, then streams live with nothing lost or doubled", async () => {
    const { app } = await setup();
    const id = await start(app);
    await until(app, id, (v) => v.waitingAt === "A");
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const before = (await view(app, id)).lastSeq;

    const events = await frames(`${address}/director/runs/${id}/events`, { "Last-Event-ID": "3" }, before - 3 + 2, () => {
      void app.inject({ method: "POST", url: `/director/runs/${id}/gates/A`, payload: gateA() });
    });
    const seqs = events.map((e) => e.seq);
    expect(seqs[0]).toBe(4);
    expect(seqs).toEqual(seqs.map((_, i) => 4 + i));
    expect(events.at(-1)!.seq).toBeGreaterThan(before);
  });

  it("answers 404 for an unknown run", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/director/runs/run-nope/events" })).statusCode).toBe(404);
  });
});

describe("formatDirectorSse", () => {
  it("frames an event with its seq as the id and its type as the event name", () => {
    const event: DirectorEvent = { type: "gate.opened", gate: "A", runId: "r", seq: 7, at: "t" };
    expect(formatDirectorSse(event)).toBe(`id: 7\nevent: gate.opened\ndata: ${JSON.stringify(event)}\n\n`);
  });
});

describe("DirectorEventHub", () => {
  it("delivers a run's events to its subscribers only, until they unsubscribe", () => {
    const hub = new DirectorEventHub();
    const mine = vi.fn();
    const other = vi.fn();
    const off = hub.subscribe("r1", mine);
    hub.subscribe("r2", other);
    const event: DirectorEvent = { type: "gate.opened", gate: "A", runId: "r1", seq: 1, at: "t" };
    hub.publish(event);
    off();
    hub.publish({ ...event, seq: 2 });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("a subscriber that throws does not reach the publisher", () => {
    const hub = new DirectorEventHub();
    hub.subscribe("r1", () => {
      throw new Error("socket gone");
    });
    expect(() => hub.publish({ type: "gate.opened", gate: "A", runId: "r1", seq: 1, at: "t" })).not.toThrow();
  });
});

describe("resumeDirectorAfterRestart", () => {
  it("returns at once, drives an unfinished run, and logs instead of throwing", async () => {
    const { store, director } = await setup();
    const id = await store.createRun("left running before a restart");
    const log = vi.fn();
    const broken: DirectorRouteDeps = {
      ...director,
      store: { listIds: async () => Promise.reject(new Error("disk gone")) } as never,
    };

    expect(resumeDirectorAfterRestart(director, log)).toBeUndefined();
    for (let i = 0; i < 200 && (await store.events(id)).every((e) => e.type !== "gate.opened"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await store.events(id)).some((e) => e.type === "gate.opened")).toBe(true);

    resumeDirectorAfterRestart(broken, log);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.any(Error), "director render resume failed"));
  });
});
