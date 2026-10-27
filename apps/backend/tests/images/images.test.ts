import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiImageTransport } from "../../src/avatar/generateSheet.js";
import {
  IMAGE_PROMPT_VERSION,
  locationPlateBrief,
  productShotBrief,
} from "../../src/images/prompts/v1.js";
import { makeLocationPicture, makeProductPicture } from "../../src/images/makeReference.js";
import { FileDirectorRunStore } from "../../src/store/FileDirectorRunStore.js";
import type { ImageTransport } from "../../src/avatar/generateSheet.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function newStore() {
  const root = await mkdtemp(path.join(tmpdir(), "images-"));
  roots.push(root);
  return new FileDirectorRunStore(root);
}

const PHOTO = { imageBase64: Buffer.from("photo-bytes").toString("base64"), mediaType: "image/jpeg" };
const OUT = { imageBase64: Buffer.from("made-bytes").toString("base64"), mediaType: "image/png" };

describe("the Gemini transport with reference images", () => {
  it("sends reference images as inlineData parts after the text part", async () => {
    vi.stubEnv("GOOGLE_AI_KEY", "fake");
    const generateContent = vi.fn(async (_req: unknown) => ({
      candidates: [{ content: { parts: [{ inlineData: { data: "AAAA", mimeType: "image/png" } }] } }],
    }));
    const transport = createGeminiImageTransport({ generateContent });
    const out = await transport({ model: "m", prompt: "hello", aspectRatio: "1:1", referenceImages: [PHOTO] });
    expect(out).toEqual({ imageBase64: "AAAA", mediaType: "image/png" });
    const req = generateContent.mock.calls[0]![0] as { contents: { parts: unknown[] }[] };
    expect(req.contents[0]!.parts).toEqual([
      { text: "hello" },
      { inlineData: { data: PHOTO.imageBase64, mimeType: "image/jpeg" } },
    ]);
  });

  it("sends only the text part when there are no reference images", async () => {
    vi.stubEnv("GOOGLE_AI_KEY", "fake");
    const generateContent = vi.fn(async (_req: unknown) => ({
      candidates: [{ content: { parts: [{ inlineData: { data: "AAAA" } }] } }],
    }));
    await createGeminiImageTransport({ generateContent })({ model: "m", prompt: "p", aspectRatio: "1:1" });
    const req = generateContent.mock.calls[0]![0] as { contents: { parts: unknown[] }[] };
    expect(req.contents[0]!.parts).toEqual([{ text: "p" }]);
  });
});

describe("briefs", () => {
  it("version is v1", () => expect(IMAGE_PROMPT_VERSION).toBe("v1"));

  it("two product briefs with different kinds differ only in the kind line", () => {
    const a = productShotBrief("a ceramic mug").split("\n");
    const b = productShotBrief("a tube of hand cream").split("\n");
    expect(a).toHaveLength(b.length);
    const differing = a.map((l, i) => i).filter((i) => a[i] !== b[i]);
    expect(differing).toHaveLength(1);
    expect(a[differing[0]!]).toContain("a ceramic mug");
    expect(b[differing[0]!]).toContain("a tube of hand cream");
  });

  it("asks for one view, exactly as the reference, with nothing else in frame", () => {
    const brief = productShotBrief("a mug");
    expect(brief).toContain("first reference image");
    expect(brief).toContain("three-quarter");
    expect(brief).toContain("no hands");
    expect(brief).not.toMatch(/two views|left view|right view/i);
  });

  it("the location brief is empty and carries the place and the style line", () => {
    const brief = locationPlateBrief("a narrow kitchen", "warm tungsten, teal shadows");
    expect(brief).toContain("nobody in the frame");
    expect(brief).toContain("a narrow kitchen");
    expect(brief).toContain("warm tungsten, teal shadows");
    expect(brief).toContain("three-quarter");
  });
});

describe("makeProductPicture / makeLocationPicture", () => {
  it("product: sends the photo as reference and keeps the picture in the run folder only", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const images = vi.fn<ImageTransport>(async () => OUT);
    const ref = await makeProductPicture(
      { images, store },
      { runId, photo: PHOTO, productKind: "a mug", handle: "mug" },
    );
    expect(ref).toEqual({ slot: 1, handle: "mug", kind: "product", asset: "assets/product-mug.png", mediaType: "image/png" });
    const sent = images.mock.calls[0]![0];
    expect(sent.aspectRatio).toBe("1:1");
    expect(sent.referenceImages).toEqual([PHOTO]);
    expect(sent.prompt).toBe(productShotBrief("a mug"));
    expect(await store.readAsset(runId, ref.asset)).toEqual(Buffer.from("made-bytes"));
  });

  it("a plan handle keeps its @ on the reference, and leaves it out of the file name", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const ref = await makeProductPicture(
      { images: vi.fn<ImageTransport>(async () => OUT), store },
      { runId, photo: PHOTO, productKind: "a mug", handle: "@mug" },
    );
    expect(ref).toMatchObject({ handle: "@mug", asset: "assets/product-mug.png" });
  });

  it("location: 9:16, slot 2, no reference images", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const images = vi.fn<ImageTransport>(async () => OUT);
    const ref = await makeLocationPicture(
      { images, store },
      { runId, description: "a kitchen", styleLine: "warm", handle: "kitchen" },
    );
    expect(ref).toMatchObject({ slot: 2, kind: "location", handle: "kitchen", asset: "assets/location-kitchen.png" });
    const sent = images.mock.calls[0]![0];
    expect(sent.aspectRatio).toBe("9:16");
    expect(sent.referenceImages).toBeUndefined();
    expect(sent.prompt).toBe(locationPlateBrief("a kitchen", "warm"));
    expect((await readFile(path.join(roots[0]!, runId, ref.asset))).length).toBeGreaterThan(0);
  });
});
