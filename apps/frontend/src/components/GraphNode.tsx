import { memo, useEffect, useState } from "react";
import { motion } from "motion/react";
import type { PipelineNode } from "@ai-director/contract";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

export type GraphNodeProps = {
  node: PipelineNode;
  selected: boolean;
  onSelect: (id: string) => void;
};

function elapsedSecondsSince(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}

/**
 * One node of the pipeline graph (design doc §5 "Architecture screen"; motion spec §8).
 *
 * A `running` node does not loop. Motion spec §8.1 resolves "this is working" without a pulse,
 * spinner, shimmer or marching border: `queued -> running` plays one 0.18s change (colour tokens
 * swap via `[data-state]` in CSS, and the accent rule sweeps `scaleX` 0 -> 1 once), then the node
 * holds still. What keeps reading as "running" after that is real data changing as text — the
 * elapsed-seconds counter below and the progress fraction — never a repeating animation.
 *
 * A `planned` node is a plain `<button>`, never a `motion.*` component. This is structural: there
 * is no prop a future change could add that would animate it, because the element cannot accept
 * one (motion spec §8.1, "Planned nodes").
 */
function GraphNodeImpl({ node, selected, onSelect }: GraphNodeProps): React.JSX.Element {
  const { t } = useMotionPrefs();
  const running = node.state === "running";

  // Ticks once a second only while running; the interval is cleared the moment it isn't, so a
  // done/failed/queued node never re-renders on its own account (only real events move it).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (node.state === "planned") {
    return (
      <button
        type="button"
        data-testid={`node-${node.id}`}
        className="node node--planned"
        onClick={() => onSelect(node.id)}
      >
        <span className="node__label">{node.label}</span>
        <span className="node__state">planned</span>
      </button>
    );
  }

  const progress = node.progress ?? 0;
  const elapsedSeconds = running && node.startedAt ? elapsedSecondsSince(node.startedAt, now) : null;
  const progressPercent = Math.round(progress * 100);

  return (
    <motion.button
      type="button"
      data-testid={`node-${node.id}`}
      className="node"
      data-state={node.state}
      data-selected={selected || undefined}
      data-warning={node.warning ? true : undefined}
      onClick={() => onSelect(node.id)}
      /* Colour lives in CSS on [data-state]; only opacity is animated here. */
      animate={{ opacity: node.state === "queued" ? 0.55 : 1 }}
      transition={t(node.state === "failed" ? T.nodeFail : T.node)}
    >
      <motion.span
        className="node__accent"
        aria-hidden="true"
        style={{ transformOrigin: "left center" }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: node.state === "queued" ? 0 : 1 }}
        /* The sweep is a transform, so reduced motion snaps it; the state label carries the fact. */
        transition={t(T.node, T.none)}
      />

      <span className="node__label">{node.label}</span>
      <span className="node__state">{node.state}</span>
      {node.note ? <span className="node__note">{node.note}</span> : null}
      {node.warning ? <span className="node__warning">{node.warning}</span> : null}

      {running && elapsedSeconds !== null ? (
        /* Data, not motion: a text node re-rendering once a second. No transition, no Motion. */
        <span className="node__elapsed tnum">{elapsedSeconds}s</span>
      ) : null}

      <span
        className="node__track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
        aria-label={`${node.label} progress`}
      >
        <motion.span
          className="node__progress"
          aria-hidden="true"
          style={{ transformOrigin: "left center" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: progress }}
          transition={t(T.node)}
        />
      </span>
      {running ? <span className="node__progress-text tnum">{progressPercent}%</span> : null}
    </motion.button>
  );
}

export const GraphNode = memo(GraphNodeImpl);
