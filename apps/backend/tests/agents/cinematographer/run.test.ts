import { CAMERA_MOVES, type Camera, type CheckOutcome } from "@ai-director/contract";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import {
  buildCinematographerReshootSystemPrompt,
  buildCinematographerSystemPrompt,
  CINEMATOGRAPHER_EXAMPLE_CAMERAS,
  CINEMATOGRAPHER_PROMPT_VERSION,
} from "../../../src/agents/cinematographer/prompt-v1.js";
import { reshoot, shootAll } from "../../../src/agents/cinematographer/run.js";
import { CinematographerOutputSchema } from "../../../src/agents/cinematographer/schema.js";
import { DIRECTOR_EXAMPLE_PLAN } from "../../../src/agents/director/prompt-v1.js";
import { runPromptChecks } from "../../../src/orchestrate/director/checks.js";
import { boardCameras, boardPlan } from "../../orchestrate/director/planFixture.js";

function fakeReturning(cameras: unknown) {
  return vi.fn().mockResolvedValue({ parsed_output: { cameras } });
}

describe("shootAll", () => {
  it("writes every shot's camera in one call and returns them", async () => {
    const transport = fakeReturning(boardCameras());
    expect(await shootAll({ transport }, { plan: boardPlan(), seconds: 15 })).toEqual(boardCameras());
    expect(transport).toHaveBeenCalledTimes(1);
    const call = transport.mock.calls[0]![0] as { system: string; schema: unknown };
    expect(call.system).toBe(buildCinematographerSystemPrompt());
    expect(call.schema).toBe(CinematographerOutputSchema);
  });

  it("sees the style line, the scene, the location description and every shot in order", async () => {
    const plan = boardPlan();
    const transport = fakeReturning(boardCameras());
    await shootAll({ transport }, { plan, seconds: 15 });
    const { user } = transport.mock.calls[0]![0] as { user: string };
    expect(user).toContain(plan.styleLine);
    expect(user).toContain(plan.scene);
    expect(user).toContain(plan.assets.find((asset) => asset.kind === "location")!.description);
    const positions = plan.shots.map((shot) => user.indexOf(shot.action));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("throws when the parse comes back empty", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(shootAll({ transport }, { plan: boardPlan(), seconds: 15 })).rejects.toThrow(/cinematographer/i);
  });

  it("throws on a move that is not on the list", async () => {
    const cameras = boardCameras().map((camera) => ({ ...camera })) as Array<Record<string, unknown>>;
    cameras[1]!.move = "push-in while panning left";
    await expect(shootAll({ transport: fakeReturning(cameras) }, { plan: boardPlan(), seconds: 15 })).rejects.toThrow();
  });

  it("throws on a lens that is not a positive number of millimetres", async () => {
    const cameras = boardCameras();
    cameras[2]!.lensMm = 0;
    await expect(shootAll({ transport: fakeReturning(cameras) }, { plan: boardPlan(), seconds: 15 })).rejects.toThrow(
      /lens/,
    );
  });

  it("leaves a missing camera or a light with no direction to the checks", async () => {
    const cameras = boardCameras().slice(0, 3);
    cameras[0]!.light = "soft moody light";
    const transport = fakeReturning(cameras);
    await expect(shootAll({ transport }, { plan: boardPlan(), seconds: 15 })).resolves.toEqual(cameras);
  });
});

const lightFailure: CheckOutcome = {
  id: "light_has_direction",
  passed: false,
  owner: "cinematographer",
  detail: "light names no direction in shot 2",
  shots: [2],
};

describe("reshoot", () => {
  it("asks only for shot 2, splices it in and keeps shots 1, 3 and 4 by reference", async () => {
    const cameras = boardCameras();
    const fresh: Camera = {
      shot: 2,
      framing: "close-up",
      lensMm: 85,
      move: "slow push-in",
      light: "window light from the left",
    };
    const transport = fakeReturning([fresh]);
    const out = await reshoot(
      { transport },
      { plan: boardPlan(), cameras, shots: [2], failures: [lightFailure] },
    );

    expect(out).toHaveLength(4);
    expect(out[0]).toBe(cameras[0]);
    expect(out[1]).toEqual(fresh);
    expect(out[2]).toBe(cameras[2]);
    expect(out[3]).toBe(cameras[3]);
    expect(out).not.toBe(cameras);

    const call = transport.mock.calls[0]![0] as { system: string; user: string };
    expect(call.system).toBe(buildCinematographerReshootSystemPrompt());
    expect(call.user).toContain("light names no direction in shot 2");
    expect(call.user).toMatch(/shot 2 only/i);
  });

  it("shows the cameras it keeps, so the new shot continues from them", async () => {
    const cameras = boardCameras();
    cameras[0]!.framing = "wide establishing shot";
    const transport = fakeReturning([{ ...cameras[1]!, light: "window light from the left" }]);
    await reshoot({ transport }, { plan: boardPlan(), cameras, shots: [2], failures: [lightFailure] });
    const { user } = transport.mock.calls[0]![0] as { user: string };
    expect(user).toContain("wide establishing shot");
  });

  it("fills a shot that had no camera, in shot order", async () => {
    const cameras = boardCameras().filter((camera) => camera.shot !== 3);
    const fresh: Camera = { shot: 3, framing: "close-up", lensMm: 85, move: "static", light: "lamp from the right" };
    const out = await reshoot(
      { transport: fakeReturning([fresh]) },
      { plan: boardPlan(), cameras, shots: [3], failures: [] },
    );
    expect(out.map((camera) => camera.shot)).toEqual([1, 2, 3, 4]);
    expect(out[0]).toBe(cameras[0]);
    expect(out[3]).toBe(cameras[2]);
  });

  it("replaces every camera a shot had when it had two", async () => {
    const cameras = [...boardCameras(), { ...boardCameras()[1]!, framing: "a second camera" }];
    const fresh: Camera = { shot: 2, framing: "close-up", lensMm: 85, move: "static", light: "lamp from the right" };
    const out = await reshoot(
      { transport: fakeReturning([fresh]) },
      { plan: boardPlan(), cameras, shots: [2], failures: [] },
    );
    expect(out.filter((camera) => camera.shot === 2)).toEqual([fresh]);
  });

  it("drops a camera for a shot the plan does not have without calling the model", async () => {
    const cameras = [...boardCameras(), { ...boardCameras()[0]!, shot: 5 }];
    const transport = vi.fn();
    const out = await reshoot({ transport }, { plan: boardPlan(), cameras, shots: [5], failures: [] });
    expect(transport).not.toHaveBeenCalled();
    expect(out.map((camera) => camera.shot)).toEqual([1, 2, 3, 4]);
    out.forEach((camera, index) => expect(camera).toBe(cameras[index]));
  });

  it("discards a camera for a shot it was not asked for, and never splices it", async () => {
    const cameras = boardCameras();
    const fresh: Camera = { ...cameras[1]!, light: "window light from the left" };
    const unasked: Camera = { ...cameras[2]!, framing: "an unasked close-up", lensMm: 0 };
    const out = await reshoot(
      { transport: fakeReturning([fresh, unasked]) },
      { plan: boardPlan(), cameras, shots: [2], failures: [lightFailure] },
    );
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual(fresh);
    expect(out[2]).toBe(cameras[2]);
    expect(out).not.toContainEqual(unasked);
  });

  it("throws when the model writes two cameras for a shot it was asked for", async () => {
    const twice = { ...boardCameras()[1]!, light: "window light from the left" };
    await expect(
      reshoot(
        { transport: fakeReturning([twice, twice]) },
        { plan: boardPlan(), cameras: boardCameras(), shots: [2], failures: [lightFailure] },
      ),
    ).rejects.toThrow(/2 cameras for shot 2/);
  });

  it("throws when the model leaves out a shot it was asked for", async () => {
    const transport = fakeReturning([]);
    await expect(
      reshoot({ transport }, { plan: boardPlan(), cameras: boardCameras(), shots: [2], failures: [lightFailure] }),
    ).rejects.toThrow(/shot 2/);
  });
});

describe("cinematographer prompt v1", () => {
  it("is version v1", () => {
    expect(CINEMATOGRAPHER_PROMPT_VERSION).toBe("v1");
  });

  it("offers exactly the closed list of moves, one per shot", () => {
    const prompt = buildCinematographerSystemPrompt();
    expect(prompt).toMatch(/exactly one camera move/i);
  });

  // v1's move list is literal text. If CAMERA_MOVES changes, this fails: ship prompt-v2.
  it("writes the move list as literal text that still matches CAMERA_MOVES", () => {
    expect(buildCinematographerSystemPrompt()).toContain(
      "written exactly as listed: static, slow push-in, pull-out, tracking, orbit, crane up, handheld.",
    );
    expect(CAMERA_MOVES.join(", ")).toBe("static, slow push-in, pull-out, tracking, orbit, crane up, handheld");
  });

  it("freezes the example cameras, so nothing can change what v1 says", () => {
    expect(Object.isFrozen(CINEMATOGRAPHER_EXAMPLE_CAMERAS)).toBe(true);
    expect(Object.isFrozen(CINEMATOGRAPHER_EXAMPLE_CAMERAS[0])).toBe(true);
    expect(() => {
      (CINEMATOGRAPHER_EXAMPLE_CAMERAS[0] as { lensMm: number }).lensMm = 12;
    }).toThrow(TypeError);
  });

  it("writes every shot in one pass, in order, each continuing the last", () => {
    expect(buildCinematographerSystemPrompt()).toMatch(/in order, so each shot continues from the last/i);
  });

  it("asks for the lens in millimetres and light with a source and a direction", () => {
    const prompt = buildCinematographerSystemPrompt();
    expect(prompt).toMatch(/millimetres/i);
    expect(prompt).toMatch(/source and the direction/i);
  });

  it("knows it has not seen the location picture", () => {
    expect(buildCinematographerSystemPrompt()).toMatch(/not seen the location picture/i);
  });

  it("shows example cameras that pass every prompt check in code", () => {
    const prompt = buildCinematographerSystemPrompt();
    for (const camera of CINEMATOGRAPHER_EXAMPLE_CAMERAS) expect(prompt).toContain(camera.light);
    const outcomes = runPromptChecks(DIRECTOR_EXAMPLE_PLAN, CINEMATOGRAPHER_EXAMPLE_CAMERAS);
    expect(outcomes.filter((outcome) => !outcome.passed)).toEqual([]);
  });

  it("tells a reshoot to write only the shots it is given", () => {
    const prompt = buildCinematographerReshootSystemPrompt();
    expect(prompt.startsWith(buildCinematographerSystemPrompt())).toBe(true);
    expect(prompt).toMatch(/only the shots/i);
  });
});

describe("cinematographer schema", () => {
  it("parses to the contract's Camera", () => {
    expectTypeOf<z.infer<typeof CinematographerOutputSchema>>().toEqualTypeOf<{ cameras: Camera[] }>();
  });
});
