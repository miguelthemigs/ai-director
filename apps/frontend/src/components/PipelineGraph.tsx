import { memo } from "react";
import type { PipelineEdge, PipelineNode } from "@ai-director/contract";
import { GraphEdge } from "./GraphEdge.js";
import { GraphNode } from "./GraphNode.js";

export type PipelineGraphProps = {
  nodes: PipelineNode[];
  edges: readonly PipelineEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  /** Latest handoff event id per edge, keyed `"<from>-><to>"` (`edgeFlowTokensFromEvents`). */
  flowTokens: Record<string, string>;
};

type Cell = { col: number; row: number };

/**
 * Fixed, hand-authored positions for the known v1 pipeline (design doc §4.2: "The graph is a
 * hand-laid SVG on a fixed lattice ... It is not a force layout: this is a known, fixed pipeline,
 * and a physics simulation of a known graph is decoration. Node positions are a constant in
 * code.") Adding a tenth node is the only way this table grows; nothing here is computed from the
 * edge list or from measurement.
 */
/*
 * ── Relaid 2026-09-12 ───────────────────────────────────────────────────────────
 * The first lattice was 5 columns by 7 rows with every other row left empty as
 * spacing, so the live chain ran straight down the right-hand edge, the three
 * planned nodes sat stranded on the left, and roughly half the board was blank. The
 * shape of the pipeline was not readable from the picture of it.
 *
 * This is the same nine nodes and the same eight edges on a 4x3 lattice, laid out so
 * the edge list draws itself:
 *
 *   row 0   Description → Evaluator → Span verification → Repairer
 *   row 1                    Gate    ←     Splice        ←
 *   row 2   Interrogator   Director  →  Identity Meter        (all planned)
 *
 * The repair loop is now a serpentine that turns back on itself and re-enters the
 * Evaluator, which is what the loop actually does. The planned band is one row along
 * the bottom, reads as "not built yet" by position as well as by its dashed edges
 * and its own PLANNED label.
 */
const LAYOUT: Record<string, Cell> = {
  intake: { col: 0, row: 0 },
  evaluator: { col: 1, row: 0 },
  verify: { col: 2, row: 0 },
  repairer: { col: 3, row: 0 },
  splice: { col: 3, row: 1 },
  gate: { col: 2, row: 1 },
  interrogator: { col: 0, row: 2 },
  director: { col: 1, row: 2 },
  identity: { col: 2, row: 2 },
};

const NODE_W = 168;
const NODE_H = 76;
const COL_GAP = 64;
const ROW_GAP = 56;
const PAD = 24;

function topLeft(cell: Cell): { x: number; y: number } {
  return { x: PAD + cell.col * (NODE_W + COL_GAP), y: PAD + cell.row * (NODE_H + ROW_GAP) };
}

function center(cell: Cell): { x: number; y: number } {
  const tl = topLeft(cell);
  return { x: tl.x + NODE_W / 2, y: tl.y + NODE_H / 2 };
}

/** How much each corner of an orthogonal edge is rounded. Small: these are still right
 *  angles on a lattice, not a curve fit. A hard 90-degree join reads as a schematic from
 *  1994, and at 10px the corner is legible as a turn rather than a blob. */
const CORNER = 10;

/** An orthogonal polyline between two node centres, horizontal leg first, then vertical
 *  (design doc §4.2: "Edges are orthogonal polylines"), with its two corners rounded by
 *  `CORNER`. The bend sits at the horizontal leg's midpoint; there is no curve-fitting or
 *  physics involved. */
function orthogonalPath(from: Cell, to: Cell): string {
  const a = center(from);
  const b = center(to);
  if (a.x === b.x || a.y === b.y) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  const midX = (a.x + b.x) / 2;
  const xDir = Math.sign(midX - a.x);
  const yDir = Math.sign(b.y - a.y);
  // Never round more than half a leg, or the two corners of a short leg overlap and the
  // path doubles back on itself.
  const r = Math.min(CORNER, Math.abs(midX - a.x) / 2, Math.abs(b.y - a.y) / 2);
  if (r <= 0) return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;

  return [
    `M ${a.x} ${a.y}`,
    `L ${midX - xDir * r} ${a.y}`,
    `Q ${midX} ${a.y} ${midX} ${a.y + yDir * r}`,
    `L ${midX} ${b.y - yDir * r}`,
    `Q ${midX} ${b.y} ${midX + xDir * r} ${b.y}`,
    `L ${b.x} ${b.y}`,
  ].join(" ");
}

/** The logical board's own size, in the same units `LAYOUT` and the node box constants use. */
export function boardSize(): { width: number; height: number } {
  const cells = Object.values(LAYOUT);
  const maxCol = Math.max(...cells.map((c) => c.col));
  const maxRow = Math.max(...cells.map((c) => c.row));
  return {
    width: PAD * 2 + maxCol * (NODE_W + COL_GAP) + NODE_W,
    height: PAD * 2 + maxRow * (NODE_H + ROW_GAP) + NODE_H,
  };
}

/**
 * The desktop pipeline board (design doc §4.2, §5). A dim SVG layer draws every edge at a
 * constant, hand-authored position; an HTML overlay of `GraphNode` buttons sits on the same
 * coordinate grid so nodes stay real, focusable, clickable elements rather than SVG shapes with
 * synthetic click handling bolted on.
 */
function PipelineGraphImpl({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  flowTokens,
}: PipelineGraphProps): React.JSX.Element {
  const { width, height } = boardSize();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="graph" role="group" aria-label="Pipeline graph" style={{ width, height }}>
      <svg
        className="graph__edges"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
      >
        {edges.map((edge) => {
          const from = LAYOUT[edge.from];
          const to = LAYOUT[edge.to];
          if (!from || !to) return null;
          const edgeId = `${edge.from}->${edge.to}`;
          const planned =
            nodeById.get(edge.from)?.state === "planned" || nodeById.get(edge.to)?.state === "planned";
          return (
            <GraphEdge
              key={edgeId}
              edgeId={edgeId}
              d={orthogonalPath(from, to)}
              flowToken={flowTokens[edgeId] ?? null}
              planned={planned}
            />
          );
        })}
      </svg>

      <div className="graph__nodes">
        {nodes.map((node) => {
          const cell = LAYOUT[node.id];
          if (!cell) return null;
          const tl = topLeft(cell);
          return (
            <div
              key={node.id}
              className="graph__node-slot"
              style={{ left: tl.x, top: tl.y, width: NODE_W, height: NODE_H }}
            >
              <GraphNode node={node} selected={selectedNodeId === node.id} onSelect={onSelectNode} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const PipelineGraph = memo(PipelineGraphImpl);
