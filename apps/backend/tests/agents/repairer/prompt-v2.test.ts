import { describe, expect, it, vi } from "vitest";
import { repairSpans } from "../../../src/agents/repairer/run.js";
import { buildRepairerSystemPromptV2 } from "../../../src/agents/repairer/prompt-v2.js";
import { buildRepairerSystemPrompt } from "../../../src/agents/repairer/prompt.js";
import { loadRubric } from "../../../src/rubric/load.js";

const spans = [
  { spanId: "hair_spec:0", checkId: "hair_spec", quote: "wavy brown hair", start: 40, end: 55 },
];

const sheet = { imageBase64: "QUJD", mediaType: "image/jpeg" as const };

function transportReturning(newText: string) {
  return vi.fn().mockResolvedValue({
    parsed_output: {
      replacements: [{ spanId: "hair_spec:0", newText, rationale: "read off the close-up panel" }],
    },
  });
}

async function hairChecks() {
  const rubric = await loadRubric("v1");
  return rubric.checks.filter((c) => c.id === "hair_spec");
}

describe("repairer prompt v2", () => {
  it("sends the sheet with the fragments and reports v2", async () => {
    const transport = transportReturning("wavy brown hair, side part");
    const out = await repairSpans(
      { transport },
      { spans, checks: await hairChecks(), reasons: {}, sheet },
    );

    expect(out.promptVersion).toBe("v2");
    const call = transport.mock.calls[0]![0] as { image?: unknown; system: string };
    expect(call.image).toEqual(sheet);
    expect(call.system).toBe(buildRepairerSystemPromptV2(await hairChecks()));
  });

  it("runs v1 blind when no sheet is given, so the v1 evidence stays reproducible", async () => {
    const transport = transportReturning("chestnut-brown, shoulder-length");
    const out = await repairSpans({ transport }, { spans, checks: await hairChecks(), reasons: {} });

    expect(out.promptVersion).toBe("v1");
    const call = transport.mock.calls[0]![0] as { image?: unknown; system: string };
    expect(call.image).toBeUndefined();
    expect(call.system).toBe(buildRepairerSystemPrompt(await hairChecks()));
  });

  it("still never sends the whole description, sheet or not", async () => {
    const transport = transportReturning("wavy brown hair, side part");
    await repairSpans({ transport }, { spans, checks: await hairChecks(), reasons: {}, sheet });

    const call = transport.mock.calls[0]![0] as { user: string };
    expect(call.user).toContain("wavy brown hair");
    expect(call.user).not.toContain("wearing a black crewneck sweater");
  });

  it("reports v2 even when there was nothing to repair", async () => {
    const transport = vi.fn();
    const out = await repairSpans(
      { transport },
      { spans: [], checks: await hairChecks(), reasons: {}, sheet },
    );

    expect(out).toEqual({ replacements: [], rejected: [], promptVersion: "v2" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("binds every detail to what is visible, in both directions", async () => {
    const system = buildRepairerSystemPromptV2(await hairChecks());

    expect(system).toContain("VISIBLE IN THE SHEET");
    expect(system).toContain("LEAVE IT OUT");
    // The features v1 invented on run bee3bcd6 are named individually, because a
    // generic "do not invent" is what v1's rule 3 already implied and did not get.
    for (const feature of ["length", "build", "scar", "mole", "jewellery"]) {
      expect(system).toContain(feature);
    }
    // ...and the symmetric instruction, which matters just as much: an over-cautious
    // Repairer that withholds visible detail would score low for the wrong reason and
    // make the rubric look broken when it is not.
    expect(system).toContain("aim for the highest band the check offers");
    expect(system).toContain("Withholding a detail you can plainly see is as wrong");
  });

  it("carries a real height into the prompt when the avatar record states one", async () => {
    // Height is a RENDER DIRECTIVE for a video model: it sets how far off the ground
    // the head sits in a standing frame. The picture cannot show it, but the brief the
    // sheet was rendered from states it, so v2 is given that brief and told to copy the
    // figure rather than estimate one. Owner's call, 16 September 2026.
    const brief = "BUILD: about 1.78m, average build, medium frame, straight posture";
    const system = buildRepairerSystemPromptV2(await hairChecks(), brief);

    expect(system).toContain(brief);
    expect(system).toContain("Stated facts about this person");
    expect(system).toContain("ONLY if the stated facts above give it");
    expect(system).toContain("do not adjust it and do not round it");
  });

  it("falls back to proportion cues when the sheet was uploaded and no brief exists", async () => {
    // An uploaded photo has no brief and nobody knows how tall that person is, so the
    // honest answer is a proportion. `age_build` band 5 reads "height OR proportion",
    // so the check stays reachable either way.
    const system = buildRepairerSystemPromptV2(await hairChecks(), null);

    expect(system).toContain("no height or other absolute measurement is known");
    expect(system).toContain("long legs relative to the torso");
    expect(system).toContain("never a number you estimated from the picture");
  });

  it("passes the stated facts through repairSpans only on the v2 path", async () => {
    const brief = "BUILD: about 1.78m, average build, medium frame";
    const transport = transportReturning("wavy brown hair, side part");
    await repairSpans(
      { transport },
      { spans, checks: await hairChecks(), reasons: {}, sheet, statedFacts: brief },
    );
    expect((transport.mock.calls[0]![0] as { system: string }).system).toContain(brief);

    // v1 is blind by definition. Handing it a brief would make it a different prompt
    // than the one that produced the evidence in docs/repairer-cannot-see.md.
    const blind = transportReturning("chestnut-brown, shoulder-length");
    await repairSpans(
      { transport: blind },
      { spans, checks: await hairChecks(), reasons: {}, statedFacts: brief },
    );
    expect((blind.mock.calls[0]![0] as { system: string }).system).not.toContain(brief);
  });

  it("leaves the v1 prompt byte-identical, because v1 produced the evidence", async () => {
    const checks = await hairChecks();
    expect(buildRepairerSystemPrompt(checks)).not.toContain("SHEET");
    expect(buildRepairerSystemPrompt(checks)).toContain(
      "You are given only the fragments that failed a check, never the whole description.",
    );
  });
});
