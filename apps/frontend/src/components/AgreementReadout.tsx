export type AgreementReadoutProps = {
  /** Cohen's kappa. `null` when the gold set has not been marked — never a fabricated number
   *  (PRODUCT.md "Evidence on Hand": agreement numbers "must not be fabricated in any screen or
   *  mock"). */
  kappa: number | null;
  goldSetSize: number | null;
};

/**
 * The one place in the product allowed to talk about human agreement, and the one place a
 * fabricated number would be most tempting. `null` always renders as an explicit sentence, never
 * as `0`, `0.00`, or a bare dash that could be misread as zero (design doc §5, §6.4).
 */
export function AgreementReadout({ kappa, goldSetSize }: AgreementReadoutProps): React.JSX.Element {
  if (kappa === null) {
    return (
      <p className="agreement-readout agreement-readout--unmeasured">
        Agreement not measured yet — the gold set has not been marked.
      </p>
    );
  }

  if (goldSetSize === null) {
    // A kappa with no recorded sample size is not evidence either — never print one without the
    // other.
    return (
      <p className="agreement-readout">
        &kappa; <span className="tnum">{kappa.toFixed(2)}</span> — sample size not recorded.
      </p>
    );
  }

  return (
    <p className="agreement-readout">
      &kappa; <span className="tnum">{kappa.toFixed(2)}</span> on a gold set of{" "}
      <span className="tnum">{goldSetSize}</span> items.
    </p>
  );
}
