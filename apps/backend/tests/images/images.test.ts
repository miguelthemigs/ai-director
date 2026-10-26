import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiImageTransport } from "../../src/avatar/generateSheet.js";
import {
  createUploadThingHost,
  isUploadThingUrl,
  ReferenceHostConfigError,
  type ReferenceHost,
} from "../../src/images/referenceHost.js";
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

describe("isUploadThingUrl", () => {
  it("accepts https ufs.sh and utfs.io hosts only", () => {
    expect(isUploadThingUrl("https://abc.ufs.sh/f/key")).toBe(true);
    expect(isUploadThingUrl("https://utfs.io/f/key")).toBe(true);
    expect(isUploadThingUrl("http://abc.ufs.sh/f/key")).toBe(false);
    expect(isUploadThingUrl("https://evil.com/abc.ufs.sh")).toBe(false);
    expect(isUploadThingUrl("https://ufs.sh.evil.com/f")).toBe(false);
    expect(isUploadThingUrl("not a url")).toBe(false);
  });
});

describe("createUploadThingHost", () => {
  it("refuses without UPLOADTHING_TOKEN", () => {
    vi.stubEnv("UPLOADTHING_TOKEN", "");
    expect(() => createUploadThingHost()).toThrow(ReferenceHostConfigError);
  });

  it("uploads through the injected client and returns ufsUrl", async () => {
    const uploadFiles = vi.fn(async (_f: File) => ({
      data: { ufsUrl: "https://app.ufs.sh/f/abc" },
      error: null,
    }));
    const host = createUploadThingHost({ uploadFiles } as never);
    const out = await host.publish(Buffer.from("x"), "p.png", "image/png");
    expect(out).toEqual({ url: "https://app.ufs.sh/f/abc" });
    const file = uploadFiles.mock.calls[0]![0];
    expect(file.name).toBe("p.png");
    expect(file.type).toBe("image/png");
  });

  it("throws when the upload errors, or returns a non-UploadThing url", async () => {
    const bad = createUploadThingHost({
      uploadFiles: async () => ({ data: null, error: { message: "nope" } }),
    } as never);
    await expect(bad.publish(Buffer.from("x"), "p.png", "image/png")).rejects.toThrow(/nope/);
    const odd = createUploadThingHost({
      uploadFiles: async () => ({ data: { ufsUrl: "https://evil.com/x" }, error: null }),
    } as never);
    await expect(odd.publish(Buffer.from("x"), "p.png", "image/png")).rejects.toThrow(/UploadThing/);
  });
});

describe("makeProductPicture / makeLocationPicture", () => {
  const host = (): ReferenceHost & { publish: ReturnType<typeof vi.fn> } => ({
    publish: vi.fn(async () => ({ url: "https://app.ufs.sh/f/made" })),
  });

  it("product: sends the photo as reference, saves the asset, publishes it", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const images = vi.fn<ImageTransport>(async () => OUT);
    const h = host();
    const ref = await makeProductPicture(
      { images, host: h, store },
      { runId, photo: PHOTO, productKind: "a mug", handle: "mug" },
    );
    expect(ref).toEqual({ slot: 1, handle: "mug", kind: "product", url: "https://app.ufs.sh/f/made", asset: "assets/product-mug.png" });
    const sent = images.mock.calls[0]![0];
    expect(sent.aspectRatio).toBe("1:1");
    expect(sent.referenceImages).toEqual([PHOTO]);
    expect(sent.prompt).toBe(productShotBrief("a mug"));
    expect(await store.readAsset(runId, ref.asset)).toEqual(Buffer.from("made-bytes"));
    expect(h.publish).toHaveBeenCalledWith(Buffer.from("made-bytes"), "product-mug.png", "image/png");
  });

  it("a plan handle keeps its @ on the reference, and leaves it out of the file name", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const h = host();
    const ref = await makeProductPicture(
      { images: vi.fn<ImageTransport>(async () => OUT), host: h, store },
      { runId, photo: PHOTO, productKind: "a mug", handle: "@mug" },
    );
    expect(ref).toMatchObject({ handle: "@mug", asset: "assets/product-mug.png" });
    expect(h.publish).toHaveBeenCalledWith(Buffer.from("made-bytes"), "product-mug.png", "image/png");
  });

  it("location: 9:16, slot 2, no reference images", async () => {
    const store = await newStore();
    const runId = await store.createRun("b");
    const images = vi.fn<ImageTransport>(async () => OUT);
    const ref = await makeLocationPicture(
      { images, host: host(), store },
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
