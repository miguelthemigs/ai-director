import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR, T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";

const SEGMENT = 0.22;
/** How long the bright overlay stays mounted once triggered: the flow itself plus its own exit. */
const FLOW_VISIBLE_MS = (DUR.flow + DUR.micro) * 1000;

export type GraphEdgeProps = {
  edgeId: string;
  /** SVG path data for this edge, computed once from the static layout. */
  d: string;
  /** The real event id of the most recent handoff this edge ever carried, or null if it never
   *  has. A change in value (not merely a re-render) is what triggers the once-only flow. */
  flowToken: string | null;
  planned: boolean;
};

/**
 * One edge of the pipeline graph (motion spec §9, Moment 7). A dim base path is always drawn at
 * full length; a bright overlay travels along it exactly once per real handoff, keyed by that
 * handoff's own event id so a re-render can never replay it.
 *
 * The overlay's own visibility timer (not a prop the parent clears) is what makes this component
 * self-contained: `edgeFlowTokensFromEvents` is a pure function of the event log and never forgets
 * a token, so clearing has to happen here, on a real elapsed-time timeout, not by the parent
 * nulling state back out.
 */
function GraphEdgeImpl({ edgeId, d, flowToken, planned }: GraphEdgeProps): React.JSX.Element {
  const { reduce } = useMotionPrefs();
  const [visible, setVisible] = useState(false);
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    if (flowToken === null || flowToken === lastToken.current) return;
    lastToken.current = flowToken;
    if (planned || reduce) return; // §2.2: the edge flow is dropped entirely under reduced motion.
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), FLOW_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [flowToken, planned, reduce]);

  return (
    <g className="edge" data-edge-id={edgeId} data-planned={planned || undefined}>
      <path className="edge__base" data-active={flowToken !== null || undefined} d={d} fill="none" />

      {!planned && !reduce && (
        <AnimatePresence>
          {visible && flowToken !== null && (
            <motion.path
              key={flowToken}
              className="edge__flow"
              d={d}
              fill="none"
              initial={{ pathLength: SEGMENT, pathOffset: 0, opacity: 1 }}
              animate={{ pathOffset: 1 - SEGMENT }}
              exit={{ opacity: 0, transition: T.panelOut }}
              transition={T.flow}
            />
          )}
        </AnimatePresence>
      )}
    </g>
  );
}

export const GraphEdge = memo(GraphEdgeImpl);
