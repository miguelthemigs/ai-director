import { CHECK_IDS, type CheckId, type Percent, type VersionRow } from "@ai-director/contract";

/**
 * Canned version history for `FixtureRunClient`. Every `why` is non-empty (spec §7 makes the note
 * required) and every `kappa` / `perCheckKappa` / `goldSetSize` is `null`: the gold set is not
 * marked yet (PRODUCT.md "Evidence on Hand"), so no agreement number exists to show, invented or
 * otherwise. `id` and `version` are the same short label here — a real store might give a version
 * its own semantic string distinct from its row id, but nothing downstream reads them differently
 * yet, so inventing a second scheme would only be decoration.
 */

type Profile = Record<CheckId, Percent>;

function meanOf(profile: Profile): number {
  const sum = CHECK_IDS.reduce((total, id) => total + profile[id], 0);
  return Math.round((sum / CHECK_IDS.length) * 10) / 10;
}

const V1_PROFILE: Profile = {
  age_build: 60,
  face_skin: 80,
  hair_spec: 40,
  wardrobe: 60,
  anchor_marker: 60,
  no_real_person: 80,
  no_brand_name: 80,
  drawable_only: 60,
  no_cross_slot: 40,
};

// hair_spec split into colour + texture + style (v2's own note); age_build and wardrobe also
// moved as a side effect of the same rubric edit.
const V2_PROFILE: Profile = {
  ...V1_PROFILE,
  age_build: 80,
  hair_spec: 80,
  wardrobe: 40,
  anchor_marker: 80,
};

// Prompt-only change (quote-exactly instruction); scored the same as v2 at the time it sealed.
const E1_PROFILE: Profile = { ...V2_PROFILE };

// wardrobe's head-to-toe instruction tightened; everything else unchanged from e1.
const E2_PROFILE: Profile = { ...E1_PROFILE, wardrobe: 80 };

const V1_MEAN = meanOf(V1_PROFILE);
const V2_MEAN = meanOf(V2_PROFILE);
const E1_MEAN = meanOf(E1_PROFILE);
const E2_MEAN = meanOf(E2_PROFILE);

function delta(current: number, previous: number): number {
  return Math.round((current - previous) * 10) / 10;
}

export const FIXTURE_VERSIONS: readonly VersionRow[] = [
  {
    id: "v1",
    kind: "rubric",
    version: "v1",
    sealedAt: "2026-09-02",
    why: "First frozen rubric. Band wording drafted from the Higgsfield Cast field list, checked against 12 published character sheets.",
    meanPercent: V1_MEAN,
    deltaPercent: null,
    profile: V1_PROFILE,
    kappa: null,
    perCheckKappa: null,
    goldSetSize: null,
  },
  {
    id: "v2",
    kind: "rubric",
    version: "v2",
    sealedAt: "2026-09-07",
    why: "Split hair_spec into colour, texture, and style as three separate cues; a single combined cue was scoring band 2 even when two of the three were present.",
    meanPercent: V2_MEAN,
    deltaPercent: delta(V2_MEAN, V1_MEAN),
    profile: V2_PROFILE,
    kappa: null,
    perCheckKappa: null,
    goldSetSize: null,
  },
  {
    id: "e1",
    kind: "evaluator_prompt",
    version: "e1",
    sealedAt: "2026-09-08",
    why: "Added a quote-exactly instruction to the evaluator prompt; verbatim-quote regressions had begun to slip through the paraphrase-retry path.",
    meanPercent: E1_MEAN,
    deltaPercent: delta(E1_MEAN, V2_MEAN),
    profile: E1_PROFILE,
    kappa: null,
    perCheckKappa: null,
    goldSetSize: null,
  },
  {
    id: "e2",
    kind: "evaluator_prompt",
    version: "e2",
    sealedAt: "2026-09-09",
    why: "Tightened the wardrobe head-to-toe instruction; wardrobe was the one check still failing threshold after v2 and e1.",
    meanPercent: E2_MEAN,
    deltaPercent: delta(E2_MEAN, E1_MEAN),
    profile: E2_PROFILE,
    kappa: null,
    perCheckKappa: null,
    goldSetSize: null,
  },
  {
    id: "r1",
    kind: "repairer_prompt",
    version: "r1",
    sealedAt: "2026-09-10",
    why: "Loosened the repairer's rewrite-length cap so long wardrobe fragments stop truncating mid-repair. Sealed today; no run has been scored against it yet.",
    meanPercent: null,
    deltaPercent: null,
    profile: null,
    kappa: null,
    perCheckKappa: null,
    goldSetSize: null,
  },
];

/** The file content each version's row would seal, as plain lines — enough for `PromptDiff` to
 *  draw a real edit script against, without pretending these are the actual backend files. */
export const FIXTURE_VERSION_CONTENT: Record<string, readonly string[]> = {
  v1: [
    "Score each check 1 to 5 against the band table.",
    "hair_spec: state colour and texture only.",
    "wardrobe: describe the visible garments.",
  ],
  v2: [
    "Score each check 1 to 5 against the band table.",
    "hair_spec: state colour, texture, and style as three separate cues.",
    "wardrobe: describe the visible garments.",
  ],
  e1: [
    "Score each check 1 to 5 against the band table.",
    "hair_spec: state colour, texture, and style as three separate cues.",
    "wardrobe: describe the visible garments.",
    "Quote every failing check's evidence exactly as written. Do not paraphrase.",
  ],
  e2: [
    "Score each check 1 to 5 against the band table.",
    "hair_spec: state colour, texture, and style as three separate cues.",
    "wardrobe: describe every visible garment from head to toe, not just one piece.",
    "Quote every failing check's evidence exactly as written. Do not paraphrase.",
  ],
  r1: [
    "Rewrite only the quoted fragment; never the whole description.",
    "Keep the replacement within twice the original fragment's length.",
    "Preserve surrounding punctuation exactly.",
  ],
};
