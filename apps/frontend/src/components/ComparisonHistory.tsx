import type { ComparisonSummary } from "@ai-director/contract";
import { formatMicroUsd } from "../data/compareApi.js";

/**
 * Every pair ever rendered, newest first, reopenable.
 *
 * ── Why a paid artefact needs a list ────────────────────────────────────────────────
 * Each row cost real money and minutes of wall clock. Before this existed a comparison
 * lived only in the tab that started it: a reload lost it, and a lost clip looks exactly
 * like a render that never happened. Everything is on disk, so everything is listed.
 *
 * The estimate and the bill are separate columns and a pair that has not reported both
 * says so. A summed total that quietly used the estimate where a bill was missing would
 * be a number nobody could trace, which is the one thing this project will not print.
 */
export function ComparisonHistory({
  rows,
  selectedId,
  onOpen,
}: {
  rows: ComparisonSummary[];
  selectedId: string | null;
  onOpen: (comparisonId: string) => void;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="compare-empty">No pairs rendered yet.</p>;
  }

  return (
    <table className="history">
      <caption className="sr-only">Previously rendered comparisons</caption>
      <thead>
        <tr>
          <th scope="col">Pair</th>
          <th scope="col">When</th>
          <th scope="col">Shape</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
          <th scope="col">Estimated</th>
          <th scope="col">Billed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.comparisonId} data-selected={row.comparisonId === selectedId || undefined}>
            <th scope="row">
              <button type="button" className="history__open" onClick={() => onOpen(row.comparisonId)}>
                {row.comparisonId.slice(0, 8)}
              </button>
            </th>
            <td>{new Date(row.createdAt).toLocaleString()}</td>
            <td className="tnum">
              {row.size} · {row.seconds}s
            </td>
            <td data-status={row.beforeStatus}>{row.beforeStatus}</td>
            <td data-status={row.afterStatus}>{row.afterStatus}</td>
            <td className="tnum">{formatMicroUsd(row.estimatedMicroUsd)}</td>
            <td className="tnum" data-unmeasured={row.actualMicroUsd === null || undefined}>
              {formatMicroUsd(row.actualMicroUsd)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
