import { motion } from "motion/react";
import type { VersionCompare as VersionCompareData } from "@ai-director/contract";
import { VERSION_KIND_TITLES } from "../domain/labels.js";
import { T } from "../motion/tokens.js";
import { useMotionPrefs } from "../motion/useMotionPrefs.js";
import { AgreementReadout } from "./AgreementReadout.js";
import { CheckDeltaTable } from "./CheckDeltaTable.js";
import { PromptDiff } from "./PromptDiff.js";

export type VersionCompareProps = {
  compare: VersionCompareData;
  onSwap: () => void;
  onClose: () => void;
};

function diffTitle(compare: VersionCompareData): string {
  const kind =
    compare.a.kind === compare.b.kind
      ? VERSION_KIND_TITLES[compare.a.kind]
      : `${VERSION_KIND_TITLES[compare.a.kind]} → ${VERSION_KIND_TITLES[compare.b.kind]}`;
  return `${kind}: ${compare.a.id} → ${compare.b.id}`;
}

/**
 * The two-pane compare (design doc §5, §6.4; motion spec §11.2): prompt/rubric diff on one side,
 * the per-check delta table on the other. Enters with `opacity 0→1, y 8→0` over the dialog/sheet
 * duration; the diff text and version notes underneath never animate at all.
 */
export function VersionCompare({ compare, onSwap, onClose }: VersionCompareProps): React.JSX.Element {
  const { t, v } = useMotionPrefs();

  return (
    <motion.section
      className="version-compare"
      role="region"
      aria-label={`Comparing ${compare.a.id} and ${compare.b.id}`}
      initial={v({ opacity: 0, y: 8 }, { opacity: 0 })}
      animate={v({ opacity: 1, y: 0 }, { opacity: 1 })}
      transition={t(T.terminal, T.fade)}
    >
      <div className="version-compare__header">
        <p className="version-compare__title">
          Compare <strong>{compare.a.id}</strong>
          <span aria-hidden="true"> &hArr; </span>
          <strong>{compare.b.id}</strong>
        </p>
        <button type="button" className="version-compare__swap" onClick={onSwap}>
          Swap
        </button>
        <button type="button" className="version-compare__close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="version-compare__agreement">
        <AgreementReadout kappa={compare.a.kappa} goldSetSize={compare.a.goldSetSize} />
        <AgreementReadout kappa={compare.b.kappa} goldSetSize={compare.b.goldSetSize} />
      </div>

      <div className="version-compare__panes">
        <PromptDiff lines={compare.promptDiff} title={diffTitle(compare)} />
        <CheckDeltaTable perCheck={compare.perCheck} />
      </div>
    </motion.section>
  );
}
