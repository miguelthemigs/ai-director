import { describe, expect, it } from "vitest";
import { buildDirectorPatchSystemPrompt, buildDirectorSystemPrompt } from "../../../src/agents/director/prompt-v1.js";
import {
  buildDirectorPatchSystemPromptV2,
  buildDirectorSystemPromptV2,
  renderLabDirectorPatchRequest,
  renderLabDirectorRequest,
} from "../../../src/agents/director/prompt-v2.js";
import { boardPlan } from "../../orchestrate/director/planFixture.js";
import { labBrief } from "../../lab/labFixture.js";

const NEW_PRODUCT_LINE =
  "- The product's description says what kind of thing it is and what a camera sees of it: its shape, materials and colours, from the website text in the request. Never a brand name, logo, lettering or label text: the ad shows no brand, and words on a label are how a label gets rewritten.";

describe("Director v2 system prompt", () => {
  const v1 = buildDirectorSystemPrompt().split("\n");
  const v2 = buildDirectorSystemPromptV2().split("\n");

  it("lets the product be described, since there is no photo", () => {
    expect(v2).toContain(NEW_PRODUCT_LINE);
    expect(buildDirectorSystemPromptV2()).not.toContain("the owner's photo carries the look");
    expect(buildDirectorSystemPromptV2()).not.toContain("painted as a picture");
  });

  it("changes nothing else", () => {
    expect(v2).toHaveLength(v1.length);
    const changed = v1.map((line, i) => (line === v2[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toHaveLength(2);
  });

  it("keeps v1's patch rules on top of the v2 prompt", () => {
    const patch = buildDirectorPatchSystemPromptV2();
    expect(patch.startsWith(buildDirectorSystemPromptV2())).toBe(true);
    expect(patch.slice(buildDirectorSystemPromptV2().length)).toBe(
      buildDirectorPatchSystemPrompt().slice(buildDirectorSystemPrompt().length),
    );
  });
});

describe("renderLabDirectorRequest", () => {
  it("carries the product, the length and what is ruled out", () => {
    const text = renderLabDirectorRequest(labBrief());
    expect(text).toContain("- The product, as the website and the owner describe it: over-ear headphones in sand-coloured fabric");
    expect(text).toContain("the owner chose 15 seconds, so the shot counts must add up to between 13 and 17");
    expect(text).toContain('"cats"');
    expect(text).toContain("a new person will be cast");
  });

  it("tells the Director when a saved person is cast", () => {
    const text = renderLabDirectorRequest(labBrief({ avatar: { avatarId: "a1", description: "A young man." } }));
    expect(text).toContain("the owner picked one of their existing people");
  });

  it("puts the plan and the failures in a patch request", () => {
    const text = renderLabDirectorPatchRequest({
      brief: labBrief(),
      plan: boardPlan(),
      failures: [{ id: "length_fits", passed: false, owner: "director", detail: "3 + 4 = 7 s, you chose 15 s", shots: [] }],
    });
    expect(text).toContain('"styleLine": "Warm handheld lifestyle ad, natural colour"');
    expect(text).toContain("failed: 3 + 4 = 7 s, you chose 15 s.");
    expect(text.endsWith("Return the whole plan with these failures fixed.")).toBe(true);
  });
});
