import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";
import type { AvatarRouteDeps } from "../../src/server/routes/avatar.js";
import { FileAvatarStore } from "../../src/store/AvatarStore.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function stubRunStore(): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id) => {
      throw new Error(`run ${id} not found`);
    },
    listRuns: async () => [],
    readPasses: async () => [],
  };
}

// `/avatar/*` never touches versions; these throw rather than returning a plausible empty
// row, so a test that reached them by accident fails loudly instead of passing on a stub.
const stubVersionStore: VersionStore = {
  list: async () => [],
  get: async () => {
    throw new Error("not used");
  },
  compare: async () => {
    throw new Error("not used");
  },
};

async function appWith(avatar: AvatarRouteDeps) {
  return buildApp({
    store: stubRunStore(),
    rubric: await loadRubric("v1"),
    startRun: async () => {
      throw new Error("not used");
    },
    versionStore: stubVersionStore,
    avatar,
  });
}

const PIXEL = "aGk=";

describe("POST /avatar/sheet", () => {
  it("503s with a readable reason when no image key was configured", async () => {
    // A missing key is a real state, not a crash. A server with no GOOGLE_AI_KEY grades
    // descriptions perfectly well and simply cannot render a sheet.
    const app = await appWith({ text: vi.fn() });
    const res = await app.inject({
      method: "POST",
      url: "/avatar/sheet",
      payload: { description: "a woman" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/GOOGLE_AI_KEY/);
  });

  it("authors the prompt, wraps it in the sheet layout, and returns both with the image", async () => {
    const text = vi.fn(async () => ({ text: "A 29-year-old woman." }));
    const image = vi.fn(async () => ({ imageBase64: PIXEL, mediaType: "image/png" }));
    const app = await appWith({ text, image });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/sheet",
      payload: { description: "a 29 year old woman" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imageBase64).toBe(PIXEL);
    expect(body.authoredPrompt).toBe("A 29-year-old woman.");
    // Both prompts come back. Telling a bad prompt apart from a bad render needs to see
    // what was actually sent.
    expect(body.sheetPrompt).toContain("Cinematic character reference sheet");
    expect(body.sheetPrompt).toContain("A 29-year-old woman.");
    expect(image).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "16:9" }));
  });

  it("502s rather than rendering a sheet from an empty authored prompt", async () => {
    const text = vi.fn(async () => ({ text: "   " }));
    const image = vi.fn();
    const app = await appWith({ text, image });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/sheet",
      payload: { description: "a woman" },
    });

    expect(res.statusCode).toBe(502);
    // The paid image call must not happen once the free step has already failed.
    expect(image).not.toHaveBeenCalled();
  });

  it("rejects an empty description before spending anything", async () => {
    const text = vi.fn();
    const image = vi.fn();
    const app = await appWith({ text, image });

    const res = await app.inject({ method: "POST", url: "/avatar/sheet", payload: { description: "  " } });

    expect(res.statusCode).toBe(400);
    expect(text).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
  });
});

describe("POST /avatar/describe", () => {
  it("503s when no vision key was configured", async () => {
    const app = await appWith({});
    const res = await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { imageBase64: PIXEL, mediaType: "image/png" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("returns the description, the raw text, and whether the cap cut it", async () => {
    const vision = vi.fn(async () => ({ text: "A woman in her thirties." }));
    const app = await appWith({ vision });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { imageBase64: PIXEL, mediaType: "image/png" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      description: "A woman in her thirties.",
      raw: "A woman in her thirties.",
      trimmed: false,
    });
  });

  it("rejects a media type the vision API does not accept, before spending anything", async () => {
    const vision = vi.fn();
    const app = await appWith({ vision });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { imageBase64: PIXEL, mediaType: "image/heic" },
    });

    expect(res.statusCode).toBe(400);
    expect(vision).not.toHaveBeenCalled();
  });

  it("rejects an image past the size cap", async () => {
    const vision = vi.fn();
    const app = await appWith({ vision });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { imageBase64: "a".repeat(8 * 1024 * 1024 + 1), mediaType: "image/png" },
    });

    expect(res.statusCode).toBe(400);
    expect(vision).not.toHaveBeenCalled();
  });
});


describe("the avatar store, through the routes", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "avatar-routes-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * A rendered sheet is a paid artefact. Before the store existed it lived only in the
   * response body and then in React state, so a reload, a dev-server restart or a dropped
   * connection destroyed it, and a vanished sheet was indistinguishable from a render that
   * never happened. It is written BEFORE the reply for exactly that reason.
   */
  it("persists the sheet and returns its id", async () => {
    const store = new FileAvatarStore(root);
    const app = await appWith({
      store,
      text: vi.fn(async () => ({ text: "A 29-year-old woman." })),
      image: vi.fn(async () => ({ imageBase64: PIXEL, mediaType: "image/png" })),
    });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/sheet",
      payload: { description: "a 29 year old woman" },
    });

    const id = res.json().id as string;
    expect(id).toBeTruthy();
    const record = await store.get(id);
    expect(record).toMatchObject({
      source: "generated",
      authoredPrompt: "A 29-year-old woman.",
      seedDescription: "a 29 year old woman",
    });
    expect(record?.sheetPrompt).toContain("Cinematic character reference sheet");
  });

  it("lists what it has stored, newest first, without the bytes", async () => {
    const store = new FileAvatarStore(root);
    await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });
    const app = await appWith({ store });

    const res = await app.inject({ method: "GET", url: "/avatar" });

    expect(res.statusCode).toBe(200);
    const avatars = res.json().avatars as unknown[];
    expect(avatars).toHaveLength(1);
    // A list of twenty sheets as base64 would be tens of megabytes of JSON for a strip of
    // thumbnails; the bytes come from `/avatar/:id/image` instead.
    expect(JSON.stringify(avatars)).not.toContain(PIXEL);
  });

  it("serves the image bytes with the right content type", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });
    const app = await appWith({ store });

    const res = await app.inject({ method: "GET", url: `/avatar/${record.id}/image` });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.rawPayload.byteLength).toBeGreaterThan(0);
  });

  it("404s for an avatar id that was never stored", async () => {
    const app = await appWith({ store: new FileAvatarStore(root) });
    const res = await app.inject({ method: "GET", url: "/avatar/nope/image" });
    expect(res.statusCode).toBe(404);
  });

  it("stores an uploaded sheet, so the gallery is the whole set", async () => {
    const store = new FileAvatarStore(root);
    const app = await appWith({ store });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/upload",
      payload: { imageBase64: PIXEL, mediaType: "image/png" },
    });

    expect(res.statusCode).toBe(200);
    expect((await store.get(res.json().id as string))?.source).toBe("uploaded");
  });

  it("attaches the description onto the avatar it was read from", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });
    const app = await appWith({
      store,
      vision: vi.fn(async () => ({ text: "A woman in her thirties." })),
    });

    await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { avatarId: record.id, imageBase64: PIXEL, mediaType: "image/png" },
    });

    // The image and the paragraph read off it are one unit of evidence, which is the whole
    // question this repo asks: what did the second step write about the first?
    expect((await store.get(record.id))?.description).toBe("A woman in her thirties.");
  });

  it("still returns the description when the record cannot be updated", async () => {
    const app = await appWith({
      store: new FileAvatarStore(root),
      vision: vi.fn(async () => ({ text: "A woman in her thirties." })),
    });

    const res = await app.inject({
      method: "POST",
      url: "/avatar/describe",
      payload: { avatarId: "does-not-exist", imageBase64: PIXEL, mediaType: "image/png" },
    });

    // The vision call was paid for and the answer is in hand. Failing the response over a
    // bookkeeping problem would throw away the thing the caller asked for.
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe("A woman in her thirties.");
  });
});
