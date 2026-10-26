import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reduceDirectorEvents,
  type AssembledPrompt,
  type Camera,
  type CharacterOutcome,
  type CheckOutcome,
  type GateAAnswers,
  type Plan,
  type ReferenceImage,
} from "@ai-director/contract";
import type { ParseTransport } from "../../../src/api/client.js";
import { CinematographerOutputSchema } from "../../../src/agents/cinematographer/schema.js";
import { buildDirectorPatchSystemPrompt } from "../../../src/agents/director/prompt-v1.js";
import { DirectorPlanSchema } from "../../../src/agents/director/schema.js";
import { EvaluatorGroupOutputSchema } from "../../../src/agents/evaluator/schema.js";
import { InterrogatorOutputSchema } from "../../../src/agents/interrogator/schema.js";
import type { ImageTransport } from "../../../src/avatar/generateSheet.js";
import type { ReferenceHost } from "../../../src/images/referenceHost.js";
import { buildDirectorAgents } from "../../../src/orchestrate/director/agents.js";
import { buildRecipe, type NodeContext } from "../../../src/orchestrate/director/recipe.js";
import {
  driveDirectorRun,
  resolveGate,
  startDirectorRun,
  type RunnerDeps,
} from "../../../src/orchestrate/director/runner.js";
import { loadRubric } from "../../../src/rubric/load.js";
import { FileAvatarStore } from "../../../src/store/AvatarStore.js";
import { FileDirectorRunStore } from "../../../src/store/FileDirectorRunStore.js";
import { FileRunStore } from "../../../src/store/FileRunStore.js";
import { boardCameras, boardPlan } from "./planFixture.js";

const roots: string[] = [];
async function newRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "director-agents-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const PIXEL = Buffer.from("png-bytes").toString("base64");
const INTERROGATED = {
  productKind: "a glass bottle of sparkling water",
  audience: "people who work from home",
  tone: "warm",
  setting: "a kitchen",
  character: "a woman in her thirties",
  suggestedSeconds: 15,
};

type Overrides = {
  /** Answers a patch request; defaults to the board plan. */
  patch?: () => unknown;
  plan?: () => unknown;
};

/**
 * One fake for every structured call the recipe makes, picked by the schema it asks for,
 * logging a model and usage the way the real transport does.
 */
function fakeTransport(rubricIds: string[], overrides: Overrides = {}) {
  const seen: string[] = [];
  const transport: ParseTransport = async ({ system, schema }) => {
    const answer = (parsed_output: unknown) => ({
      parsed_output,
      model: "claude-opus-5",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    if (schema === InterrogatorOutputSchema) {
      seen.push("interrogate");
      return answer(INTERROGATED);
    }
    if (schema === DirectorPlanSchema) {
      if (system === buildDirectorPatchSystemPrompt()) {
        seen.push("patch");
        return answer(overrides.patch ? overrides.patch() : boardPlan());
      }
      seen.push("direct");
      return answer(overrides.plan ? overrides.plan() : boardPlan());
    }
    if (schema === CinematographerOutputSchema) {
      seen.push("shoot");
      return answer({ cameras: boardCameras() });
    }
    if (schema === EvaluatorGroupOutputSchema) {
      seen.push("evaluate");
      return answer({
        results: rubricIds
          .filter((id) => system.includes(`Check ${id} `))
          .map((checkId) => ({ checkId, band: 5, reason: "fake", quotes: [] })),
      });
    }
    throw new Error("unexpected call");
  };
  return { transport, seen };
}

async function setup(overrides: Overrides = {}) {
  const root = await newRoot();
  const rubric = await loadRubric("v1");
  const { transport, seen } = fakeTransport(
    rubric.checks.map((c) => c.id),
    overrides,
  );
  const store = new FileDirectorRunStore(path.join(root, "director"));
  const avatars = new FileAvatarStore(path.join(root, "avatars"));
  const runs = new FileRunStore(path.join(root, "runs"));
  const images = vi.fn<ImageTransport>(async () => ({ imageBase64: PIXEL, mediaType: "image/png" }));
  const host: ReferenceHost = { publish: vi.fn(async (_b, name) => ({ url: `https://app.ufs.sh/f/${name}` })) };
  const text = vi.fn(async () => ({ text: "A woman in her thirties, dark bob." }));
  const vision = vi.fn(async () => ({ text: "A woman, dark bob, linen shirt." }));
  const agents = buildDirectorAgents({
    transport,
    images,
    host,
    store,
    coach: { transport, avatars, runs, rubric },
    character: { text, images, vision, avatars },
  });
  const deps: RunnerDeps = { store, recipe: buildRecipe(agents) };
  return { deps, store, avatars, agents, images, host, text, vision, seen };
}

async function describedAvatar(avatars: FileAvatarStore): Promise<string> {
  const record = await avatars.save({ imageBase64: PIXEL, mediaType: "image/png", source: "uploaded" });
  await avatars.attachDescription(record.id, { description: "A tall woman with short black hair." });
  return record.id;
}

async function toGateA(deps: RunnerDeps, answers: (runId: string) => Promise<GateAAnswers>) {
  const runId = await startDirectorRun(deps, "cool ad for my sparkling water");
  await driveDirectorRun(deps, runId);
  await resolveGate(deps, runId, "A", { decision: "approve", answers: await answers(runId) });
  return runId;
}

describe("buildDirectorAgents through the runner", () => {
  it("runs the real recipe to gate C: pictures, coached character, cameras, assembled prompt", async () => {
    const { deps, store, avatars, images, seen } = await setup();
    const avatarId = await describedAvatar(avatars);
    const runId = await toGateA(deps, async (id) => ({
      productPhotoAsset: await store.saveAsset(id, "photo.jpg", Buffer.from("photo")),
      productKind: "a glass bottle",
      seconds: 15,
      mustNotAppear: [],
      cast: { kind: "avatar", avatarId },
    }));

    let view = reduceDirectorEvents(await store.events(runId));
    expect(view.waitingAt).toBe("B");
    expect(view.checks.plan.every((c) => c.passed)).toBe(true);
    await resolveGate(deps, runId, "B", { decision: "approve" });

    view = reduceDirectorEvents(await store.events(runId));
    expect(view.waitingAt).toBe("C");
    expect(view.checks.prompt.every((c) => c.passed)).toBe(true);

    // The product photo travels as the reference, with the media type its name says.
    const productCall = images.mock.calls.find((call) => call[0].aspectRatio === "1:1")!;
    expect(productCall[0].referenceImages).toEqual([
      { imageBase64: Buffer.from("photo").toString("base64"), mediaType: "image/jpeg" },
    ]);

    const character = await store.readOutput<CharacterOutcome>(runId, view.nodes.character.outputRef!);
    expect(character).toMatchObject({ avatarId, status: "passed", passed: true });

    const prompt = await store.readOutput<AssembledPrompt>(runId, view.nodes.assembler.outputRef!);
    expect(prompt.references.map((r) => [r.slot, r.handle, r.kind])).toEqual([
      [1, "@product", "product"],
      [2, "@kitchen", "location"],
    ]);
    expect(prompt.text).toContain("A tall woman with short black hair.");
    expect(prompt.text).toContain("The first reference image is the product (@product).");

    // Every model call is metered on the node that made it.
    const completed = (await store.events(runId)).filter((e) => e.type === "node.completed");
    const callsOf = (node: string) => completed.find((e) => e.type === "node.completed" && e.node === node)!;
    expect(callsOf("interrogator").type === "node.completed" && callsOf("interrogator").calls).toEqual([
      expect.objectContaining({ model: "claude-opus-5", promptVersion: "v1", inputTokens: 100, outputTokens: 50 }),
    ]);
    const characterCalls = callsOf("character").type === "node.completed" ? callsOf("character").calls : [];
    expect(characterCalls.length).toBeGreaterThan(0);
    expect(view.textMicroUsd).toBeGreaterThan(0);
    expect(seen.filter((s) => s === "shoot")).toHaveLength(1);
  });

  it("a cast of `new` makes the character from the plan's description, then coaches it", async () => {
    const { deps, store, avatars, text } = await setup();
    const runId = await toGateA(deps, async (id) => ({
      productPhotoAsset: await store.saveAsset(id, "photo.png", Buffer.from("photo")),
      productKind: "a glass bottle",
      seconds: 15,
      mustNotAppear: [],
      cast: { kind: "new" },
    }));
    await resolveGate(deps, runId, "B", { decision: "approve" });

    const view = reduceDirectorEvents(await store.events(runId));
    expect(view.waitingAt).toBe("C");
    const character = await store.readOutput<CharacterOutcome>(runId, view.nodes.character.outputRef!);
    const made = (await avatars.list())[0]!;
    expect(made.seedDescription).toBe("a woman in her thirties in a linen shirt");
    expect(text).toHaveBeenCalledTimes(1);
    expect(character).toMatchObject({ avatarId: made.id, passed: true, description: "A woman, dark bob, linen shirt." });
  });

  it("a patch that changes the assets keeps the previous plan, so the run ends stopped, not failed", async () => {
    const short = (): Plan => ({ ...boardPlan(), shots: boardPlan().shots.slice(0, 1) });
    const { deps, store, seen } = await setup({
      plan: short,
      patch: () => ({ ...short(), assets: boardPlan().assets.slice(0, 2).concat([{ handle: "@zoe", kind: "character", description: "x" }]) }),
    });
    const runId = await toGateA(deps, async () => ({
      productPhotoAsset: "assets/photo.png",
      productKind: "a glass bottle",
      seconds: 15,
      mustNotAppear: [],
      cast: { kind: "new" },
    }));

    const events = await store.events(runId);
    const view = reduceDirectorEvents(events);
    expect(view.status).toBe("stopped");
    expect(view.retries.director).toBe(2);
    expect(seen.filter((s) => s === "patch")).toHaveLength(2);

    const directed = events.filter((e) => e.type === "node.completed" && e.node === "director");
    expect(directed).toHaveLength(3);
    for (const event of directed.slice(1)) {
      if (event.type !== "node.completed") throw new Error("unreachable");
      expect(event.summary).toMatch(/patch refused/);
      expect(await store.readOutput<Plan>(runId, event.outputRef)).toEqual(short());
      // The refused call still spent tokens, and is logged.
      expect(event.calls).toHaveLength(1);
    }
    expect(events.some((e) => e.type === "run.finished" && e.status === "failed")).toBe(false);
  });
});

describe("buildDirectorAgents node bodies", () => {
  function ctx(outputs: Record<string, unknown>, extra: Partial<NodeContext> = {}): NodeContext {
    return {
      runId: "run-1",
      attempt: 1,
      patch: null,
      view: reduceDirectorEvents([]),
      read: async <T,>(node: string) => outputs[node] as T,
      answers: async () => ({
        productPhotoAsset: "assets/photo.png",
        productKind: "a bottle",
        seconds: 15,
        mustNotAppear: [],
        cast: { kind: "new" },
      }),
      ...extra,
    };
  }

  it("product is null, and says so, when the plan has no product asset", async () => {
    const { agents, images } = await setup();
    const plan = { ...boardPlan(), assets: boardPlan().assets.filter((a) => a.kind !== "product") };
    const result = await agents.product(ctx({ director: plan }));
    expect(result).toEqual({ output: null, summary: "no product in the plan", calls: [] });
    expect(images).not.toHaveBeenCalled();
  });

  it("the assembler references only the pictures that exist", async () => {
    const { agents } = await setup();
    const location: ReferenceImage = {
      slot: 2,
      handle: "@kitchen",
      kind: "location",
      url: "https://app.ufs.sh/f/k.png",
      asset: "assets/location-kitchen.png",
    };
    const character: CharacterOutcome = {
      avatarId: "a",
      coachRunId: "c",
      status: "passed",
      description: "A tall woman.",
      passed: true,
    };
    const result = await agents.assembler(
      ctx({ director: boardPlan(), cinematographer: boardCameras(), character, product: null, location }),
    );
    expect((result.output as AssembledPrompt).references).toEqual([location]);
  });

  it("the cinematographer reshoots only the routed shots when patched", async () => {
    const { agents } = await setup();
    const failures: CheckOutcome[] = [
      { id: "light_has_direction", owner: "cinematographer", passed: false, detail: "x", shots: [2] },
    ];
    const cameras: Camera[] = boardCameras().map((c) => (c.shot === 2 ? { ...c, light: "soft light" } : c));
    const result = await agents.cinematographer(
      ctx({ director: boardPlan(), cinematographer: cameras }, { patch: { checkIds: ["light_has_direction"], shots: [2], failures } }),
    );
    expect(result.output).toEqual(boardCameras());
    expect(result.summary).toMatch(/shot 2/);
  });
});
