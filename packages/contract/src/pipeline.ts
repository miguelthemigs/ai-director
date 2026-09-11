export const NODE_STATES = ["planned", "queued", "running", "done", "failed"] as const;
export type NodeState = (typeof NODE_STATES)[number];

export type NodeKind = "intake" | "agent" | "enforce" | "gate";

export type PipelineNode = {
  id: string;
  label: string;
  kind: NodeKind;
  state: NodeState;
  /** `<pass>-<step>` of the event that last moved this node. */
  cueId?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  payload?: unknown;
  error?: string;
  /** Short human line, e.g. "11 verified, 1 unverified". */
  note?: string;
};

export type PipelineEdge = { from: string; to: string };

/**
 * The v1 pipeline, including the three agents the spec designs but does not build.
 * A `planned` node is never given a state by any event; it is planned for the life of v1.
 */
export const PIPELINE_NODES: readonly PipelineNode[] = [
  { id: "intake", label: "Description", kind: "intake", state: "queued" },
  { id: "interrogator", label: "Interrogator", kind: "agent", state: "planned" },
  { id: "evaluator", label: "Evaluator", kind: "agent", state: "queued" },
  { id: "verify", label: "Span verification", kind: "enforce", state: "queued" },
  { id: "repairer", label: "Repairer", kind: "agent", state: "queued" },
  { id: "splice", label: "Splice", kind: "enforce", state: "queued" },
  { id: "gate", label: "Pass gate", kind: "gate", state: "queued" },
  { id: "director", label: "Director", kind: "agent", state: "planned" },
  { id: "identity", label: "Identity Meter", kind: "agent", state: "planned" },
];

export const PIPELINE_EDGES: readonly PipelineEdge[] = [
  { from: "intake", to: "evaluator" },
  { from: "evaluator", to: "verify" },
  { from: "verify", to: "repairer" },
  { from: "repairer", to: "splice" },
  { from: "splice", to: "gate" },
  { from: "gate", to: "evaluator" },
  { from: "gate", to: "director" },
  { from: "director", to: "identity" },
];
