import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import type { RunStore } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";
import type { AvatarRouteDeps } from "../../src/server/routes/avatar.js";

function stubRunStore(): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id) => {
      throw new Error(`run ${id} not found`);
    },
    listRuns: async () => [],
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
