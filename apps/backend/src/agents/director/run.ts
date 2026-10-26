import type { AssetKind, CheckOutcome, FilledBrief, GateAAnswers, Plan } from "@ai-director/contract";
import type { ParseTransport } from "../../api/client.js";
import {
  buildDirectorPatchSystemPrompt,
  buildDirectorSystemPrompt,
  renderDirectorPatchRequest,
  renderDirectorRequest,
} from "./prompt-v1.js";
import { DirectorPlanSchema } from "./schema.js";

/**
 * A patch changed the asset list. A patch fixes shots, never assets: the assets are
 * what the product and location pictures are made from, so what the owner approves
 * at Gate B must be the asset list those pictures come from. Thrown, so the runner
 * logs the patch as a failed attempt.
 */
export class PlanPatchError extends Error {
  constructor(readonly changes: string[]) {
    super(`a patch may not change the assets: ${changes.join("; ")}`);
    this.name = "PlanPatchError";
  }
}

const HANDLE = /^@[a-z0-9_]+$/;
const ASSET_KINDS: AssetKind[] = ["product", "location", "character"];

/**
 * The shape every later step depends on, checked before a plan leaves this agent:
 * exactly one asset of each kind (the product and location pictures take slots 1 and
 * 2, the character is one HERO line), lowercase handles declared once, at least one
 * shot, and no blank text where the final prompt pastes it.
 *
 * What a model can fail and fix by itself — the length, an undeclared or unused
 * handle, a timestamp, a ruled-out word — is NOT checked here. Those are the plan
 * checks (`orchestrate/director/checks.ts`), which send the plan back for a patch
 * instead of failing the run.
 */
function assertPlanShape(plan: Plan): void {
  const problems: string[] = [];
  if (plan.styleLine.trim() === "") problems.push("the style line is blank");
  if (plan.scene.trim() === "") problems.push("the scene is blank");

  for (const kind of ASSET_KINDS) {
    const count = plan.assets.filter((asset) => asset.kind === kind).length;
    if (count !== 1) problems.push(`${count} ${kind} assets, a plan has exactly one`);
  }
  // A blank product or location description is `references_within_cap`'s to report;
  // the character's is not covered by any check, and a new cast is drawn from it.
  for (const asset of plan.assets) {
    if (asset.kind === "character" && asset.description.trim() === "") {
      problems.push(`character ${asset.handle} has no description`);
    }
  }
  const seen = new Set<string>();
  for (const { handle } of plan.assets) {
    if (!HANDLE.test(handle)) problems.push(`handle ${handle} is not @ and lowercase letters, digits or _`);
    if (seen.has(handle)) problems.push(`handle ${handle} is declared twice`);
    seen.add(handle);
  }

  if (plan.shots.length === 0) problems.push("the plan has no shots");
  plan.shots.forEach((shot, index) => {
    if (shot.action.trim() === "") problems.push(`shot ${index + 1} has no action`);
  });

  if (problems.length > 0) throw new Error(`director plan is malformed: ${problems.join("; ")}`);
}

async function askForPlan(transport: ParseTransport, system: string, user: string): Promise<Plan> {
  const { parsed_output } = await transport({ system, user, schema: DirectorPlanSchema });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error("director parse failed");
  }
  return DirectorPlanSchema.parse(parsed_output);
}

/** One call: the filled brief and the Gate A answers in, the plan out. */
export async function direct(
  deps: { transport: ParseTransport },
  args: { brief: FilledBrief; answers: GateAAnswers },
): Promise<Plan> {
  const plan = await askForPlan(deps.transport, buildDirectorSystemPrompt(), renderDirectorRequest(args));
  assertPlanShape(plan);
  return plan;
}

function assetChanges(before: Plan, after: Plan): string[] {
  const changes: string[] = [];
  const count = Math.max(before.assets.length, after.assets.length);
  for (let index = 0; index < count; index += 1) {
    const was = before.assets[index];
    const now = after.assets[index];
    if (was === undefined) {
      changes.push(`asset ${index + 1} (${now!.handle}) was added`);
      continue;
    }
    if (now === undefined) {
      changes.push(`asset ${index + 1} (${was.handle}) was removed`);
      continue;
    }
    for (const field of ["handle", "kind", "description"] as const) {
      if (was[field] !== now[field]) changes.push(`asset ${index + 1} (${was.handle}) ${field} changed`);
    }
  }
  return changes;
}

/**
 * Fixes the failures the plan checks routed back to the Director. The model returns a
 * whole plan; code then compares its assets with the input's, in order, and throws
 * `PlanPatchError` if any asset's handle, kind or description differs, or one was
 * added or removed.
 */
export async function patchPlan(
  deps: { transport: ParseTransport },
  args: { plan: Plan; failures: CheckOutcome[]; brief: FilledBrief; answers: GateAAnswers },
): Promise<Plan> {
  const patched = await askForPlan(
    deps.transport,
    buildDirectorPatchSystemPrompt(),
    renderDirectorPatchRequest(args),
  );
  const changes = assetChanges(args.plan, patched);
  if (changes.length > 0) throw new PlanPatchError(changes);
  assertPlanShape(patched);
  return patched;
}
