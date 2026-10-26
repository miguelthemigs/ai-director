import {
  DIRECTOR_NODE_IDS,
  DIRECTOR_RECIPE_EDGES,
  type CallLog,
  type CheckOutcome,
  type DirectorCheckId,
  type DirectorNodeId,
  type DirectorRunView,
  type GateAAnswers,
  type GateId,
} from "@ai-director/contract";

export type NodeContext = {
  runId: string;
  attempt: number;
  /** Set only when the node is the owner a failed check was routed back to; null otherwise. */
  patch: { checkIds: DirectorCheckId[]; shots: number[]; failures: CheckOutcome[] } | null;
  view: DirectorRunView;
  /** The latest output of a finished node. */
  read: <T>(node: DirectorNodeId) => Promise<T>;
  /** The gate A answers; throws if gate A has not been answered. */
  answers: () => Promise<GateAAnswers>;
};
export type NodeResult = { output: unknown; summary: string; calls: CallLog[] };
export type NodeSpec = {
  id: DirectorNodeId;
  after: Array<DirectorNodeId | GateId>;
  run: (ctx: NodeContext) => Promise<NodeResult>;
};
export type DirectorAgents = Record<Exclude<DirectorNodeId, "render">, (ctx: NodeContext) => Promise<NodeResult>>;

/**
 * Every node of the recipe except `render`, which only the gate C route may start.
 * A node's dependencies are the sources of its incoming edges in DIRECTOR_RECIPE_EDGES.
 */
export function buildRecipe(agents: DirectorAgents): NodeSpec[] {
  return DIRECTOR_NODE_IDS.filter((id): id is keyof DirectorAgents => id !== "render").map((id) => ({
    id,
    after: DIRECTOR_RECIPE_EDGES.filter((edge) => edge.to === id).map((edge) => edge.from),
    run: agents[id],
  }));
}
