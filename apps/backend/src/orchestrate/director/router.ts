import {
  DIRECTOR_CHECK_IDS,
  MAX_RETRIES_PER_OWNER,
  type CheckOutcome,
  type CheckOwner,
  type DirectorCheckId,
} from "@ai-director/contract";

export type Route =
  | { kind: "pass" }
  | { kind: "redo"; owner: CheckOwner; checkIds: DirectorCheckId[]; shots: number[]; retry: number }
  | { kind: "stop"; reason: string };

const OWNER_ORDER: CheckOwner[] = ["director", "cinematographer"];

/** Send a failure back to the first owner that has one, or stop when that owner is out of retries. */
export function route(outcomes: CheckOutcome[], retries: Record<CheckOwner, number>): Route {
  const failing = outcomes.filter((outcome) => !outcome.passed);
  const owner = OWNER_ORDER.find((candidate) => failing.some((outcome) => outcome.owner === candidate));
  if (owner === undefined) return { kind: "pass" };

  const mine = failing.filter((outcome) => outcome.owner === owner);
  const checkIds = DIRECTOR_CHECK_IDS.filter((id) => mine.some((outcome) => outcome.id === id));

  if (retries[owner] >= MAX_RETRIES_PER_OWNER) {
    return {
      kind: "stop",
      reason: `${checkIds.join(", ")} still failing after ${MAX_RETRIES_PER_OWNER} retries (owner: ${owner})`,
    };
  }

  const shots = [...new Set(mine.flatMap((outcome) => outcome.shots))].sort((a, b) => a - b);
  return { kind: "redo", owner, checkIds, shots, retry: retries[owner] + 1 };
}
