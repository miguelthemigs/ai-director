import { describe, expect, it } from "vitest";
import { loadGrounding } from "../../src/avatar/grounding.js";
import type { AvatarRecord, AvatarStore } from "../../src/store/AvatarStore.js";

const record: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-10-05T00:00:00.000Z",
  source: "generated",
  mediaType: "image/jpeg",
  authoredPrompt: "BUILD: about 1.78m, average build",
};

function storeWith(
  image: { bytes: Buffer; mediaType: string } | null,
  rec: AvatarRecord | null = record,
): Pick<AvatarStore, "get" | "readImage"> {
  return { get: async () => rec, readImage: async () => image };
}

describe("loadGrounding", () => {
  it("returns the sheet as base64 and the avatar's stated facts", async () => {
    const grounding = await loadGrounding(
      storeWith({ bytes: Buffer.from("jpeg-bytes"), mediaType: "image/jpeg" }),
      "avatar-1",
    );

    expect(grounding).toEqual({
      sheet: { imageBase64: Buffer.from("jpeg-bytes").toString("base64"), mediaType: "image/jpeg" },
      statedFacts: "BUILD: about 1.78m, average build",
    });
  });

  it("returns null for an avatar with no stored sheet, so the caller refuses the run", async () => {
    expect(await loadGrounding(storeWith(null), "missing")).toBeNull();
  });

  it("returns null for a sheet the model cannot be sent", async () => {
    const grounding = await loadGrounding(
      storeWith({ bytes: Buffer.from("x"), mediaType: "image/tiff" }),
      "avatar-1",
    );
    expect(grounding).toBeNull();
  });

  it("still grounds on the sheet when the record carries no brief", async () => {
    const grounding = await loadGrounding(
      storeWith({ bytes: Buffer.from("x"), mediaType: "image/png" }, null),
      "avatar-1",
    );
    expect(grounding?.statedFacts).toBeNull();
    expect(grounding?.sheet.mediaType).toBe("image/png");
  });
});
