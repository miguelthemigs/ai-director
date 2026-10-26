import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCharacter } from "../../src/avatar/makeCharacter.js";
import { FileAvatarStore } from "../../src/store/AvatarStore.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "make-character-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PIXEL = "aGk=";

describe("makeCharacter", () => {
  it("authors, renders, saves, describes and attaches, returning the described record", async () => {
    const avatars = new FileAvatarStore(dir);
    const text = vi.fn(async () => ({ text: "  A tall woman with short black hair.  " }));
    const images = vi.fn(async () => ({ imageBase64: PIXEL, mediaType: "image/png" }));
    const vision = vi.fn(async () => ({ text: "A woman, black bob, grey coat." }));

    const record = await makeCharacter(
      { text, images, vision, avatars },
      { description: "a woman in a grey coat" },
    );

    expect(text).toHaveBeenCalledTimes(1);
    expect(images).toHaveBeenCalledTimes(1);
    expect(vision).toHaveBeenCalledTimes(1);
    expect(record.source).toBe("generated");
    expect(record.seedDescription).toBe("a woman in a grey coat");
    expect(record.authoredPrompt).toBe("A tall woman with short black hair.");
    expect(record.description).toBe("A woman, black bob, grey coat.");
    // What was returned is what was stored.
    expect(await avatars.get(record.id)).toEqual(record);
    expect((await avatars.readImage(record.id))?.bytes.toString("base64")).toBe(PIXEL);
  });

  it("throws, and renders nothing, when the authoring step returns no prompt", async () => {
    const avatars = new FileAvatarStore(dir);
    const images = vi.fn();
    await expect(
      makeCharacter(
        { text: async () => ({ text: "  " }), images, vision: vi.fn(), avatars },
        { description: "x" },
      ),
    ).rejects.toThrow(/no prompt/);
    expect(images).not.toHaveBeenCalled();
    expect(await avatars.list()).toEqual([]);
  });
});
