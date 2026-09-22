import { describe, expect, it, vi } from "vitest";
import { repairSpans } from "../../../src/agents/repairer/run.js";
import { statedFactsFor } from "../../../src/avatar/statedFacts.js";
import { loadRubric } from "../../../src/rubric/load.js";
import type { AvatarRecord } from "../../../src/store/AvatarStore.js";

/**
 * The seam `server.ts`'s `startRun` assembles, proved end to end.
 *
 * Written after a code review found v2 shipped completely unwired: the prompt, the
 * version vocabulary and `statedFactsFor` all existed and passed their own tests, and
 * no caller could reach any of them, so every run recorded "v1" and the Versions tab
 * sealed a v2 nothing could run. Unit tests on each piece did not catch that, because
 * each piece was correct.
 */

const AVATAR: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-09-12T13:23:27.890Z",
  source: "generated",
  mediaType: "image/jpeg",
  seedDescription: "a 20-year-old man, average build, average height",
  authoredPrompt: "BUILD: about 1.78m, average build, medium frame\nHAIR: medium-length wavy brown hair, side part",
  description: "A young man with wavy brown hair.",
};

const spans = [
  { spanId: "hair_spec:0", checkId: "hair_spec", quote: "wavy brown hair", start: 20, end: 35 },
];

async function hairChecks() {
  const rubric = await loadRubric("v1");
  return rubric.checks.filter((c) => c.id === "hair_spec");
}

/** Exactly what `startRun` builds when a run names an avatar. */
function grounding(record: AvatarRecord, bytes: Buffer) {
  return {
    sheet: { imageBase64: bytes.toString("base64"), mediaType: "image/jpeg" as const },
    statedFacts: statedFactsFor(record),
  };
}

describe("the v2 grounding the server assembles", () => {
  it("reaches the model as an image plus the avatar's real brief, and reports v2", async () => {
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          {
            spanId: "hair_spec:0",
            newText: "medium-length wavy brown hair, side part",
            rationale: "read off the close-up panel",
          },
        ],
      },
    });

    const out = await repairSpans(
      { transport },
      {
        spans,
        checks: await hairChecks(),
        reasons: {},
        ...grounding(AVATAR, Buffer.from([0xff, 0xd8, 0xff])),
      },
    );

    expect(out.promptVersion).toBe("v2");
    const call = transport.mock.calls[0]![0] as { image?: unknown; system: string };
    expect(call.image).toEqual({ imageBase64: "/9j/", mediaType: "image/jpeg" });
    // The real height, from the brief the sheet was rendered from, not from the pixels.
    expect(call.system).toContain("about 1.78m");
    expect(call.system).toContain("Stated facts about this person");
  });

  it("stays on blind v1 when the run names no avatar, which is what every old run did", async () => {
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [{ spanId: "hair_spec:0", newText: "brown hair", rationale: "r" }],
      },
    });

    const out = await repairSpans(
      { transport },
      { spans, checks: await hairChecks(), reasons: {} },
    );

    expect(out.promptVersion).toBe("v1");
    expect((transport.mock.calls[0]![0] as { image?: unknown }).image).toBeUndefined();
  });

  it("carries a height into v2 only from the brief, never invented from the picture", async () => {
    // The guided form said "average height"; the doctrine call turned that into 1.78m and
    // Nano Banana rendered the sheet from it. That number describes the picture by
    // construction, which is why it is the one v2 is allowed to state.
    expect(statedFactsFor(AVATAR)).toContain("1.78m");
    expect(statedFactsFor({ ...AVATAR, source: "uploaded", authoredPrompt: undefined, seedDescription: undefined })).toBeNull();
  });
});
