import { useMemo, useRef, useState } from "react";
import { PIPELINE_EDGES, type RunEvent, type RunView } from "@ai-director/contract";
import type { RunStatus } from "../hooks/useRunStream.js";
import { cueEntriesFromEvents, edgeFlowTokensFromEvents, nodesFromEvents } from "../domain/derive.js";
import { CueLog } from "../components/CueLog.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { NodeInspector } from "../components/NodeInspector.js";
import { PipelineGraph } from "../components/PipelineGraph.js";
import { StageList } from "../components/StageList.js";
import "../styles/architecture-screen.css";

export type ArchitectureScreenProps = {
  /** Not read directly here — `TopBar` already renders the run identity strip for every screen —
   *  kept for the same prop shape `RunScreen` receives from `App`'s one `useRunStream`. */
  run: RunView | null;
  status: RunStatus;
  events: RunEvent[];
  error: string | null;
};

/**
 * The pipeline as a live audit view (design doc §4.2, §5, §6.3): the same event stream `RunScreen`
 * consumes, replayed through the pure `nodesFromEvents` into nine node states, laid out on a fixed
 * board and backed by a click-through inspector and an append-only cue log.
 *
 * Owns only `selectedNodeId` — everything else rendered here (`nodes`, `flowTokens`, `cueEntries`)
 * is derived fresh from `events` every render via pure functions in `domain/derive.ts`, so there is
 * nothing here that could drift out of sync with the stream itself.
 */
export function ArchitectureScreen({ status, events, error }: ArchitectureScreenProps): React.JSX.Element {
  const screenRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodes = useMemo(() => nodesFromEvents(events), [events]);
  const flowTokens = useMemo(() => edgeFlowTokensFromEvents(events), [events]);
  const cueEntries = useMemo(() => cueEntriesFromEvents(events), [events]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  // Motion spec §10: clicking the open node again clears it, same as Close or Escape.
  function handleSelectNode(id: string): void {
    setSelectedNodeId((current) => (current === id ? null : id));
  }

  function handleCloseInspector(): void {
    const previouslyOpenId = selectedNodeId;
    setSelectedNodeId(null);
    // Focus goes back to the exact button that opened the panel, never merely "somewhere on the
    // page" — the graph node is always mounted (it does not unmount when the inspector opens), so
    // this is a plain lookup, not a race with anything still animating in.
    if (previouslyOpenId) {
      screenRef.current?.querySelector<HTMLButtonElement>(`[data-testid="node-${previouslyOpenId}"]`)?.focus();
    }
  }

  return (
    <div className="arch" ref={screenRef}>
      <h1 className="sr-only">Architecture</h1>

      {status === "failed" && error ? (
        <ErrorPanel title="Run failed" detail={error} canResume={false} />
      ) : null}

      <div className="arch__graph">
        <PipelineGraph
          nodes={nodes}
          edges={PIPELINE_EDGES}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          flowTokens={flowTokens}
        />
        <StageList nodes={nodes} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />
      </div>

      <NodeInspector node={selectedNode} onClose={handleCloseInspector} />

      <div className="arch__cues">
        <CueLog entries={cueEntries} onSelectCue={handleSelectNode} />
      </div>
    </div>
  );
}
