import type { ReplacementView } from "@ai-director/contract";
import { FragmentDiffRow } from "./FragmentDiffRow.js";

export type FragmentDiffProps = {
  pass: number;
  /** Only the fragments this pass's Repairer actually changed — never the whole description
   *  (design doc §5: "Only the fragments that changed. Never renders the full text."). */
  replacements: ReplacementView[];
  /** 1-based source line for a replacement's old fragment, keyed by spanId; omitted when the span
   *  could not be located rather than showing a wrong line. */
  lineOf?: (spanId: string) => number | undefined;
  onSelectSpan: (spanId: string) => void;
};

/**
 * The fragment diff for one pass. A pass with nothing to repair renders the explicit line the
 * design doc fixes — `"No fragments changed in this pass."` — rather than an empty box, because
 * `no_improvement`'s honesty depends on that line being visible (motion spec §12).
 */
export function FragmentDiff({ pass, replacements, lineOf, onSelectSpan }: FragmentDiffProps): React.JSX.Element {
  if (replacements.length === 0) {
    return <p className="fragment-diff__empty">No fragments changed in this pass.</p>;
  }

  return (
    <ol className="fragment-diff" aria-label={`Pass ${pass} fragment changes`}>
      {replacements.map((replacement, index) => (
        <FragmentDiffRow
          key={replacement.spanId}
          replacement={replacement}
          line={lineOf?.(replacement.spanId)}
          order={index}
          passIndex={pass}
          onSelectSpan={onSelectSpan}
        />
      ))}
    </ol>
  );
}
