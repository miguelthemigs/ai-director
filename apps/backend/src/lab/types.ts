import type { Camera, CheckOutcome, FilledBrief } from "@ai-director/contract";

/**
 * The architecture lab's own types. None of them crosses the network (the lab has no
 * route and no screen), so they live here and not in the contract; the types they build
 * on (`FilledBrief`, `Plan`, `Camera`, `CheckOutcome`) come from the contract and are never
 * redefined. See docs/superpowers/specs/2026-10-28-agent-architectures-lab-design.md.
 */

export const LAB_ARCHS = ["sequential", "coordinator", "swarm"] as const;
export type LabArch = (typeof LAB_ARCHS)[number];

/** `abandoned` is never stored: `lab report` shows a still-running run that way. */
export type LabStatus = "running" | "done" | "stopped" | "failed";

export const LAB_STEPS = ["questions", "answers", "brief", "plan", "cameras"] as const;
export type LabStep = (typeof LAB_STEPS)[number];

export const QUESTION_TOPICS = [
  "website",
  "product",
  "location",
  "avatar",
  "length",
  "mustNotAppear",
  "other",
] as const;
export type QuestionTopic = (typeof QUESTION_TOPICS)[number];
export type LabQuestion = { id: string; topic: QuestionTopic; question: string; ifYouDecide: string };
/** "you decide" is a valid answer: it means the question's `ifYouDecide`. */
export type LabAnswers = { answers: Array<{ id: string; answer: string }> };

export type LabBrief = FilledBrief & {
  /** What the product is and what a camera sees of it, from the website and the answers. */
  product: string;
  seconds: number;
  mustNotAppear: string[];
  /** A saved avatar, with its stored description byte-identical; null casts a new person. */
  avatar: { avatarId: string; description: string } | null;
};

/** A camera set remembers the plan attempt it was made for, so a newer plan makes it stale. */
export type CameraSet = { forPlan: number; cameras: Camera[] };
export type CheckRecord = { attempt: number; forPlan: number; passed: boolean; outcomes: CheckOutcome[] };

export type LabRun = {
  id: string;
  arch: LabArch;
  brief: string;
  url: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: LabStatus;
  reason: string | null;
  attempts: { plan: number; cameras: number };
  refusedInARow: Record<LabStep, number>;
  refusedTotal: Record<LabStep, number>;
  lastChecks: { plan: CheckRecord | null; shots: CheckRecord | null };
  /** Set when a shot check routed a redo: a new camera set may change only these shots. */
  pendingReshoot: { forCameras: number; shots: number[] } | null;
  rating: { score: number; note: string } | null;
};

export type TraceKind =
  | "new"
  | "scrape"
  | "save"
  | "refused"
  | "check"
  | "assemble"
  | "stop"
  | "fail"
  | "message"
  | "step";
export type TraceLine = { at: string; actor: string; kind: TraceKind; text: string; to?: string };
