import {
  LENGTH_TOLERANCE_SECONDS,
  MAX_REFERENCE_IMAGES,
  SHOT_WEIGHT_SECONDS,
  plannedSeconds,
  type Camera,
  type CheckOutcome,
  type CheckOwner,
  type DirectorCheckId,
  type Plan,
} from "@ai-director/contract";

const HANDLE = /@[a-z0-9_]+/gi;
const TIMESTAMP =
  /\b\d+(\.\d+)?\s*(s|sec|secs|seconds)\b|\(\s*\d+\s*[–-]\s*\d+\s*s\s*\)|\b\d{1,2}:\d{2}\b/i;
const LIGHT_DIRECTION = /\b(left|right|behind|above|overhead|below|front|side|backlit|from the window)\b/i;

function outcome(
  id: DirectorCheckId,
  owner: CheckOwner,
  failure: { detail: string; shots?: number[] } | null,
  passingDetail: string | null = null,
): CheckOutcome {
  if (failure === null) return { id, passed: true, owner, detail: passingDetail, shots: [] };
  return { id, passed: false, owner, detail: failure.detail, shots: failure.shots ?? [] };
}

function handlesIn(text: string): string[] {
  return (text.match(HANDLE) ?? []).map((handle) => handle.toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lengthFits(plan: Plan, seconds: number): CheckOutcome {
  const sum = plan.shots.map((shot) => SHOT_WEIGHT_SECONDS[shot.weight]).join(" + ");
  const detail = `${sum} = ${plannedSeconds(plan)} s, you chose ${seconds} s`;
  const fits = Math.abs(plannedSeconds(plan) - seconds) <= LENGTH_TOLERANCE_SECONDS;
  return outcome("length_fits", "director", fits ? null : { detail }, detail);
}

function handlesMatch(plan: Plan): CheckOutcome {
  const declared = new Set(plan.assets.map((asset) => asset.handle.toLowerCase()));
  const problems: string[] = [];
  const shots: number[] = [];

  const undeclaredInScene = [...new Set(handlesIn(plan.scene))].filter((h) => !declared.has(h));
  if (undeclaredInScene.length > 0) problems.push(`scene uses undeclared ${undeclaredInScene.join(", ")}`);

  plan.shots.forEach((shot, index) => {
    const undeclared = [...new Set(handlesIn(shot.action))].filter((h) => !declared.has(h));
    if (undeclared.length === 0) return;
    shots.push(index + 1);
    problems.push(`shot ${index + 1} uses undeclared ${undeclared.join(", ")}`);
  });

  const used = new Set([plan.scene, ...plan.shots.map((shot) => shot.action)].flatMap(handlesIn));
  const unused = plan.assets
    .filter((asset) => asset.kind !== "character" && !used.has(asset.handle.toLowerCase()))
    .map((asset) => asset.handle);
  if (unused.length > 0) problems.push(`never used: ${unused.join(", ")}`);

  return outcome("handles_match", "director", problems.length === 0 ? null : { detail: problems.join("; "), shots });
}

function referencesWithinCap(plan: Plan): CheckOutcome {
  const referenced = plan.assets.filter((asset) => asset.kind === "product" || asset.kind === "location");
  const problems: string[] = [];
  if (referenced.length > MAX_REFERENCE_IMAGES) {
    problems.push(`${referenced.length} reference assets, the cap is ${MAX_REFERENCE_IMAGES}`);
  }
  const undescribed = referenced.filter((asset) => asset.description.trim() === "").map((asset) => asset.handle);
  if (undescribed.length > 0) problems.push(`no description for ${undescribed.join(", ")}`);
  return outcome("references_within_cap", "director", problems.length === 0 ? null : { detail: problems.join("; ") });
}

function noTimestamps(plan: Plan): CheckOutcome {
  const shots = plan.shots.flatMap((shot, index) =>
    TIMESTAMP.test(shot.action) || TIMESTAMP.test(shot.sound) ? [index + 1] : [],
  );
  return outcome(
    "no_timestamps",
    "director",
    shots.length === 0 ? null : { detail: `timestamps or seconds in shot ${shots.join(", ")}`, shots },
  );
}

function nothingRuledOut(plan: Plan, mustNotAppear: string[]): CheckOutcome {
  const terms = mustNotAppear.map((term) => term.trim()).filter((term) => term !== "");
  const matcher = (term: string) =>
    new RegExp(`(?<![a-z0-9_])${escapeRegExp(term)}(?![a-z0-9_])`, "i");
  const found = new Set<string>();
  const shots: number[] = [];

  const planWide = [plan.styleLine, plan.scene, ...plan.assets.map((asset) => asset.description)];
  for (const term of terms) {
    if (planWide.some((text) => matcher(term).test(text))) found.add(term);
  }
  plan.shots.forEach((shot, index) => {
    const hits = terms.filter((term) => matcher(term).test(`${shot.action}\n${shot.sound}`));
    if (hits.length === 0) return;
    shots.push(index + 1);
    hits.forEach((term) => found.add(term));
  });

  return outcome(
    "nothing_ruled_out",
    "director",
    found.size === 0 ? null : { detail: `ruled out but present: ${[...found].join(", ")}`, shots },
  );
}

export function runPlanChecks(plan: Plan, seconds: number, mustNotAppear: string[]): CheckOutcome[] {
  return [
    lengthFits(plan, seconds),
    handlesMatch(plan),
    referencesWithinCap(plan),
    noTimestamps(plan),
    nothingRuledOut(plan, mustNotAppear),
  ];
}

function cameraPerShot(plan: Plan, cameras: Camera[]): CheckOutcome {
  const counts = new Map<number, number>();
  for (const camera of cameras) counts.set(camera.shot, (counts.get(camera.shot) ?? 0) + 1);
  const wanted = new Set(plan.shots.map((_, index) => index + 1));
  const bad = new Set<number>();
  for (const number of wanted) if (counts.get(number) !== 1) bad.add(number);
  for (const number of counts.keys()) if (!wanted.has(number)) bad.add(number);
  const shots = [...bad].sort((a, b) => a - b);
  return outcome(
    "camera_per_shot",
    "cinematographer",
    shots.length === 0
      ? null
      : { detail: `${cameras.length} cameras for ${plan.shots.length} shots; check shot ${shots.join(", ")}`, shots },
  );
}

function lightHasDirection(cameras: Camera[]): CheckOutcome {
  const shots = cameras
    .filter((camera) => !LIGHT_DIRECTION.test(camera.light))
    .map((camera) => camera.shot)
    .sort((a, b) => a - b);
  return outcome(
    "light_has_direction",
    "cinematographer",
    shots.length === 0 ? null : { detail: `light names no direction in shot ${shots.join(", ")}`, shots },
  );
}

export function runPromptChecks(plan: Plan, cameras: Camera[]): CheckOutcome[] {
  return [cameraPerShot(plan, cameras), lightHasDirection(cameras)];
}
