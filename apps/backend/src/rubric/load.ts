import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckGroup, type Rubric, type RubricCheck, RubricSchema } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadRubric(version: string): Promise<Rubric> {
  const file = path.join(here, `${version}.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(`rubric ${version} not found at ${file}`);
  }
  return RubricSchema.parse(JSON.parse(raw));
}

export function checksForGroup(rubric: Rubric, group: CheckGroup): RubricCheck[] {
  return rubric.checks.filter((check) => check.group === group);
}

export type { CheckGroup, Rubric, RubricCheck };
