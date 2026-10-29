import { createHash } from "node:crypto";
import {
  SEEDANCE_PROMPT_CHAR_CAP,
  plannedSeconds,
  type AssetKind,
  type Camera,
  type Plan,
  type PlanAsset,
} from "@ai-director/contract";
import { AssemblyInvariantError } from "../orchestrate/director/assemble.js";
import {
  CLOSING_LINE,
  LINE_SEPARATOR,
  PART_SEPARATOR,
  heroLine,
  locationLine,
  productLine,
  sceneLine,
  shotLine,
} from "../orchestrate/director/assemblePrompt/v2.js";
import type { LabBrief } from "./types.js";

/**
 * The lab's Assembler: code, not a model, glues the plan, the cameras and the character
 * into the final text prompt. The same invariants as the Director app's Assembler hold;
 * a broken one is a defect in code or inputs, so it throws instead of being routed.
 */
function fail(message: string): never {
  throw new AssemblyInvariantError(message);
}

function onlyAsset(plan: Plan, kind: AssetKind): PlanAsset {
  const found = plan.assets.filter((asset) => asset.kind === kind);
  const asset = found[0];
  if (found.length !== 1 || !asset) return fail(`the plan declares ${found.length} ${kind} assets, expected 1`);
  return asset;
}

const withoutFinalPeriod = (text: string): string => text.trimEnd().replace(/\.$/, "");

export function assembleTextPrompt(args: { plan: Plan; cameras: Camera[]; characterText: string }): {
  text: string;
  sha256: string;
} {
  const { plan, cameras, characterText } = args;
  const product = onlyAsset(plan, "product");
  const location = onlyAsset(plan, "location");
  const hero = onlyAsset(plan, "character");

  const shots = plan.shots.map((shot, i) => {
    const camera = cameras.find((c) => c.shot === i + 1);
    if (!camera) return fail(`shot ${i + 1} has no camera`);
    return shotLine(i + 1, camera, shot.action, shot.sound);
  });

  const text = [
    [productLine(product.handle, product.description), locationLine(location.handle, location.description)].join(
      LINE_SEPARATOR,
    ),
    plan.styleLine,
    heroLine(hero.handle, characterText),
    sceneLine(plan.scene),
    shots.join(LINE_SEPARATOR),
    CLOSING_LINE,
  ].join(PART_SEPARATOR);

  if (text.indexOf(plan.styleLine) === -1) fail("the style line is missing");
  if (text.indexOf(characterText) === -1) fail("the character description is missing");
  for (const asset of [product, location]) {
    if (text.indexOf(withoutFinalPeriod(asset.description)) === -1) fail(`the ${asset.kind} description is missing`);
  }
  for (let n = 1; n <= plan.shots.length; n++) {
    const marker = `Shot ${n}:`;
    const first = text.indexOf(marker);
    if (first === -1 || text.indexOf(marker, first + 1) !== -1) fail(`${marker} must appear exactly once`);
  }
  if (text.length > SEEDANCE_PROMPT_CHAR_CAP) fail(`prompt is ${text.length} characters, the cap is ${SEEDANCE_PROMPT_CHAR_CAP}`);

  return { text, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** The shot list for a person to read: what the run made, in one table. */
export function renderShotList(args: { plan: Plan; cameras: Camera[]; characterText: string; brief: LabBrief }): string {
  const { plan, cameras, brief } = args;
  const asset = (kind: AssetKind) => plan.assets.find((a) => a.kind === kind);
  const rows = plan.shots.map((shot, i) => {
    const camera = cameras.find((c) => c.shot === i + 1);
    const lens = camera ? `${camera.framing}, ${camera.lensMm}mm, ${camera.move}` : "(no camera)";
    return `| ${i + 1} | ${cell(shot.action)} | ${cell(lens)} | ${cell(camera?.light ?? "")} | ${cell(shot.sound)} |`;
  });
  return [
    "# Shot list",
    "",
    `**Brief:** ${brief.brief}`,
    "",
    `**Length:** ${plannedSeconds(plan)} s planned (${brief.seconds} s chosen)`,
    `**Look:** ${plan.styleLine}`,
    `**Product (${asset("product")?.handle ?? "?"}):** ${asset("product")?.description ?? ""}`,
    `**Location (${asset("location")?.handle ?? "?"}):** ${asset("location")?.description ?? ""}`,
    `**Character (${asset("character")?.handle ?? "?"}):** ${args.characterText}`,
    `**Scene:** ${plan.scene}`,
    "",
    "| # | What happens | Camera | Light | Sound |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
