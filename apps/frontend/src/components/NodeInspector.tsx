import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PipelineNode } from "@ai-director/contract";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";
import { MetricRow } from "./MetricRow.js";
import { PayloadViewer } from "./PayloadViewer.js";

export type NodeInspectorProps = {
  /** `null` when no node is selected. */
  node: PipelineNode | null;
  onClose: () => void;
};

const NOT_MEASURED = "not measured";

function formatLatency(ms: number | undefined): string {
  return ms === undefined ? NOT_MEASURED : `${(ms / 1000).toFixed(2)} s`;
}

function formatTokens(n: number | undefined): string {
  return n === undefined ? NOT_MEASURED : `${n.toLocaleString()} tok`;
}

function formatCost(usd: number | undefined): string {
  // Fixed at 4 places: the fixture's per-call cost ($0.02-ish) would round to $0.00 at 2 places,
  // which is indistinguishable from "not measured" — the one failure mode this screen must avoid.
  return usd === undefined ? NOT_MEASURED : `$${usd.toFixed(4)}`;
}

/**
 * The one elevation step (design doc §5, §6.3; motion spec §10, Moment 8). State, cue id, latency,
 * tokens in/out, cost, then the real payload — in that order, every time, so an assessor never has
 * to hunt for where a given step's numbers live.
 *
 * Every metric a step did not actually produce reads "not measured", never a fabricated `0` or
 * `$0.00` — the one thing this screen must never do (task 15 brief).
 */
export function NodeInspector({ node, onClose }: NodeInspectorProps): React.JSX.Element {
  const { t, v } = useMotionPrefs();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves on the state change, never gated on an animation callback — motion must not gate
  // accessibility (motion spec §10).
  useEffect(() => {
    if (node !== null) closeRef.current?.focus();
  }, [node?.id]);

  useEffect(() => {
    if (node === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [node, onClose]);

  if (node === null) {
    return (
      <aside className="inspector" aria-label="Step inspector">
        <p className="inspector__empty">Select a node to see its payload, latency and cost.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Step inspector">
      {/*
       * The panel itself is a plain conditional, not an AnimatePresence child: it must appear the
       * instant a node is clicked, with no exit-then-enter sequencing to wait through (motion
       * spec §10: "Clicking a node sets inspectorNodeId ... clicking close ... clears it" — the
       * open/close edge is a state change the inspector's own presence follows directly). Only the
       * body beneath — which node's metrics and payload are showing — plays the enter transition
       * below, and only the swap between two already-open nodes uses `mode="wait"` so two payloads
       * of different heights are never both mounted at once.
       */}
      <motion.div
        className="inspector__panel"
        role="dialog"
        aria-label={`${node.label} payload`}
        initial={v({ opacity: 0, x: 16 }, { opacity: 0 })}
        animate={v({ opacity: 1, x: 0 }, { opacity: 1 })}
        transition={t(T.panelIn, T.fade)}
      >
        <div className="inspector__header">
          <span className="inspector__title">{node.label}</span>
          <button type="button" ref={closeRef} className="inspector__close" onClick={onClose}>
            Close
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={node.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: t(T.panelOut) }}
            transition={t(T.select, T.fade)}
          >
            <MetricRow label="state" value={node.state} />
            {node.cueId ? <MetricRow label="cue" value={node.cueId} mono /> : null}
            <MetricRow label="latency" value={formatLatency(node.latencyMs)} mono />
            <MetricRow label="tokens in" value={formatTokens(node.tokensIn)} mono />
            <MetricRow label="tokens out" value={formatTokens(node.tokensOut)} mono />
            <MetricRow label="cost" value={formatCost(node.costUsd)} mono />
            {node.note ? <MetricRow label="note" value={node.note} /> : null}
            {node.warning ? <MetricRow label="warning" value={node.warning} /> : null}
            {node.error ? <MetricRow label="error" value={node.error} /> : null}

            <PayloadViewer value={node.payload ?? null} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </aside>
  );
}
