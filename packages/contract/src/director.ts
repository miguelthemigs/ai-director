import type { RunStatus } from "./run.js";
import type { RenderStatus, VideoSize } from "./video.js";

/** The ten nodes of the Director's recipe, in the order the Architecture screen lists them. */
export const DIRECTOR_NODE_IDS = [
  "interrogator",
  "director",
  "planChecks",
  "product",
  "location",
  "character",
  "cinematographer",
  "assembler",
  "promptChecks",
  "render",
] as const;
export type DirectorNodeId = (typeof DIRECTOR_NODE_IDS)[number];

export const GATE_IDS = ["A", "B", "C"] as const;
export type GateId = (typeof GATE_IDS)[number];

export type NodeStatus = "queued" | "running" | "done" | "failed" | "skipped" | "blocked";
export type GateStatus = "locked" | "waiting" | "done" | "blocked";

export type FilledBrief = {
  brief: string;
  productKind: string;
  audience: string;
  tone: string;
  setting: string;
  character: string;
  suggestedSeconds: number | null;
};
export type CastChoice = { kind: "avatar"; avatarId: string } | { kind: "new" };
export type GateAAnswers = {
  productPhotoAsset: string;
  productKind: string;
  seconds: number;
  mustNotAppear: string[];
  cast: CastChoice;
};

export const SHOT_WEIGHT_SECONDS = { short: 2, normal: 3, long: 4 } as const;
export type ShotWeight = keyof typeof SHOT_WEIGHT_SECONDS;
/** How far the planned length may sit from the length the user chose. */
export const LENGTH_TOLERANCE_SECONDS = 2;
export type AssetKind = "product" | "location" | "character";
export type PlanAsset = { handle: string; kind: AssetKind; description: string };
export type PlanShot = { action: string; weight: ShotWeight; sound: string };
export type Plan = { styleLine: string; scene: string; assets: PlanAsset[]; shots: PlanShot[] };

export function plannedSeconds(plan: Plan): number {
  return plan.shots.reduce((total, shot) => total + SHOT_WEIGHT_SECONDS[shot.weight], 0);
}

export const CAMERA_MOVES = [
  "static",
  "slow push-in",
  "pull-out",
  "tracking",
  "orbit",
  "crane up",
  "handheld",
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];
export type Camera = {
  shot: number;
  framing: string;
  lensMm: number;
  move: CameraMove;
  light: string;
};

export type ReferenceImage = {
  slot: number;
  handle: string;
  kind: "product" | "location";
  url: string;
  asset: string;
};
export type CharacterOutcome = {
  avatarId: string;
  coachRunId: string;
  status: RunStatus;
  description: string;
  passed: boolean;
};

export const DIRECTOR_CHECK_IDS = [
  "length_fits",
  "handles_match",
  "references_within_cap",
  "no_timestamps",
  "nothing_ruled_out",
  "camera_per_shot",
  "light_has_direction",
] as const;
export type DirectorCheckId = (typeof DIRECTOR_CHECK_IDS)[number];

/** The copy the UI shows for each check. */
export const DIRECTOR_CHECK_LABELS: Record<DirectorCheckId, string> = {
  length_fits: "The shots fit the length you chose",
  handles_match: "Every @handle is declared, and every asset is used",
  references_within_cap: "At most 5 reference images, each with a role",
  no_timestamps: "No timestamps or seconds in any shot",
  nothing_ruled_out: "Nothing you said must not appear",
  camera_per_shot: "Every planned shot has one camera",
  light_has_direction: "Every light line names a source and a direction",
};
export type CheckOwner = "director" | "cinematographer";
export type CheckOutcome = {
  id: DirectorCheckId;
  passed: boolean;
  owner: CheckOwner;
  detail: string | null;
  shots: number[];
};

export const MAX_RETRIES_PER_OWNER = 2;
export const MAX_REFERENCE_IMAGES = 5;
export const SEEDANCE_PROMPT_CHAR_CAP = 15_000;
export const DIRECTOR_VIDEO_SIZE: VideoSize = "720x1280";
export type AssembledPrompt = { text: string; sha256: string; references: ReferenceImage[] };
export type CallLog = {
  model: string;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  microUsd: number | null;
  latencyMs: number;
};

export type DirectorRunStatus =
  | "running"
  | "awaiting_gate"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "stopped"
  | "rejected"
  | "failed";
export type Billing = "billed" | "not_billed" | "unknown";
export type DirectorEventBody =
  | { type: "run.started"; brief: string }
  | { type: "node.started"; node: DirectorNodeId; attempt: number; patchShots: number[] | null }
  | {
      type: "node.completed";
      node: DirectorNodeId;
      attempt: number;
      outputRef: string;
      summary: string;
      calls: CallLog[];
      latencyMs: number;
    }
  | { type: "node.failed"; node: DirectorNodeId; attempt: number; error: string }
  | { type: "node.abandoned"; node: DirectorNodeId; attempt: number }
  | { type: "checks.completed"; node: "planChecks" | "promptChecks"; outcomes: CheckOutcome[] }
  | {
      type: "route.sent";
      owner: CheckOwner;
      checkIds: DirectorCheckId[];
      shots: number[];
      retry: number;
    }
  | { type: "gate.opened"; gate: GateId }
  | {
      type: "gate.resolved";
      gate: GateId;
      decision: "approve" | "reject";
      reason: string | null;
      /** Set when gate A is approved (the length the user chose), null otherwise. */
      seconds: number | null;
    }
  | { type: "render.submitted"; attempt: number; taskId: string; estimatedMicroUsd: number }
  | { type: "render.polled"; status: RenderStatus; reads: number }
  | {
      type: "render.settled";
      /** Carried here too, because a submit that fails logs no `render.submitted`. */
      attempt: number;
      estimatedMicroUsd: number;
      status: RenderStatus;
      billing: Billing;
      actualMicroUsd: number | null;
      failure: string | null;
    }
  | { type: "run.finished"; status: DirectorRunStatus; reason: string | null };
export type DirectorEvent = DirectorEventBody & { runId: string; seq: number; at: string };

export type DirectorNodeView = {
  status: NodeStatus;
  attempt: number;
  summary: string | null;
  outputRef: string | null;
  error: string | null;
};
export type DirectorRunView = {
  id: string;
  brief: string;
  status: DirectorRunStatus;
  waitingAt: GateId | null;
  seconds: number | null;
  nodes: Record<DirectorNodeId, DirectorNodeView>;
  gates: Record<GateId, GateStatus>;
  retries: Record<CheckOwner, number>;
  checks: { plan: CheckOutcome[]; prompt: CheckOutcome[] };
  textMicroUsd: number;
  render: {
    attempt: number;
    status: RenderStatus;
    billing: Billing | null;
    estimatedMicroUsd: number;
    actualMicroUsd: number | null;
    failure: string | null;
  } | null;
  reason: string | null;
  lastSeq: number;
  startedAt: string;
  finishedAt: string | null;
};
export type DirectorRunSummary = Pick<
  DirectorRunView,
  "id" | "brief" | "status" | "waitingAt" | "seconds" | "textMicroUsd" | "startedAt"
> & { billedMicroUsd: number | null };

/** The recipe as a graph: nodes and gates, in the order the Architecture screen draws them. */
export const DIRECTOR_RECIPE_EDGES: ReadonlyArray<{
  from: DirectorNodeId | GateId;
  to: DirectorNodeId | GateId;
}> = [
  { from: "interrogator", to: "A" },
  { from: "A", to: "director" },
  { from: "director", to: "planChecks" },
  { from: "planChecks", to: "B" },
  { from: "B", to: "product" },
  { from: "B", to: "location" },
  { from: "B", to: "character" },
  { from: "B", to: "cinematographer" },
  { from: "product", to: "assembler" },
  { from: "location", to: "assembler" },
  { from: "character", to: "assembler" },
  { from: "cinematographer", to: "assembler" },
  { from: "assembler", to: "promptChecks" },
  { from: "promptChecks", to: "C" },
  { from: "C", to: "render" },
];
