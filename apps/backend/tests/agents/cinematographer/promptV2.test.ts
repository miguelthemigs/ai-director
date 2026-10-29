import { describe, expect, it, vi } from "vitest";
import { buildCinematographerSystemPrompt } from "../../../src/agents/cinematographer/prompt-v1.js";
import { CINEMATOGRAPHER_PROMPTS_V2 } from "../../../src/agents/cinematographer/prompt-v2.js";
import { reshoot, shootAll } from "../../../src/agents/cinematographer/run.js";
import { boardCameras, boardPlan } from "../../orchestrate/director/planFixture.js";

describe("Cinematographer v2", () => {
  it("never mentions a picture", () => {
    const shoot = CINEMATOGRAPHER_PROMPTS_V2.renderShoot({ plan: boardPlan(), seconds: 15 });
    const again = CINEMATOGRAPHER_PROMPTS_V2.renderReshoot({ plan: boardPlan(), cameras: boardCameras(), shots: [2], failures: [] });
    for (const text of [CINEMATOGRAPHER_PROMPTS_V2.system, CINEMATOGRAPHER_PROMPTS_V2.reshootSystem, shoot, again]) {
      expect(text).not.toContain("picture");
    }
    expect(shoot).toContain("- Location (@kitchen): a bright home kitchen");
  });

  it("is sent when shootAll is given the v2 prompts, and v1 stays the default", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: { cameras: boardCameras() } });
    await shootAll({ transport }, { plan: boardPlan(), seconds: 15 }, CINEMATOGRAPHER_PROMPTS_V2);
    await shootAll({ transport }, { plan: boardPlan(), seconds: 15 });
    expect(transport.mock.calls[0]![0].system).toBe(CINEMATOGRAPHER_PROMPTS_V2.system);
    expect(transport.mock.calls[1]![0].system).toBe(buildCinematographerSystemPrompt());
  });

  it("reshoots with the v2 reshoot prompt", async () => {
    const fresh = { ...boardCameras()[1]!, light: "low sun from the left" };
    const transport = vi.fn().mockResolvedValue({ parsed_output: { cameras: [fresh] } });
    const cameras = await reshoot(
      { transport },
      { plan: boardPlan(), cameras: boardCameras(), shots: [2], failures: [] },
      CINEMATOGRAPHER_PROMPTS_V2,
    );
    expect(transport.mock.calls[0]![0].system).toBe(CINEMATOGRAPHER_PROMPTS_V2.reshootSystem);
    expect(cameras[1]).toEqual(fresh);
  });
});
