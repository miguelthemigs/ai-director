import type { PipelineNode } from "@ai-director/contract";

export type StageListProps = {
  nodes: PipelineNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
};

/**
 * The phone replacement for `PipelineGraph` (design doc §4.2): one row per node, in pipeline
 * order, carrying the same state, cue id and latency the graph does — "a node graph that must be
 * pinch-zoomed is worse than a list, and the list carries every state, payload, latency and cost
 * the graph does." Visibility between this and the graph is a CSS breakpoint (`architecture-screen.css`),
 * not a JS media-query branch, matching how the rest of the app degrades responsively.
 */
export function StageList({ nodes, selectedNodeId, onSelectNode }: StageListProps): React.JSX.Element {
  return (
    <ol className="stage-list" aria-label="Pipeline stages">
      {nodes.map((node) => (
        <li key={node.id} className="stage-list__row" data-planned={node.state === "planned" || undefined}>
          <button
            type="button"
            data-testid={`stage-${node.id}`}
            className="stage-list__button"
            data-state={node.state}
            data-selected={selectedNodeId === node.id || undefined}
            onClick={() => onSelectNode(node.id)}
          >
            <span className="stage-list__label">{node.label}</span>
            <span className="stage-list__state">{node.state}</span>
            {node.cueId ? <span className="stage-list__cue tnum">{node.cueId}</span> : null}
            {node.latencyMs !== undefined ? (
              <span className="stage-list__latency tnum">{(node.latencyMs / 1000).toFixed(2)}s</span>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  );
}
