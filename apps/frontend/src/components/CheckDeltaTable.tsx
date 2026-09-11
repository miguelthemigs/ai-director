import type { Band, CheckDelta, Percent } from "@ai-director/contract";
import { CHECK_TITLES } from "../domain/labels.js";
import { STAGGER, STAGGER_CAP } from "../motion/tokens.js";
import { BandMeter } from "./BandMeter.js";
import { DeltaBadge } from "./DeltaBadge.js";

const PERCENT_BY_BAND: Record<Band, Percent> = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

function percentForBand(band: Band | null): Percent | null {
  return band === null ? null : PERCENT_BY_BAND[band];
}

/**
 * Nine rows, check by check: name, band meter before, band meter after, delta badge — the
 * artefact spec §9 asks for, "so v2 beat v1 is legible check by check" (design doc §5). Reuses
 * `BandMeter` for both meters rather than a bespoke bar, so the same fill animation — and the same
 * 0.03s stagger capped at index 8 the motion spec gives this exact table (§11.2) — comes for free.
 * A `null` delta (either side unmeasured) renders "not comparable", never a number.
 */
export function CheckDeltaTable({ perCheck }: { perCheck: CheckDelta[] }): React.JSX.Element {
  return (
    <table className="check-delta-table">
      <caption className="sr-only">Per-check score change between the two selected versions</caption>
      <thead>
        <tr>
          <th scope="col">Check</th>
          <th scope="col">Before</th>
          <th scope="col" aria-hidden="true" />
          <th scope="col">After</th>
          <th scope="col">Δ</th>
        </tr>
      </thead>
      <tbody>
        {perCheck.map((delta, index) => {
          const rowDelay = Math.min(index, STAGGER_CAP.delta) * STAGGER.delta;
          return (
            <tr key={delta.checkId}>
              <th scope="row" className="check-delta-table__check">
                {CHECK_TITLES[delta.checkId]}
              </th>
              <td>
                <BandMeter
                  band={delta.bandA}
                  percent={percentForBand(delta.bandA)}
                  width={56}
                  showThreshold={false}
                  delay={rowDelay}
                />
              </td>
              <td className="check-delta-table__arrow" aria-hidden="true">
                &rarr;
              </td>
              <td>
                <BandMeter
                  band={delta.bandB}
                  percent={percentForBand(delta.bandB)}
                  width={56}
                  showThreshold={false}
                  delay={rowDelay}
                />
              </td>
              <td>
                <DeltaBadge
                  delta={delta.deltaPercent}
                  unmeasuredLabel={delta.deltaPercent === null ? "not comparable" : undefined}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
