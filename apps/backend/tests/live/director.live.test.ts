import { CAMERA_MOVES, type GateAAnswers } from "@ai-director/contract";
import { describe, expect, it } from "vitest";
import { shootAll } from "../../src/agents/cinematographer/run.js";
import { CINEMATOGRAPHER_PROMPT_VERSION } from "../../src/agents/cinematographer/prompt-v1.js";
import { direct } from "../../src/agents/director/run.js";
import { DIRECTOR_PROMPT_VERSION } from "../../src/agents/director/prompt-v1.js";
import { interrogate } from "../../src/agents/interrogator/run.js";
import { INTERROGATOR_PROMPT_VERSION } from "../../src/agents/interrogator/prompt-v1.js";
import { createAnthropicTransport } from "../../src/api/client.js";
import { meter } from "../../src/orchestrate/director/metered.js";

// Three real text calls (cents). Skipped unless a human opts in with RUN_LIVE_API=1:
//   RUN_LIVE_API=1 npx vitest run apps/backend/tests/live/director.live.test.ts
// It asserts shape and the model that served each call, nothing about taste: the
// plan checks judge the plan, and the owner judges the ad.
describe.skipIf(process.env.RUN_LIVE_API !== "1")("Interrogator, Director and Cinematographer against the real API", () => {
  it("fills a placeholder brief, plans it and shoots it, each on claude-opus-5", async () => {
    const transport = createAnthropicTransport();

    const interrogator = meter(transport, INTERROGATOR_PROMPT_VERSION);
    const brief = await interrogate(
      { transport: interrogator.transport },
      { brief: "a short ad for a reusable water bottle" },
    );
    expect(brief.productKind.trim()).not.toBe("");
    expect(interrogator.calls().map((call) => call.model)).toEqual(["claude-opus-5"]);

    const answers: GateAAnswers = {
      productPhotoAsset: "placeholder.png",
      productKind: brief.productKind,
      seconds: 12,
      mustNotAppear: [],
      cast: { kind: "new" },
    };
    const director = meter(transport, DIRECTOR_PROMPT_VERSION);
    const plan = await direct({ transport: director.transport }, { brief, answers });
    expect(plan.shots.length).toBeGreaterThan(0);
    expect(plan.assets.map((asset) => asset.kind).sort()).toEqual(["character", "location", "product"]);
    expect(director.calls().map((call) => call.model)).toEqual(["claude-opus-5"]);

    const cinematographer = meter(transport, CINEMATOGRAPHER_PROMPT_VERSION);
    const cameras = await shootAll({ transport: cinematographer.transport }, { plan, seconds: answers.seconds });
    expect(cameras.length).toBeGreaterThan(0);
    for (const camera of cameras) {
      expect(CAMERA_MOVES).toContain(camera.move);
      expect(camera.lensMm).toBeGreaterThan(0);
    }
    expect(cinematographer.calls().map((call) => call.model)).toEqual(["claude-opus-5"]);
  }, 300_000);
});
