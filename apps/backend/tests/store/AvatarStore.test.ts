import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileAvatarStore } from "../../src/store/AvatarStore.js";

/** A one-pixel PNG, as base64. Small enough to keep the test fast, real enough to be bytes. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "avatars-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("FileAvatarStore", () => {
  it("writes the image as real bytes, not as base64 text", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });

    const onDisk = await readFile(path.join(root, record.id, "sheet.png"));
    // A PNG's first eight bytes are its signature. This is what makes the file openable in
    // an image viewer rather than a base64 blob with a .png name on it.
    expect(onDisk.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("names the file by media type, so the bytes and the extension agree", async () => {
    const store = new FileAvatarStore(root);
    const jpeg = await store.save({ imageBase64: PIXEL, mediaType: "image/jpeg", source: "uploaded" });
    await expect(readFile(path.join(root, jpeg.id, "sheet.jpg"))).resolves.toBeInstanceOf(Buffer);
  });

  it("keeps both prompts, because a bad prompt and a bad render look identical without them", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({
      imageBase64: PIXEL,
      mediaType: "image/png",
      source: "generated",
      imageModel: "gemini-3-pro-image",
      authoredPrompt: "A 29-year-old woman.",
      sheetPrompt: "Cinematic character reference sheet...",
      seedDescription: "a 29 year old woman",
    });

    const back = await store.get(record.id);
    expect(back).toMatchObject({
      imageModel: "gemini-3-pro-image",
      authoredPrompt: "A 29-year-old woman.",
      sheetPrompt: "Cinematic character reference sheet...",
      seedDescription: "a 29 year old woman",
      source: "generated",
    });
  });

  it("merges the description onto the same record, so image and paragraph are one artefact", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });

    const merged = await store.attachDescription(record.id, {
      description: "A woman in her thirties.",
      descriptionRaw: "A woman in her thirties.",
      descriptionTrimmed: false,
      describeModel: "claude-sonnet-5",
    });

    expect(merged.description).toBe("A woman in her thirties.");
    // And it survived the write, rather than only existing in the returned object.
    expect((await store.get(record.id))?.describeModel).toBe("claude-sonnet-5");
  });

  it("refuses to attach a description to an avatar that does not exist", async () => {
    const store = new FileAvatarStore(root);
    await expect(store.attachDescription("nope", { description: "x" })).rejects.toThrow(/not found/);
  });

  it("lists newest first", async () => {
    const store = new FileAvatarStore(root);
    const first = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });

    expect((await store.list()).map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("returns an empty list for a store nothing was ever written to", async () => {
    // Never an error: a fresh checkout has no avatars, and that is not a fault condition.
    await expect(new FileAvatarStore(path.join(root, "never-used")).list()).resolves.toEqual([]);
  });

  it("returns null rather than throwing for an unknown id", async () => {
    const store = new FileAvatarStore(root);
    await expect(store.get("nope")).resolves.toBeNull();
    await expect(store.readImage("nope")).resolves.toBeNull();
  });

  it("reads the image back with its media type", async () => {
    const store = new FileAvatarStore(root);
    const record = await store.save({ imageBase64: PIXEL, mediaType: "image/png", source: "generated" });

    const image = await store.readImage(record.id);
    expect(image?.mediaType).toBe("image/png");
    expect(image?.bytes.byteLength).toBeGreaterThan(0);
  });
});
