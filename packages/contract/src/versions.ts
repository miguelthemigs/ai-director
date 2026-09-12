import type { Band, CheckId, Percent } from "./checks.js";

export type VersionKind = "rubric" | "evaluator_prompt" | "repairer_prompt";

export type VersionRow = {
  id: string;
  kind: VersionKind;
  version: string;
  sealedAt: string;
  /** Required by spec §7. Never optional, never empty. */
  why: string;
  meanPercent: number | null;
  deltaPercent: number | null;
  /** Nine points in rubric order. Null until a run has scored against this version. */
  profile: Record<CheckId, Percent> | null;
  /** Null until the agreement study has run. Never invent a number here. */
  kappa: number | null;
  perCheckKappa: Record<CheckId, number> | null;
  goldSetSize: number | null;
};

export type CheckDelta = {
  checkId: CheckId;
  /** Null when either side is unmeasured. Never coerce an unmeasured side to zero. */
  deltaPercent: number | null;
  bandA: Band | null;
  bandB: Band | null;
};

export type VersionCompare = {
  a: VersionRow;
  b: VersionRow;
  promptDiff: Array<{ kind: "same" | "added" | "removed"; text: string }>;
  perCheck: CheckDelta[];
};
