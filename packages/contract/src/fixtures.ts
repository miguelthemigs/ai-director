import { groupOf, type Band, type CheckGroup, type CheckId, type Percent } from "./checks.js";
import { eventId, type RunEvent } from "./events.js";
import {
  isScoredCheck,
  type CheckResultView,
  type PassView,
  type ReplacementView,
  type RunStatus,
  type RunView,
  type SpanView,
  type StepCost,
  type UnverifiedQuoteView,
} from "./run.js";

const PERCENT: Record<Band, Percent> = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

/** Locate a quote in the description so no offset is ever hand-written. */
function spanFor(description: string, checkId: CheckId, quote: string, n: number): SpanView {
  const start = description.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote not present in description: ${quote}`);
  return { spanId: `${checkId}-${n}`, checkId, quote, start, end: start + quote.length };
}

/** A scored check: the group's evaluator call completed. */
function result(
  description: string,
  checkId: CheckId,
  band: Band,
  reason: string,
  quotes: string[] = [],
  unverified: UnverifiedQuoteView[] = [],
): CheckResultView {
  return {
    status: "scored",
    checkId,
    group: groupOf(checkId),
    band,
    percent: PERCENT[band],
    passed: band >= 4,
    reason,
    spans: quotes.map((q, i) => spanFor(description, checkId, q, i)),
    unverified,
    missingEvidence: band < 4 && quotes.length === 0 && unverified.length === 0,
  };
}

/** A check whose group's evaluator call never completed. No band, no percent, no passed. */
function notEvaluated(checkId: CheckId, reason: string): CheckResultView {
  return { status: "not_evaluated", checkId, group: groupOf(checkId), reason };
}

function failingOf(results: CheckResultView[]): CheckId[] {
  return results.filter(isScoredCheck).filter((r) => !r.passed).map((r) => r.checkId);
}

// Fixtures are canned, complete data -- every cost figure below is always fully measured, unlike
// a real run's `StepCost` (optional fields, so an unmeasured run never fakes a `0`). `Required`
// keeps that guarantee explicit here rather than re-introducing undefined checks fixtures don't need.
const COST: Required<StepCost> = { inputTokens: 1100, outputTokens: 600, usd: 0.02, latencyMs: 4200 };

function scaleCost(c: Required<StepCost>, n: number): Required<StepCost> {
  return {
    inputTokens: c.inputTokens * n,
    outputTokens: c.outputTokens * n,
    usd: Math.round(c.usd * n * 100) / 100,
    latencyMs: c.latencyMs * n,
  };
}

// ---------------------------------------------------------------------------
// passed: one pass, every check at band 4 or 5, nothing to repair.
// ---------------------------------------------------------------------------

const STRONG = [
  "Male, Latino, around 30, lean and tall with broad shoulders.",
  "Fair freckled skin, a sharp jawline, a small mole below the left eye.",
  "Dark brown wavy hair, slicked back, collar length.",
  "A dusty-rose short-sleeve shirt open over a white tee, light-wash baggy jeans,",
  "black-and-white low-top canvas sneakers.",
  "A small gold hoop earring in the left ear and a thin scar through the right eyebrow.",
].join(" ");

const passedResults: CheckResultView[] = [
  result(STRONG, "age_build", 5, "Gives sex, ethnicity, decade and build together.", [
    "Male, Latino, around 30, lean and tall with broad shoulders",
  ]),
  result(STRONG, "face_skin", 5, "Skin tone, texture and a distinguishing mark all present.", [
    "Fair freckled skin, a sharp jawline, a small mole below the left eye",
  ]),
  result(STRONG, "hair_spec", 5, "Colour, texture, style and length all given.", [
    "Dark brown wavy hair, slicked back, collar length",
  ]),
  result(STRONG, "wardrobe", 4, "Top, layering, bottoms and footwear all specified.", [
    "A dusty-rose short-sleeve shirt open over a white tee, light-wash baggy jeans,",
  ]),
  result(STRONG, "anchor_marker", 4, "A reusable, non-generic identity anchor is present.", [
    "a thin scar through the right eyebrow",
  ]),
  result(STRONG, "no_real_person", 5, "No public figure or lookalike framing.", []),
  result(STRONG, "no_brand_name", 5, "No brand name present.", []),
  result(STRONG, "drawable_only", 5, "Every descriptor is a visible, drawable attribute.", []),
  result(STRONG, "no_cross_slot", 5, "No camera or lighting instruction inside the character block.", []),
];

const passedPass: PassView = {
  pass: 1,
  description: STRONG,
  results: passedResults,
  failing: failingOf(passedResults),
  replacements: [],
};

const passedRun: RunView = {
  runId: "run-passed-001",
  rubricVersion: "1.0.0",
  model: "gpt-5.1",
  status: "passed",
  startedAt: "2026-09-01T10:00:00.000Z",
  finishedAt: "2026-09-01T10:00:07.000Z",
  originalDescription: STRONG,
  finalDescription: STRONG,
  passes: [passedPass],
  cost: scaleCost(COST, 3),
};

// ---------------------------------------------------------------------------
// improvedStillFailing: three passes, failing shrinks 9 -> 6 -> 4, never zero.
// ---------------------------------------------------------------------------

const WEAK = [
  "A confident young man with striking features and an effortlessly cool presence.",
  "He wears a Nike hoodie and looks a bit like Ryan Gosling.",
  "Shot with dramatic side lighting and a shallow depth of field.",
].join(" ");

const PASS1_DESC = WEAK;

const pass1Results: CheckResultView[] = [
  result(PASS1_DESC, "age_build", 2, "Names 'young' but gives no bracket and no build.", ["young man"]),
  result(PASS1_DESC, "face_skin", 1, "No face or skin detail beyond a judgement.", ["striking features"]),
  result(PASS1_DESC, "hair_spec", 1, "Hair is absent entirely.", ["A confident young man"]),
  result(PASS1_DESC, "wardrobe", 2, "One garment, no footwear.", ["a Nike hoodie"]),
  result(PASS1_DESC, "anchor_marker", 1, "No reusable identity anchor.", ["effortlessly cool presence"]),
  result(PASS1_DESC, "no_real_person", 1, "Names a public figure as a lookalike.", ["looks a bit like Ryan Gosling"]),
  result(PASS1_DESC, "no_brand_name", 1, "Names a brand.", ["Nike"]),
  result(PASS1_DESC, "drawable_only", 1, "Mood and judgement words no model can draw.", [
    "confident", "striking", "effortlessly cool",
  ]),
  result(
    PASS1_DESC,
    "no_cross_slot",
    1,
    "Camera and lighting instruction inside the character block.",
    ["dramatic side lighting", "shallow depth of field"],
    [{ checkId: "no_cross_slot", quote: "shot on a 35mm lens", reason: "not_found" }],
  ),
];

const pass1Replacements: ReplacementView[] = [
  { spanId: "age_build-0", checkId: "age_build", oldText: "young man", newText: "man in his late twenties, lean and tall", rationale: "Adds the bracket and the build the check requires." },
  { spanId: "no_brand_name-0", checkId: "no_brand_name", oldText: "Nike", newText: "plain grey", rationale: "Removes the brand name without changing the garment." },
  { spanId: "no_real_person-0", checkId: "no_real_person", oldText: "looks a bit like Ryan Gosling", newText: "has a broad, square jaw and pale grey eyes", rationale: "Replaces the lookalike framing with drawable features." },
];

const PASS2_DESC = PASS1_DESC
  .replace("young man", "man in his late twenties, lean and tall")
  .replace("Nike", "plain grey")
  .replace("looks a bit like Ryan Gosling", "has a broad, square jaw and pale grey eyes");

const pass1: PassView = {
  pass: 1,
  description: PASS1_DESC,
  results: pass1Results,
  failing: failingOf(pass1Results),
  replacements: pass1Replacements,
  repairedDescription: PASS2_DESC,
};

const pass2Results: CheckResultView[] = [
  result(PASS2_DESC, "age_build", 4, "Now gives a decade bracket and a build.", ["man in his late twenties, lean and tall"]),
  result(PASS2_DESC, "face_skin", 1, "No face or skin detail beyond a judgement.", ["striking features"]),
  result(PASS2_DESC, "hair_spec", 1, "Hair is still unspecified.", ["effortlessly cool presence"]),
  result(PASS2_DESC, "wardrobe", 2, "One garment, still no footwear.", ["a plain grey hoodie"]),
  result(PASS2_DESC, "anchor_marker", 1, "No reusable identity anchor yet.", ["effortlessly cool presence"]),
  result(PASS2_DESC, "no_real_person", 4, "Lookalike framing removed; features stand alone.", ["has a broad, square jaw and pale grey eyes"]),
  result(PASS2_DESC, "no_brand_name", 5, "No brand name present.", ["plain grey"]),
  result(PASS2_DESC, "drawable_only", 1, "Mood and judgement words persist.", ["confident", "striking", "effortlessly cool presence"]),
  result(PASS2_DESC, "no_cross_slot", 1, "Camera and lighting instruction remains inside the character block.", ["dramatic side lighting", "shallow depth of field"]),
];

const pass2Replacements: ReplacementView[] = [
  { spanId: "hair_spec-0", checkId: "hair_spec", oldText: "effortlessly cool presence", newText: "effortlessly cool presence, with short black hair cropped close at the sides", rationale: "Adds a concrete hair spec at the nearest anchor." },
  { spanId: "wardrobe-0", checkId: "wardrobe", oldText: "a plain grey hoodie", newText: "a plain grey hoodie, dark jeans, and white sneakers", rationale: "Adds bottoms and footwear to complete the wardrobe." },
];

const PASS3_DESC = PASS2_DESC
  .replace("a plain grey hoodie", "a plain grey hoodie, dark jeans, and white sneakers")
  .replace("effortlessly cool presence", "effortlessly cool presence, with short black hair cropped close at the sides");

const pass2: PassView = {
  pass: 2,
  description: PASS2_DESC,
  results: pass2Results,
  failing: failingOf(pass2Results),
  replacements: pass2Replacements,
  repairedDescription: PASS3_DESC,
};

const pass3Results: CheckResultView[] = [
  result(PASS3_DESC, "age_build", 4, "Still gives a decade bracket and a build.", ["man in his late twenties, lean and tall"]),
  result(PASS3_DESC, "face_skin", 1, "No face or skin detail beyond a judgement.", ["striking features"]),
  result(PASS3_DESC, "hair_spec", 4, "Colour, length and style now given.", ["short black hair cropped close at the sides"]),
  result(PASS3_DESC, "wardrobe", 4, "Top, bottoms and footwear now specified.", ["dark jeans, and white sneakers"]),
  result(PASS3_DESC, "anchor_marker", 1, "Still no reusable identity anchor.", ["effortlessly cool presence"]),
  result(PASS3_DESC, "no_real_person", 4, "Lookalike framing removed; features stand alone.", ["has a broad, square jaw and pale grey eyes"]),
  result(PASS3_DESC, "no_brand_name", 5, "No brand name present.", ["plain grey"]),
  result(PASS3_DESC, "drawable_only", 1, "Mood and judgement words persist.", ["confident", "striking", "effortlessly cool presence"]),
  result(PASS3_DESC, "no_cross_slot", 1, "Camera and lighting instruction remains inside the character block.", ["dramatic side lighting", "shallow depth of field"]),
];

const pass3Replacements: ReplacementView[] = [
  { spanId: "face_skin-0", checkId: "face_skin", oldText: "striking features", newText: "striking features, with sun-weathered olive skin and a faint sunspot on the left cheek", rationale: "Adds skin tone, texture and a visible mark." },
  { spanId: "anchor_marker-0", checkId: "anchor_marker", oldText: "effortlessly cool presence", newText: "effortlessly cool presence and a faded anchor tattoo on the right forearm", rationale: "Adds a reusable, drawable identity anchor." },
];

const PASS4_DESC = PASS3_DESC
  .replace("striking features", "striking features, with sun-weathered olive skin and a faint sunspot on the left cheek")
  .replace("effortlessly cool presence", "effortlessly cool presence and a faded anchor tattoo on the right forearm");

const pass3: PassView = {
  pass: 3,
  description: PASS3_DESC,
  results: pass3Results,
  failing: failingOf(pass3Results),
  replacements: pass3Replacements,
  repairedDescription: PASS4_DESC,
};

const improvedStillFailingRun: RunView = {
  runId: "run-improved-002",
  rubricVersion: "1.0.0",
  model: "gpt-5.1",
  status: "improved_still_failing",
  startedAt: "2026-09-03T11:00:00.000Z",
  finishedAt: "2026-09-03T11:01:30.000Z",
  originalDescription: WEAK,
  finalDescription: PASS4_DESC,
  passes: [pass1, pass2, pass3],
  cost: scaleCost(COST, 12),
};

// ---------------------------------------------------------------------------
// noImprovement: two passes, failing set is identical both times, and the
// second pass's repair attempt is empty because the first attempt didn't help.
// ---------------------------------------------------------------------------

const STUCK1 = [
  "Female, Black, mid-40s, average build, medium height.",
  "Smooth dark skin, defined cheekbones, a small scar above the left brow.",
  "Natural black coily hair in a high bun.",
  "An Adidas tracksuit jacket over a graphic tee, straight-leg trousers, white sneakers.",
  "A vivid, mysterious aura that draws the eye.",
].join(" ");

const stuckPass1Results: CheckResultView[] = [
  result(STUCK1, "age_build", 5, "Gives sex, ethnicity, decade, build and height together.", []),
  result(STUCK1, "face_skin", 5, "Skin tone, texture and a distinguishing mark all present.", []),
  result(STUCK1, "hair_spec", 5, "Colour, texture and style all given.", []),
  result(STUCK1, "wardrobe", 4, "Top, layering, bottoms and footwear all specified.", []),
  result(STUCK1, "anchor_marker", 4, "A reusable, non-generic identity anchor is present.", []),
  result(STUCK1, "no_real_person", 5, "No public figure or lookalike framing.", []),
  result(STUCK1, "no_brand_name", 1, "Names a brand.", ["Adidas"]),
  result(STUCK1, "drawable_only", 2, "Aura and mystery are not drawable attributes.", ["vivid, mysterious aura that draws the eye"]),
  result(STUCK1, "no_cross_slot", 5, "No camera or lighting instruction present.", []),
];

const stuckPass1Replacements: ReplacementView[] = [
  { spanId: "no_brand_name-0", checkId: "no_brand_name", oldText: "Adidas", newText: "Puma", rationale: "Replaces the flagged brand name." },
  { spanId: "drawable_only-0", checkId: "drawable_only", oldText: "vivid, mysterious aura that draws the eye", newText: "a magnetic, striking presence", rationale: "Replaces subjective wording with a more concrete phrase." },
];

const STUCK2 = STUCK1
  .replace("Adidas", "Puma")
  .replace("vivid, mysterious aura that draws the eye", "a magnetic, striking presence");

const noImprovementPass1: PassView = {
  pass: 1,
  description: STUCK1,
  results: stuckPass1Results,
  failing: failingOf(stuckPass1Results),
  replacements: stuckPass1Replacements,
  repairedDescription: STUCK2,
};

const stuckPass2Results: CheckResultView[] = [
  result(STUCK2, "age_build", 5, "Gives sex, ethnicity, decade, build and height together.", []),
  result(STUCK2, "face_skin", 5, "Skin tone, texture and a distinguishing mark all present.", []),
  result(STUCK2, "hair_spec", 5, "Colour, texture and style all given.", []),
  result(STUCK2, "wardrobe", 4, "Top, layering, bottoms and footwear all specified.", []),
  result(STUCK2, "anchor_marker", 4, "A reusable, non-generic identity anchor is present.", []),
  result(STUCK2, "no_real_person", 5, "No public figure or lookalike framing.", []),
  result(STUCK2, "no_brand_name", 1, "Replaced one brand with another; still names a brand.", ["Puma"]),
  result(STUCK2, "drawable_only", 2, "Still relies on subjective judgement words rather than visible attributes.", ["a magnetic, striking presence"]),
  result(STUCK2, "no_cross_slot", 5, "No camera or lighting instruction present.", []),
];

const noImprovementPass2: PassView = {
  pass: 2,
  description: STUCK2,
  results: stuckPass2Results,
  failing: failingOf(stuckPass2Results),
  replacements: [],
};

const noImprovementRun: RunView = {
  runId: "run-noimprovement-003",
  rubricVersion: "1.0.0",
  model: "gpt-5.1",
  status: "no_improvement",
  startedAt: "2026-09-05T09:00:00.000Z",
  finishedAt: "2026-09-05T09:00:52.000Z",
  originalDescription: STUCK1,
  finalDescription: STUCK2,
  passes: [noImprovementPass1, noImprovementPass2],
  cost: scaleCost(COST, 8),
};

// ---------------------------------------------------------------------------
// failed: safety and drawable finished before the look group's call errored.
// The one partial pass carries scored results for the two completed groups
// and not_evaluated entries — one per check id — for the group that never
// finished. All nine check ids still appear; none is silently dropped.
// ---------------------------------------------------------------------------

const FAILED_DESC = "A woman with an interesting vibe and a mysterious energy that draws people in.";

const LOOK_FAILURE_REASON = 'Evaluator group "look" failed: upstream model call returned 503 after 2 retries.';

const failedPassResults: CheckResultView[] = [
  notEvaluated("age_build", LOOK_FAILURE_REASON),
  notEvaluated("face_skin", LOOK_FAILURE_REASON),
  notEvaluated("hair_spec", LOOK_FAILURE_REASON),
  notEvaluated("wardrobe", LOOK_FAILURE_REASON),
  notEvaluated("anchor_marker", LOOK_FAILURE_REASON),
  result(FAILED_DESC, "no_real_person", 5, "No public figure or lookalike framing.", []),
  result(FAILED_DESC, "no_brand_name", 5, "No brand name present.", []),
  result(FAILED_DESC, "drawable_only", 2, "Mood words describe a feeling, not a visible attribute.", [
    "interesting vibe", "mysterious energy that draws people in",
  ]),
  result(FAILED_DESC, "no_cross_slot", 5, "No camera or lighting instruction present.", []),
];

const failedPass: PassView = {
  pass: 1,
  description: FAILED_DESC,
  results: failedPassResults,
  failing: failingOf(failedPassResults),
  replacements: [],
};

const failedRun: RunView = {
  runId: "run-failed-004",
  rubricVersion: "1.0.0",
  model: "gpt-5.1",
  status: "failed",
  startedAt: "2026-09-07T14:00:00.000Z",
  finishedAt: "2026-09-07T14:00:06.000Z",
  originalDescription: FAILED_DESC,
  finalDescription: FAILED_DESC,
  passes: [failedPass],
  cost: scaleCost(COST, 2),
  error: LOOK_FAILURE_REASON,
};

// ---------------------------------------------------------------------------
// Fixture export
// ---------------------------------------------------------------------------

export const FIXTURE_RUNS: Record<"passed" | "improvedStillFailing" | "noImprovement" | "failed", RunView> = {
  passed: passedRun,
  improvedStillFailing: improvedStillFailingRun,
  noImprovement: noImprovementRun,
  failed: failedRun,
};

// ---------------------------------------------------------------------------
// Event log: the full RunEvent[] for improvedStillFailing, wall-clock order.
// The three groups of each pass are interleaved (both non-look groups start
// before look's own completion lands) so the UI's out-of-order arrival is
// exercised, not just its happy path.
// ---------------------------------------------------------------------------

let clock = Date.parse("2026-09-03T11:00:00.000Z");
function tick(seconds = 3): string {
  clock += seconds * 1000;
  return new Date(clock).toISOString();
}

function runStarted(step: number, at: string, payload: { runId: string; rubricVersion: string; model: string; description: string }): RunEvent {
  return { id: eventId(0, step), name: "run.started", at, ...payload };
}

function passStarted(pass: number, step: number, at: string, description: string): RunEvent {
  return { id: eventId(pass, step), name: "pass.started", at, pass, description };
}

function groupStarted(pass: number, step: number, at: string, group: CheckGroup): RunEvent {
  return { id: eventId(pass, step), name: "evaluator.group.started", at, pass, group };
}

/**
 * A live `evaluator.group.completed` always carries empty `spans`/`unverified` (see the contract's
 * own doc comment on that event): verification is pass-wide and cannot have run yet at group-settle
 * time. This fixture's `pass.results` already carries the pass's fully-verified spans -- that's what
 * `pass.completed` gets, unchanged -- so a group's slice of it is stripped back down to what a real
 * group-settle event would actually contain before it's used here. Without this, the fixture would
 * be more generous than the wire and every screen built against it would look right in every replay
 * and quietly lie about a real run.
 */
function stripSpans(results: CheckResultView[]): CheckResultView[] {
  return results.map((r) => (r.status === "scored" ? { ...r, spans: [], unverified: [] } : r));
}

function groupCompleted(
  pass: number,
  step: number,
  at: string,
  group: CheckGroup,
  results: CheckResultView[],
  cost: StepCost,
): RunEvent {
  return {
    id: eventId(pass, step),
    name: "evaluator.group.completed",
    at,
    pass,
    group,
    results: stripSpans(results),
    cost,
  };
}

function repairerStarted(pass: number, step: number, at: string, spanIds: string[]): RunEvent {
  return { id: eventId(pass, step), name: "repairer.started", at, pass, spanIds };
}

function repairerCompleted(pass: number, step: number, at: string, replacements: ReplacementView[], cost: StepCost): RunEvent {
  return { id: eventId(pass, step), name: "repairer.completed", at, pass, replacements, cost };
}

function passCompleted(
  pass: number,
  step: number,
  at: string,
  repairedDescription: string | undefined,
  failing: CheckId[],
  results: CheckResultView[],
): RunEvent {
  return { id: eventId(pass, step), name: "pass.completed", at, pass, repairedDescription, failing, results };
}

function runCompleted(step: number, at: string, status: RunStatus, run: RunView): RunEvent {
  return { id: eventId(0, step), name: "run.completed", at, status, run };
}

function eventsForPass(pass: PassView): RunEvent[] {
  const look = pass.results.filter((r) => r.group === "look");
  const safety = pass.results.filter((r) => r.group === "safety");
  const drawable = pass.results.filter((r) => r.group === "drawable");
  const spanIds = pass.replacements.map((r) => r.spanId);
  return [
    passStarted(pass.pass, 0, tick(), pass.description),
    groupStarted(pass.pass, 1, tick(), "look"),
    groupStarted(pass.pass, 2, tick(), "safety"),
    groupCompleted(pass.pass, 3, tick(), "look", look, COST),
    groupStarted(pass.pass, 4, tick(), "drawable"),
    groupCompleted(pass.pass, 5, tick(), "safety", safety, COST),
    groupCompleted(pass.pass, 6, tick(), "drawable", drawable, COST),
    repairerStarted(pass.pass, 7, tick(), spanIds),
    repairerCompleted(pass.pass, 8, tick(), pass.replacements, COST),
    passCompleted(pass.pass, 9, tick(), pass.repairedDescription, pass.failing, pass.results),
  ];
}

function buildEventLog(run: RunView): RunEvent[] {
  const events: RunEvent[] = [
    runStarted(0, tick(), {
      runId: run.runId,
      rubricVersion: run.rubricVersion,
      model: run.model,
      description: run.originalDescription,
    }),
  ];
  for (const pass of run.passes) events.push(...eventsForPass(pass));
  events.push(runCompleted(1, tick(), run.status, run));
  return events;
}

export const FIXTURE_EVENT_LOG: RunEvent[] = buildEventLog(improvedStillFailingRun);
