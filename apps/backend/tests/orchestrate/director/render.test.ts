import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIRECTOR_VIDEO_SIZE,
  estimateMicroUsd,
  reduceDirectorEvents,
  SEEDANCE_MODEL,
  type AssembledPrompt,
  type DirectorEvent,
} from "@ai-director/contract";
import { FileDirectorRunStore } from "../../../src/store/FileDirectorRunStore.js";
import {
  nextRenderAttempt,
  resumeDirectorRenders,
  settleDirectorRender,
  submitDirectorRender,
} from "../../../src/orchestrate/director/render.js";
import { resumeAllDirectorRuns } from "../../../src/orchestrate/director/runner.js";
import { POLL_DEADLINE_MS, POLL_INTERVAL_MS } from "../../../src/compare/runComparison.js";
import {
  OpenRouterHttpError,
  type VideoTaskResult,
  type VideoTransport,
} from "../../../src/video/openrouterClient.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function setup(video: VideoTransport) {
  const root = await mkdtemp(path.join(tmpdir(), "director-render-"));
  roots.push(root);
  const store = new FileDirectorRunStore(root);
  const published: DirectorEvent[] = [];
  const runId = await store.createRun("a sparkling water ad");
  const deps = { store, video, publish: (ev: DirectorEvent) => published.push(ev), sleep: NO_SLEEP };
  return { root, store, runId, deps, published };
}

const NO_SLEEP = async () => undefined;

const PROMPT: AssembledPrompt = {
  text: "The first reference image is @can. The second reference image is @kitchen. Shot 1: ...",
  sha256: "c".repeat(64),
  // Deliberately out of slot order: the request must follow the slots, not the array.
  references: [
    { slot: 2, handle: "@kitchen", kind: "location", url: "https://abc.ufs.sh/f/kitchen.png", asset: "assets/kitchen.png" },
    { slot: 1, handle: "@can", kind: "product", url: "https://utfs.io/f/can.png", asset: "assets/can.png" },
  ],
};

function result(taskId: string, over: Partial<VideoTaskResult> = {}): VideoTaskResult {
  return { taskId, status: "succeeded", failureCode: null, failure: null, actualMicroUsd: 3_470_000, ...over };
}

function fakeVideo(over: Partial<VideoTransport> = {}): VideoTransport & {
  submit: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  fetchClip: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  return {
    submit: vi.fn(async () => ({ taskId: `task-${++n}` })),
    check: vi.fn(async (taskId: string) => result(taskId)),
    fetchClip: vi.fn(async () => ({ bytes: Buffer.from([9, 8, 7]), mediaType: "video/mp4" })),
    ...over,
  } as never;
}

const ofType = <T extends DirectorEvent["type"]>(events: DirectorEvent[], type: T) =>
  events.filter((e): e is Extract<DirectorEvent, { type: T }> => e.type === type);

describe("submitDirectorRender", () => {
  it("sends one Seedance request with the references in slot order and logs render.submitted", async () => {
    const video = fakeVideo();
    const { store, runId, deps, published } = await setup(video);

    const outcome = await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 15 });

    expect(outcome).toBe("submitted");
    expect(video.submit).toHaveBeenCalledTimes(1);
    expect(video.submit.mock.calls[0]![0]).toEqual({
      model: SEEDANCE_MODEL,
      prompt: PROMPT.text,
      duration: 15,
      size: DIRECTOR_VIDEO_SIZE,
      generate_audio: true,
      input_references: [
        { type: "image_url", image_url: { url: "https://utfs.io/f/can.png" } },
        { type: "image_url", image_url: { url: "https://abc.ufs.sh/f/kitchen.png" } },
      ],
    });
    const submitted = ofType(await store.events(runId), "render.submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      attempt: 1,
      taskId: "task-1",
      estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, 15),
    });
    expect(published.map((e) => e.type)).toEqual(["render.submitted"]);
    expect(reduceDirectorEvents(await store.events(runId)).status).toBe("rendering");
  });

  it("appends render.submitted before anything checks the task", async () => {
    const seenAtCheck: number[] = [];
    const video = fakeVideo();
    const ctx = await setup(video);
    video.check.mockImplementation(async (taskId: string) => {
      seenAtCheck.push(ofType(await ctx.store.events(ctx.runId), "render.submitted").length);
      return result(taskId);
    });
    await submitDirectorRender(ctx.deps, { runId: ctx.runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(ctx.deps, { runId: ctx.runId, attempt: 1 });
    expect(seenAtCheck).toEqual([1]);
  });

  it("a second press for the same attempt never submits again, even concurrently", async () => {
    const video = fakeVideo();
    const { store, runId, deps } = await setup(video);
    const args = { runId, attempt: 1, prompt: PROMPT, seconds: 4 };

    const outcomes = await Promise.all([submitDirectorRender(deps, args), submitDirectorRender(deps, args)]);
    const third = await submitDirectorRender(deps, args);

    expect(outcomes.sort()).toEqual(["already_claimed", "submitted"]);
    expect(third).toBe("already_claimed");
    expect(video.submit).toHaveBeenCalledTimes(1);
    expect(ofType(await store.events(runId), "render.submitted")).toHaveLength(1);
  });

  it("a submit timeout settles failed with billing unknown, and nothing ever submits it again", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const video = fakeVideo({ submit: vi.fn(async () => Promise.reject(timeout)) });
    const { store, runId, deps } = await setup(video);

    const outcome = await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await resumeDirectorRenders(deps);
    await resumeAllDirectorRuns({ store, recipe: [] });
    await resumeDirectorRenders(deps);

    expect(outcome).toBe("submit_failed");
    expect(video.submit).toHaveBeenCalledTimes(1);
    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing: "unknown", actualMicroUsd: null, failure: expect.stringContaining("timeout") }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed" })]);
    expect(reduceDirectorEvents(events).status).toBe("render_failed");
  });

  it("a 4xx from OpenRouter settles failed with billing not_billed", async () => {
    const video = fakeVideo({ submit: vi.fn(async () => Promise.reject(new OpenRouterHttpError("bad size", 400))) });
    const { store, runId, deps } = await setup(video);

    expect(await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 })).toBe("submit_failed");

    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing: "not_billed", failure: "bad size" }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([
      expect.objectContaining({ status: "render_failed", reason: "bad size" }),
    ]);
  });

  it.each([
    ["a foreign host", "https://example.com/can.png"],
    ["plain http", "http://utfs.io/f/can.png"],
    ["a lookalike host", "https://ufs.sh.evil.com/can.png"],
  ])("a reference on %s never reaches submit and settles not_billed", async (_label, url) => {
    const video = fakeVideo();
    const { store, runId, deps } = await setup(video);
    const prompt: AssembledPrompt = {
      ...PROMPT,
      references: [PROMPT.references[1]!, { ...PROMPT.references[0]!, url }],
    };

    expect(await submitDirectorRender(deps, { runId, attempt: 1, prompt, seconds: 4 })).toBe("submit_failed");

    expect(video.submit).not.toHaveBeenCalled();
    const events = await store.events(runId);
    expect(ofType(events, "render.submitted")).toHaveLength(0);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing: "not_billed", failure: expect.stringContaining("@kitchen") }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed" })]);
  });

  it("a prompt with no references sends no input_references field", async () => {
    const video = fakeVideo();
    const { runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: { ...PROMPT, references: [] }, seconds: 4 });
    expect(video.submit.mock.calls[0]![0]).not.toHaveProperty("input_references");
  });
});

describe("settleDirectorRender", () => {
  it("polls to success, saves clip.<attempt>.mp4 and records what OpenRouter billed", async () => {
    let reads = 0;
    const video = fakeVideo({
      check: vi.fn(async (taskId: string) =>
        ++reads < 3 ? result(taskId, { status: reads === 1 ? "queued" : "running", actualMicroUsd: null }) : result(taskId, { actualMicroUsd: 3_512_000 }),
      ),
    });
    const { root, store, runId, deps, published } = await setup(video);
    const slept: number[] = [];

    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 15 });
    await settleDirectorRender({ ...deps, sleep: async (ms) => void slept.push(ms) }, { runId, attempt: 1 });

    expect(video.check).toHaveBeenCalledTimes(3);
    expect(video.check).toHaveBeenCalledWith("task-1");
    expect(slept).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    expect(video.fetchClip).toHaveBeenCalledWith("task-1");
    expect([...(await readFile(path.join(root, runId, "assets", "clip.1.mp4")))]).toEqual([9, 8, 7]);

    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "succeeded", billing: "billed", actualMicroUsd: 3_512_000, failure: null }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "rendered", reason: null })]);
    const view = reduceDirectorEvents(events);
    expect(view.status).toBe("rendered");
    // The bill never overwrites the estimate.
    expect(view.render).toMatchObject({
      attempt: 1,
      estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, 15),
      actualMicroUsd: 3_512_000,
      billing: "billed",
    });
    expect(published.map((e) => e.type)).toEqual([
      "render.submitted",
      "render.polled",
      "render.polled",
      "render.settled",
      "run.finished",
    ]);
    expect(video.submit).toHaveBeenCalledTimes(1);
  });

  it("a status read that throws is not a settlement: polling carries on", async () => {
    let reads = 0;
    const video = fakeVideo({
      check: vi.fn(async (taskId: string) => {
        if (++reads === 1) throw new Error("socket hang up");
        return result(taskId);
      }),
    });
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(deps, { runId, attempt: 1 });
    expect(video.check).toHaveBeenCalledTimes(2);
    expect(reduceDirectorEvents(await store.events(runId)).status).toBe("rendered");
  });

  it.each([
    ["no cost reported", null, "unknown"],
    ["a cost reported", 120_000, "billed"],
  ] as const)("a failed render with %s settles billing %s", async (_label, actualMicroUsd, billing) => {
    const video = fakeVideo({
      check: vi.fn(async (taskId: string) =>
        result(taskId, { status: "failed", failureCode: "CONTENT", failure: "refused", actualMicroUsd }),
      ),
    });
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(deps, { runId, attempt: 1 });

    const events = await store.events(runId);
    expect(video.fetchClip).not.toHaveBeenCalled();
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing, actualMicroUsd, failure: "refused" }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed", reason: "refused" })]);
  });

  it("past the poll deadline it settles failed, billing unknown, and keeps the task id in the log", async () => {
    let clock = 0;
    const video = fakeVideo({ check: vi.fn(async (taskId: string) => result(taskId, { status: "running", actualMicroUsd: null })) });
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(
      { ...deps, now: () => clock, sleep: async (ms) => void (clock += ms) },
      { runId, attempt: 1 },
    );

    expect(video.check).toHaveBeenCalledTimes(POLL_DEADLINE_MS / POLL_INTERVAL_MS + 1);
    const events = await store.events(runId);
    expect(ofType(events, "render.submitted")[0]!.taskId).toBe("task-1");
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing: "unknown", failure: expect.stringContaining("task-1") }),
    ]);
    expect(ofType(events, "render.polled")).toHaveLength(1);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed" })]);
    expect(video.submit).toHaveBeenCalledTimes(1);
  });

  it("a succeeded render whose clip cannot be fetched stays billed and the run is render_failed", async () => {
    const video = fakeVideo({ fetchClip: vi.fn(async () => Promise.reject(new Error("404 content gone"))) });
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(deps, { runId, attempt: 1 });

    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "succeeded", billing: "billed", actualMicroUsd: 3_470_000, failure: expect.stringContaining("404 content gone") }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed" })]);
    expect(reduceDirectorEvents(events).status).toBe("render_failed");
  });

  it("settling twice appends one render.settled", async () => {
    const video = fakeVideo();
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await Promise.all([settleDirectorRender(deps, { runId, attempt: 1 }), settleDirectorRender(deps, { runId, attempt: 1 })]);
    await settleDirectorRender(deps, { runId, attempt: 1 });
    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toHaveLength(1);
    expect(ofType(events, "run.finished")).toHaveLength(1);
  });

  it("refuses an attempt that was never submitted", async () => {
    const { runId, deps } = await setup(fakeVideo());
    await expect(settleDirectorRender(deps, { runId, attempt: 1 })).rejects.toThrow(/never submitted/);
  });
});

describe("render again", () => {
  it("after render_failed the next attempt takes its own claim and its own estimate", async () => {
    let n = 0;
    const video = fakeVideo({
      check: vi.fn(async (taskId: string) =>
        ++n === 1 ? result(taskId, { status: "failed", failure: "refused", actualMicroUsd: null }) : result(taskId),
      ),
    });
    const { root, store, runId, deps } = await setup(video);

    expect(nextRenderAttempt(await store.events(runId))).toBe(1);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(deps, { runId, attempt: 1 });
    expect(reduceDirectorEvents(await store.events(runId)).status).toBe("render_failed");

    const attempt = nextRenderAttempt(await store.events(runId));
    expect(attempt).toBe(2);
    expect(await submitDirectorRender(deps, { runId, attempt, prompt: PROMPT, seconds: 8 })).toBe("submitted");
    await settleDirectorRender(deps, { runId, attempt });

    expect(video.submit).toHaveBeenCalledTimes(2);
    const view = reduceDirectorEvents(await store.events(runId));
    expect(view.status).toBe("rendered");
    expect(view.render).toMatchObject({ attempt: 2, estimatedMicroUsd: estimateMicroUsd(DIRECTOR_VIDEO_SIZE, 8) });
    expect([...(await readFile(path.join(root, runId, "assets", "clip.2.mp4")))]).toEqual([9, 8, 7]);
  });

  it("nextRenderAttempt counts a submit that failed before render.submitted", async () => {
    const video = fakeVideo({ submit: vi.fn(async () => Promise.reject(new OpenRouterHttpError("no", 422))) });
    const { store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    expect(nextRenderAttempt(await store.events(runId))).toBe(2);
  });
});

describe("resumeDirectorRenders", () => {
  it("a claim with render.submitted and no settlement keeps polling, and never resubmits", async () => {
    const video = fakeVideo();
    const { root, store, runId, deps } = await setup(video);
    await submitDirectorRender(deps, { runId, attempt: 1, prompt: PROMPT, seconds: 4 });
    // The process died here: submitted, never settled.

    await resumeDirectorRenders(deps);

    expect(video.submit).toHaveBeenCalledTimes(1);
    expect(video.check).toHaveBeenCalledWith("task-1");
    expect(reduceDirectorEvents(await store.events(runId)).status).toBe("rendered");
    expect([...(await readFile(path.join(root, runId, "assets", "clip.1.mp4")))]).toEqual([9, 8, 7]);
  });

  it("a claim with no render.submitted settles failed with billing unknown, never submitting", async () => {
    const video = fakeVideo();
    const { store, runId, deps } = await setup(video);
    // The process died between the claim and the submit's answer.
    await store.claimRender(runId, 1);

    await resumeDirectorRenders(deps);
    await resumeDirectorRenders(deps);

    expect(video.submit).not.toHaveBeenCalled();
    expect(video.check).not.toHaveBeenCalled();
    const events = await store.events(runId);
    expect(ofType(events, "render.settled")).toEqual([
      expect.objectContaining({ status: "failed", billing: "unknown", actualMicroUsd: null }),
    ]);
    expect(ofType(events, "run.finished")).toEqual([expect.objectContaining({ status: "render_failed" })]);
  });

  it("leaves runs without a claim, and settled renders, untouched", async () => {
    const video = fakeVideo();
    const { store, runId, deps } = await setup(video);
    const other = await store.createRun("another brief");
    await submitDirectorRender(deps, { runId: other, attempt: 1, prompt: PROMPT, seconds: 4 });
    await settleDirectorRender(deps, { runId: other, attempt: 1 });
    const before = [(await store.events(runId)).length, (await store.events(other)).length];

    await resumeDirectorRenders(deps);

    expect([(await store.events(runId)).length, (await store.events(other)).length]).toEqual(before);
    expect(video.submit).toHaveBeenCalledTimes(1);
    expect(video.check).toHaveBeenCalledTimes(1);
  });
});
