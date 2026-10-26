import { createHash } from "node:crypto";
import {
  MAX_REFERENCE_IMAGES,
  SEEDANCE_PROMPT_CHAR_CAP,
  type AssembledPrompt,
  type Camera,
  type CharacterOutcome,
  type Plan,
  type ReferenceImage,
} from "@ai-director/contract";
import {
  CLOSING_LINE,
  LINE_SEPARATOR,
  ORDINALS,
  PART_SEPARATOR,
  heroLine,
  locationSentence,
  productSentence,
  sceneLine,
  shotLine,
} from "./assemblePrompt/v1.js";

/** A broken invariant is a bug in the inputs or the code, never routed back to an agent. */
export class AssemblyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyInvariantError";
  }
}

function fail(message: string): never {
  throw new AssemblyInvariantError(message);
}

function referenceSentence(ref: ReferenceImage, plan: Plan): string {
  const ordinal = ORDINALS[ref.slot - 1];
  if (ordinal === undefined) return fail(`reference slot ${ref.slot} has no ordinal`);
  if (ref.kind !== "product" && ref.kind !== "location") {
    return fail(`reference ${ref.handle} has kind ${String(ref.kind)}`);
  }
  const asset = plan.assets.find((a) => a.handle === ref.handle);
  if (!asset) return fail(`reference ${ref.handle} is not a plan asset`);
  if (asset.kind !== ref.kind) return fail(`reference ${ref.handle} is a ${asset.kind} asset, not a ${ref.kind}`);
  if (ref.kind === "product") return productSentence(ordinal, ref.handle);
  return locationSentence(ordinal, asset.description, ref.handle);
}

export function assembleSeedancePrompt(args: {
  plan: Plan;
  cameras: Camera[];
  character: CharacterOutcome;
  references: ReferenceImage[];
}): AssembledPrompt {
  const { plan, cameras, character } = args;
  if (args.references.length > MAX_REFERENCE_IMAGES) {
    fail(`${args.references.length} references exceed the cap of ${MAX_REFERENCE_IMAGES}`);
  }
  const characters = plan.assets.filter((a) => a.kind === "character");
  const hero = characters[0];
  if (characters.length !== 1 || !hero) fail(`the plan declares ${characters.length} character assets, expected 1`);

  const references = [...args.references].sort((a, b) => a.slot - b.slot);
  const sentences = references.map((ref) => referenceSentence(ref, plan));
  const shots = plan.shots.map((shot, i) => {
    const camera = cameras.find((c) => c.shot === i + 1);
    if (!camera) return fail(`shot ${i + 1} has no camera`);
    return shotLine(i + 1, camera, shot.action, shot.sound);
  });

  const parts = [
    sentences.join(LINE_SEPARATOR),
    plan.styleLine,
    heroLine(hero.handle, character.description),
    sceneLine(plan.scene),
    shots.join(LINE_SEPARATOR),
    CLOSING_LINE,
  ].filter((part) => part !== "");
  const text = parts.join(PART_SEPARATOR);

  if (text.indexOf(plan.styleLine) === -1) fail("the style line is missing");
  if (text.indexOf(character.description) === -1) fail("the character description is missing");
  for (const sentence of sentences) if (text.indexOf(sentence) === -1) fail(`missing: ${sentence}`);
  for (let n = 1; n <= plan.shots.length; n++) {
    const marker = `Shot ${n}:`;
    const first = text.indexOf(marker);
    if (first === -1 || text.indexOf(marker, first + 1) !== -1) {
      fail(`${marker} must appear exactly once`);
    }
  }
  if (text.length > SEEDANCE_PROMPT_CHAR_CAP) {
    fail(`prompt is ${text.length} characters, the cap is ${SEEDANCE_PROMPT_CHAR_CAP}`);
  }

  return { text, sha256: createHash("sha256").update(text, "utf8").digest("hex"), references };
}
