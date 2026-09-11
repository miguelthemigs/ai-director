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
  /** Short human line, e.g. "11 verified · 1 unverified". */
  note?: string;
  /**
   * Real, event-driven fraction 0-1. The Evaluator's three group calls move it 1/3 → 2/3 → 3/3;
   * a node with no sub-steps holds it at 0 until it completes, then 1. Never a decorative loop —
   * see motion spec §8.1.
   */
  progress?: number;
  /** ISO timestamp of the real event that most recently moved this node into `running`. Drives
   *  the elapsed-seconds counter; never a client-side guess at when work "must have" started. */
  startedAt?: string;
  /** Set when a node completed successfully but produced a defect worth flagging — e.g. Span
   *  verification finding unverified quotes. Rendered as text, never colour alone, and never
   *  confused with `error` (which means the node itself failed). */
  warning?: string;
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
