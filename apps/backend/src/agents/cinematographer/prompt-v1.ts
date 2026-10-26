import type { Camera, CheckOutcome, Plan } from "@ai-director/contract";
import { deepFreeze } from "../deepFreeze.js";
import { DIRECTOR_EXAMPLE_PLAN, DIRECTOR_V1_CHECK_LABELS } from "../director/prompt-v1.js";

/**
 * CINEMATOGRAPHER PROMPT v1 — framing, lens, one move and light for every shot of the
 * approved plan.
 *
 * Append-only (CLAUDE.md): a change ships as `prompt-v2.ts`.
 *
 * ── One call, every shot, in order ──────────────────────────────────────────────
 * Decision 2 of the plan (Part 5 §6, Part 7): the shots of one take are not
 * independent. Written in one pass, shot 3's camera can pick up where shot 2's left
 * off, and the light can come from the same side throughout. A reshoot shows the
 * cameras it keeps for the same reason.
 *
 * ── What it sees ────────────────────────────────────────────────────────────────
 * The plan's style line, scene, asset descriptions and shots, never the generated
 * location picture: it runs in parallel with the pictures, after Gate B. So it can
 * light from a window the picture moved. That gap is accepted (Part 5), and the
 * prompt narrows it by letting light come only from sources the plan names.
 *
 * ── Its rules are the checks' rules ─────────────────────────────────────────────
 * The move list is `CAMERA_MOVES`, written out as literal text so a change to the
 * contract cannot silently rewrite v1 (a test compares the two; a change ships as
 * `prompt-v2.ts`). The example cameras are deeply frozen. The direction words are the ones
 * `light_has_direction` accepts (`orchestrate/director/checks.ts`), and the example
 * cameras are pinned by a test to pass every prompt check.
 *
 * "Motivate every camera move" and the lens/height/motivation guidance are adapted
 * from the camera-language and lighting sections of Higgsfield's
 * `seedance-shotlist-director` skill, the same source the Director's prompt credits.
 */
export const CINEMATOGRAPHER_PROMPT_VERSION = "v1";

/** Cameras for the four shots of `DIRECTOR_EXAMPLE_PLAN`, shown to the model. */
export const CINEMATOGRAPHER_EXAMPLE_CAMERAS: Camera[] = deepFreeze([
  {
    shot: 1,
    framing: "wide shot from the foot of the bed, eye level",
    lensMm: 24,
    move: "static",
    light: "cold grey dawn through the open window from the left, the room still dark",
  },
  {
    shot: 2,
    framing: "medium close-up on the bedside table and his reaching hand",
    lensMm: 50,
    move: "slow push-in",
    light: "the same grey window light from the left, catching the edge of the cups",
  },
  {
    shot: 3,
    framing: "close-up on his face on the pillow",
    lensMm: 85,
    move: "static",
    light: "warmer sun now through the window from the left, a soft glow on his cheek",
  },
  {
    shot: 4,
    framing: "medium shot following him from behind",
    lensMm: 35,
    move: "tracking",
    light: "bright morning sun through the open front door ahead, backlit, rim on his shoulders",
  },
]);

function renderExample(): string {
  return DIRECTOR_EXAMPLE_PLAN.shots
    .map((shot, index) => {
      const camera = CINEMATOGRAPHER_EXAMPLE_CAMERAS[index]!;
      return `Shot ${index + 1} (${shot.weight}): ${shot.action}\n${JSON.stringify(camera)}`;
    })
    .join("\n\n");
}

export function buildCinematographerSystemPrompt(): string {
  return [
    "You are the cinematographer of one cinematic video ad that Seedance 2.5 generates as one take: several labelled shots inside a single generation. The director has written the plan — the look, the scene, the assets, and every shot's action and sound. You write the camera for every shot, in one pass, in order, so each shot continues from the last.",
    "",
    "## For each shot, exactly one camera",
    "",
    "- shot: the shot's number in the plan, starting at 1. One camera per shot, no more, no fewer.",
    "- framing: the shot size and angle, in a few words: \"wide shot, eye level\", \"medium close-up\", \"close-up from a low angle\", \"over-the-shoulder medium shot\". Lens, move and light have their own fields; never repeat them here.",
    "- lensMm: the focal length in millimetres, as a number. 24 opens up a room, 35 keeps a person in their space, 50 is a natural medium, 85 is for a face or hands up close.",
    `- move: exactly one camera move per shot, from this closed list, written exactly as listed: static, slow push-in, pull-out, tracking, orbit, crane up, handheld. Never two: \"push-in while panning left\" is two moves and is refused. A shot that needs no move is \"static\".`,
    "- light: the light on this shot, naming its source and the direction it comes from, in plain words: \"low dawn sun through the window from the left\", \"warm bedside lamp from the right\", \"overcast sky from behind, rim on her shoulders\". Say the direction with one of: from the left, from the right, from behind, from above, overhead, from below, from the front, from the side, backlit. A light with no direction (\"soft light\", \"moody light\", \"sidelight\") is refused.",
    "",
    "Code writes each camera into the final prompt as \"Shot 2: <framing>, <lensMm>mm, <move>, <light>.\" followed by the director's action, so write framing and light as short phrases, without a full stop.",
    "",
    "## How to shoot it",
    "",
    "- Be specific: lens, height, movement, motivation. Motivate every camera move. The camera is a character; it has a reason to be where it is. A slow push-in lands a realisation, tracking follows someone walking, static lets a silence sit.",
    "- Read the weight. A short shot has room for a static frame or a small move; a long shot can carry a move from start to end.",
    "- One take, one place, one time of day: the light comes from the same sources in every shot, and moves only as the plan's time of day moves. Framing builds through the take — establish, come closer as the moment lands, open out to release.",
    "- Light only from sources the scene or the location's description names: a window, a lamp, the sky through a door. You have not seen the location picture; it is painted from that description. Never invent a window or a lamp it does not mention.",
    "- Never write seconds, timestamps or timing. Never restate the action or the sound. No brand names.",
    "",
    "## A worked example (the four shots of a headphones ad)",
    "",
    renderExample(),
  ].join("\n");
}

/**
 * The same prompt, plus the rule a reshoot lives by: write only the shots asked for.
 * `reshoot` splices the answer into the cameras it keeps and refuses any other shot.
 */
export function buildCinematographerReshootSystemPrompt(): string {
  return [
    buildCinematographerSystemPrompt(),
    "",
    "## Reshooting",
    "",
    "Checks in code failed on some of your cameras. Write only the shots you are asked for, one camera each, with the failures fixed. The cameras for the other shots stay exactly as they are: make the new ones continue from the shot before and lead into the shot after.",
  ].join("\n");
}

function renderPlan(plan: Plan): string {
  const assets = plan.assets.map((asset) => {
    const role =
      asset.kind === "location"
        ? "Location, the picture is painted from this"
        : asset.kind === "product"
          ? "Product"
          : "Character";
    return `- ${role} (${asset.handle}): ${asset.description}`;
  });
  const shots = plan.shots.map(
    (shot, index) => `Shot ${index + 1} (${shot.weight}): ${shot.action}\n  Sound: ${shot.sound}`,
  );
  return [
    `Style line: ${plan.styleLine}`,
    `Scene: ${plan.scene}`,
    "Assets:",
    ...assets,
    "",
    "The shots, in order:",
    ...shots,
  ].join("\n");
}

export function renderShootRequest(args: { plan: Plan; seconds: number }): string {
  return [
    renderPlan(args.plan),
    "",
    `The whole take runs ${args.seconds} seconds.`,
    `Write one camera for each of the ${args.plan.shots.length} shots, in order.`,
  ].join("\n");
}

function renderCamera(camera: Camera): string {
  return `Shot ${camera.shot}: ${camera.framing}, ${camera.lensMm}mm, ${camera.move}, ${camera.light}`;
}

function renderFailure(failure: CheckOutcome): string {
  const shots = failure.shots.length > 0 ? ` Shots: ${failure.shots.join(", ")}.` : "";
  return `- ${DIRECTOR_V1_CHECK_LABELS[failure.id]} — failed: ${failure.detail ?? "no detail"}.${shots}`;
}

export function renderReshootRequest(args: {
  plan: Plan;
  cameras: Camera[];
  shots: number[];
  failures: CheckOutcome[];
}): string {
  const asked = new Set(args.shots);
  const kept = args.cameras.filter((camera) => !asked.has(camera.shot));
  const replaced = args.cameras.filter((camera) => asked.has(camera.shot));
  const which =
    args.shots.length === 1 ? `shot ${args.shots[0]} only` : `shots ${args.shots.join(", ")} only`;
  return [
    renderPlan(args.plan),
    "",
    "The cameras that stay as they are:",
    ...(kept.length > 0 ? kept.map(renderCamera) : ["(none)"]),
    "",
    "The cameras being replaced:",
    ...(replaced.length > 0 ? replaced.map(renderCamera) : ["(none: these shots have no camera yet)"]),
    "",
    "Checks in code failed:",
    ...(args.failures.length > 0 ? args.failures.map(renderFailure) : ["- (no detail given)"]),
    "",
    `Write the camera for ${which}.`,
  ].join("\n");
}
