import type { CheckGroup } from "./checks.js";
import type { CheckResultView, ReplacementView, RunStatus, RunView, StepCost } from "./run.js";

export const EVENT_NAMES = [
  "run.started",
  "pass.started",
  "evaluator.group.started",
  "evaluator.group.completed",
  "repairer.started",
  "repairer.completed",
  "pass.completed",
  "run.completed",
  "run.failed",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** `<pass>-<step>`, per spec §6, so EventSource can resume with Last-Event-ID. */
export function eventId(pass: number, step: number): string {
  return `${pass}-${step}`;
}

export function parseEventId(id: string): { pass: number; step: number } {
  const [pass, step] = id.split("-");
  const parsed = { pass: Number(pass), step: Number(step) };
  if (!Number.isInteger(parsed.pass) || !Number.isInteger(parsed.step)) {
    throw new Error(`malformed event id: ${id}`);
  }
  return parsed;
}

type Base<N extends EventName, P> = { id: string; name: N; at: string } & P;

export type RunEvent =
  | Base<"run.started", { runId: string; rubricVersion: string; model: string; description: string }>
  | Base<"pass.started", { pass: number; description: string }>
  | Base<"evaluator.group.started", { pass: number; group: CheckGroup }>
  /**
   * A group's bands and reasons, as soon as that group's call settles.
   * Its results ALWAYS carry empty `spans` and `unverified`: span verification is pass-wide and
   * needs every group's quotes together, so nothing honest exists at group-settle time. Verified
   * spans arrive on `pass.completed`, which fires after verification has fully resolved.
   */
  | Base<"evaluator.group.completed", { pass: number; group: CheckGroup; results: CheckResultView[]; cost: StepCost }>
  | Base<"repairer.started", { pass: number; spanIds: string[] }>
  | Base<"repairer.completed", { pass: number; replacements: ReplacementView[]; cost: StepCost }>
  | Base<"pass.completed", { pass: number; repairedDescription?: string; failing: string[]; results: CheckResultView[] }>
  | Base<"run.completed", { status: RunStatus; run: RunView }>
  | Base<"run.failed", { error: string }>;

export type EventOf<N extends EventName> = Extract<RunEvent, { name: N }>;
