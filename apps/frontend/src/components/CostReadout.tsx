import { formatMicroUsd } from "../data/compareApi.js";

/**
 * The estimate and the bill, as two figures that never collapse into one.
 *
 * They are different KINDS of fact. The estimate is a property of the request, derived
 * from OpenRouter's published per-token rate before anything was submitted. The bill is a
 * property of the outcome, reported by OpenRouter as `usage.cost` on the terminal task.
 * Showing one number would mean picking which of those to hide.
 *
 * `not measured` rather than `$0.00` when the vendor reported no cost, which is the same
 * discipline `StepCost`'s all-optional shape enforces on the Run screen: a zero is a
 * measurement of free, and this app does not report measurements it does not have.
 */
export function CostReadout({
  estimatedMicroUsd,
  actualMicroUsd,
}: {
  estimatedMicroUsd: number;
  actualMicroUsd: number | null;
}): React.JSX.Element {
  return (
    <dl className="cost-readout">
      <div className="cost-readout__pair">
        <dt>Estimated</dt>
        <dd className="tnum">{formatMicroUsd(estimatedMicroUsd)}</dd>
      </div>
      <div className="cost-readout__pair" data-unmeasured={actualMicroUsd === null || undefined}>
        <dt>Billed</dt>
        <dd className="tnum">{formatMicroUsd(actualMicroUsd)}</dd>
      </div>
    </dl>
  );
}
