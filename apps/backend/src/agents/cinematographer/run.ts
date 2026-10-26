import type { Camera, CheckOutcome, Plan } from "@ai-director/contract";
import type { ParseTransport } from "../../api/client.js";
import {
  buildCinematographerReshootSystemPrompt,
  buildCinematographerSystemPrompt,
  renderReshootRequest,
  renderShootRequest,
} from "./prompt-v1.js";
import { CinematographerOutputSchema } from "./schema.js";

async function askForCameras(transport: ParseTransport, system: string, user: string): Promise<Camera[]> {
  const { parsed_output } = await transport({ system, user, schema: CinematographerOutputSchema });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error("cinematographer parse failed");
  }
  const { cameras } = CinematographerOutputSchema.parse(parsed_output);
  for (const camera of cameras) {
    if (!Number.isFinite(camera.lensMm) || camera.lensMm <= 0) {
      throw new Error(`cinematographer gave shot ${camera.shot} a lens of ${camera.lensMm} mm`);
    }
  }
  return cameras;
}

/**
 * One call writes the camera for every shot, in order. Whether there is exactly one
 * camera per shot and whether each light names a direction are left to the prompt
 * checks, which route a failure back here as a `reshoot` of just those shots.
 */
export async function shootAll(
  deps: { transport: ParseTransport },
  args: { plan: Plan; seconds: number },
): Promise<Camera[]> {
  return askForCameras(deps.transport, buildCinematographerSystemPrompt(), renderShootRequest(args));
}

/**
 * Rewrites only the listed shots and splices them in. Every camera for a listed shot
 * is replaced (a shot with two cameras ends with one; a shot with none gains one); a
 * listed shot the plan does not have is dropped without asking the model. Cameras for
 * every other shot are returned as the same objects, untouched, in shot order.
 *
 * The model must answer with exactly one camera for each listed shot of the plan and
 * nothing else; anything else throws rather than being spliced half-right.
 */
export async function reshoot(
  deps: { transport: ParseTransport },
  args: { plan: Plan; cameras: Camera[]; shots: number[]; failures: CheckOutcome[] },
): Promise<Camera[]> {
  const listed = new Set(args.shots);
  const kept = args.cameras.filter((camera) => !listed.has(camera.shot));
  const targets = [...listed]
    .filter((shot) => Number.isInteger(shot) && shot >= 1 && shot <= args.plan.shots.length)
    .sort((a, b) => a - b);
  const fresh = targets.length === 0 ? [] : await askForReplacements(deps.transport, args, kept, targets);
  return [...kept, ...fresh].sort((a, b) => a.shot - b.shot);
}

async function askForReplacements(
  transport: ParseTransport,
  args: { plan: Plan; cameras: Camera[]; failures: CheckOutcome[] },
  kept: Camera[],
  targets: number[],
): Promise<Camera[]> {
  // The model sees the cameras that stay and the ones being replaced, never a camera
  // for a shot the plan does not have (that one is simply dropped).
  const shown = args.cameras.filter((camera) => kept.includes(camera) || targets.includes(camera.shot));
  const fresh = await askForCameras(
    transport,
    buildCinematographerReshootSystemPrompt(),
    renderReshootRequest({ plan: args.plan, cameras: shown, shots: targets, failures: args.failures }),
  );

  const problems: string[] = [];
  for (const camera of fresh) {
    if (!targets.includes(camera.shot)) problems.push(`wrote shot ${camera.shot}, which it was not asked for`);
  }
  for (const shot of targets) {
    const count = fresh.filter((camera) => camera.shot === shot).length;
    if (count === 0) problems.push(`left out shot ${shot}`);
    if (count > 1) problems.push(`wrote ${count} cameras for shot ${shot}`);
  }
  if (problems.length > 0) throw new Error(`cinematographer reshoot ${problems.join("; ")}`);
  return fresh;
}
