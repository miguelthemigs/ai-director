import type { CheckId } from "@ai-director/contract";

/**
 * The guided avatar form, ported from Mentic's own (`lib/ugc-lab/actor-suggestions.ts`,
 * read 2026-09-12).
 *
 * ── What this assembles, and what it does NOT ───────────────────────────────────────
 * Mentic has two different paragraphs in play and they are easy to confuse. One is the
 * brief that CREATES the avatar: it goes to Nano Banana, renders a character reference
 * sheet, and is never seen again. The other is `UgcActor.description`: the paragraph
 * spliced into every render prompt, which is how the person reaches the VIDEO model,
 * because seedance2 refuses a human likeness in any input image. The second one is the
 * artefact this product exists to grade, and it is the one this form assembles.
 *
 * That is why `assembleDescription` below emits PROSE rather than the `Eyes: …` /
 * `Hair: …` label block Mentic's own assembler produces. Mentic's label block is an
 * image brief; the shape that reaches the video model is the one
 * `DESCRIBE_ACTOR_SYSTEM` asks its vision model for, a noun phrase that can start a
 * sentence:
 *
 *   "A man in his late twenties, lean and about 1.80m, with short dark hair and
 *    stubble, in a plain grey t-shirt, black jeans and white trainers"
 *
 * Every suggestion value below is Mentic's, verbatim. They are not examples of what a
 * user might type, they ARE what a user picks, and they travel into the prompt
 * unchanged, so any of them being weak against a check is a finding about Mentic
 * rather than about this form.
 *
 * ── Two fields here have no counterpart in Mentic ───────────────────────────────────
 * `faceSkin` and `anchorMarker` are marked `notInMentic`. They exist because the rubric
 * has nine checks and Mentic's form can only reach seven of them: nothing in it asks
 * for a second concrete face feature (`face_skin` band 4) or for a small reusable
 * marker (`anchor_marker` band 4, "two moles on the left cheek"). A form that cannot
 * produce a passing description would make every score a measurement of the form.
 * Whether those two fields earn their place in Mentic is exactly what the agreement
 * study is for, so they are flagged rather than quietly blended in.
 */

export interface AvatarField {
  key: string;
  label: string;
  /** The rubric checks this field feeds. Shown beside the field: the form is a coach,
   *  so a user should be able to see which score a blank field is costing them. */
  checks: readonly CheckId[];
  suggestions: readonly string[] | ((values: AvatarFieldValues) => readonly string[]);
  visibleWhen?: (values: AvatarFieldValues) => boolean;
  /** Renders full width with no suggestions menu. Rerolling leaves it alone: there is
   *  nothing sensible to roll for "anything else", and clobbering a note the user typed
   *  by hand would be worse than leaving it out of the reroll. */
  freeText?: boolean;
  /** No equivalent field exists in Mentic today. Surfaced in the UI, not hidden. */
  notInMentic?: boolean;
}

export type AvatarFieldValues = Partial<Record<string, string>>;

const WOMAN_HAIR = [
  "shoulder-length light brown air-dried waves, tucked behind one ear",
  "dark brown high ponytail, a few loose strands",
  "blonde bob, slightly messy",
  "black curly hair, natural texture",
] as const;

const MAN_HAIR = [
  "short textured crop, natural, slightly messy",
  "buzz cut, clean and low",
  "medium-length wavy hair, side part",
  "short curly hair, natural texture, fade on the sides",
] as const;

export const AVATAR_FIELDS: readonly AvatarField[] = [
  {
    key: "gender",
    label: "Gender",
    checks: [],
    suggestions: ["woman", "man"],
  },
  {
    key: "age",
    label: "Age",
    checks: ["age_build"],
    suggestions: ["22", "24", "26", "29", "32", "35"],
  },
  {
    key: "ethnicity",
    label: "Ethnicity",
    checks: ["face_skin"],
    suggestions: [
      "white American",
      "Black American",
      "Latina American",
      "East Asian American",
      "South Asian American",
      "Middle Eastern American",
      "mixed race American",
    ],
  },
  {
    // Mentic's own comment on this field: height is here because the character sheet
    // finally SHOWS one. On the old head-and-shoulders portrait "about 1.85m" was an
    // instruction the image could not express and the model was free to ignore.
    key: "buildNote",
    label: "Build and height",
    checks: ["age_build"],
    suggestions: [
      "average build, average height",
      "tall and lean, about 1.85m",
      "petite, about 1.60m",
      "curvy, average height",
      "athletic and broad, about 1.80m",
      "soft round face, average build",
      "angular face, lean build",
    ],
  },
  {
    key: "eyeColor",
    label: "Eyes",
    checks: ["face_skin"],
    suggestions: ["dark brown", "light brown", "hazel", "green", "blue", "grey blue", "amber"],
  },
  {
    // `face_skin` band 4 wants TWO concrete features a render can be checked against.
    // `ethnicity` and `eyeColor` give one between them, so on Mentic's field set alone
    // this check tops out at band 3 no matter what the user picks.
    key: "faceSkin",
    label: "Face and skin",
    checks: ["face_skin"],
    notInMentic: true,
    suggestions: [
      "freckles across the nose and cheeks",
      "a square jaw and a small scar through one eyebrow",
      "high cheekbones, clear skin with visible pores",
      "a strong straight nose and a cleft chin",
      "soft round cheeks and a dimple on the left side",
      "weathered skin and deep smile lines",
    ],
  },
  {
    key: "hair",
    label: "Hair",
    checks: ["hair_spec"],
    suggestions: (values) => {
      const gender = values.gender?.trim().toLowerCase();
      if (gender === "man") return MAN_HAIR;
      if (gender === "woman") return WOMAN_HAIR;
      // Gender not chosen yet: a blended default, rather than silently picking one
      // gender's styles for everybody.
      return [...WOMAN_HAIR.slice(0, 2), ...MAN_HAIR.slice(0, 2)];
    },
  },
  {
    // Head to toe, because the sheet's back view shows trousers and shoes. Mentic's
    // comment: a top-only value leaves the bottom half to the model, which invents a
    // different one in every variation. Every value ends `no logos`, which is what
    // keeps `no_brand_name` passing at the pool level rather than by luck.
    key: "wardrobe",
    label: "Wardrobe, head to toe",
    checks: ["wardrobe", "no_brand_name"],
    suggestions: [
      "oversized grey hoodie, black jeans, white trainers, thin gold necklace, no logos",
      "plain white t-shirt, blue jeans, white sneakers, small hoop earrings, no logos",
      "cream knit sweater, beige wide-leg trousers, tan loafers, no jewelry, no logos",
      "denim jacket over a tank top, black leggings, chunky white trainers, no logos",
      "fitted black long-sleeve, dark straight-leg jeans, black boots, no logos",
      "linen shirt, khaki chinos, canvas sneakers, no logos",
    ],
  },
  {
    // The gap the rubric mapping made obvious. `anchor_marker` band 4 wants one small
    // marker with a position or a count, so it can be checked shot to shot. Nothing in
    // Mentic's form asks for one; the only place a user could type it is the free-text
    // escape hatch, where nothing prompts them to.
    key: "anchorMarker",
    label: "Identity marker",
    checks: ["anchor_marker"],
    notInMentic: true,
    suggestions: [
      "two small moles on the left cheek",
      "a single gold hoop in the right ear only",
      "a thin silver ring on the right index finger",
      "a small scar above the left eyebrow",
      "a faded tattoo of three dots on the inside of the left wrist",
      "a chipped front tooth, upper left",
    ],
  },
  {
    key: "makeupLevel",
    label: "Makeup",
    checks: [],
    suggestions: ["mascara only", "no makeup", "light everyday makeup", "tinted lip balm only"],
    // Hidden while gender is unset rather than shown by default, exactly as Mentic has it.
    visibleWhen: (values) => values.gender?.trim().toLowerCase() === "woman",
  },
  {
    // Last in the list so it renders at the foot of the form, and last in the assembled
    // sentence. It is the escape hatch for anything the fields above cannot say.
    key: "extraNotes",
    label: "Anything else",
    checks: [],
    freeText: true,
    suggestions: [],
  },
];

/** Resolves a field's suggestion pool for the CURRENT form state. */
export function resolveSuggestions(
  field: AvatarField,
  values: AvatarFieldValues,
): readonly string[] {
  return typeof field.suggestions === "function" ? field.suggestions(values) : field.suggestions;
}

/** Whether a field should render at all for the CURRENT form state. */
export function isFieldVisible(field: AvatarField, values: AvatarFieldValues): boolean {
  return field.visibleWhen ? field.visibleWhen(values) : true;
}

/**
 * The fields the user filled in, as ONE prose noun phrase: the shape that reaches the
 * video model, not Mentic's `Eyes: …` label block (see this file's header).
 *
 * A blank field is simply omitted rather than emitted empty. It is not replaced by a
 * placeholder and nothing is invented to fill it: an omitted field is exactly what the
 * rubric is supposed to catch, and papering over it here would make the score a
 * measurement of this function instead of the description.
 */
export function assembleDescription(values: AvatarFieldValues): string {
  const get = (key: string): string => values[key]?.trim() ?? "";

  const age = get("age");
  const ethnicity = get("ethnicity");
  const gender = get("gender");
  const build = get("buildNote");
  const hair = get("hair");
  const eyes = get("eyeColor");
  const face = get("faceSkin");
  const wardrobe = get("wardrobe");
  const marker = get("anchorMarker");
  const makeup = get("makeupLevel");
  const notes = get("extraNotes");

  // "A 29-year-old Latina American woman" — the opening noun phrase. With nothing set at
  // all it degrades to "A person", which is precisely what an empty description renders
  // as in Mentic and is honest about being empty.
  const opening = [age ? `${age}-year-old` : "", ethnicity, gender || "person"]
    .filter(Boolean)
    .join(" ");

  // Clauses in reading order: build, then the face from the top down, then the outfit,
  // then the marker. Each is dropped whole when its field is blank, so the sentence never
  // contains a dangling "with" or a stray comma.
  const clauses: string[] = [];
  if (build) clauses.push(build);
  if (hair) clauses.push(`with ${hair}`);
  if (eyes) clauses.push(`${eyes} eyes`);
  if (face) clauses.push(face);
  if (makeup) clauses.push(makeup);
  if (wardrobe) clauses.push(`in ${wardrobe}`);
  if (marker) clauses.push(marker);

  const sentence = clauses.length > 0 ? `A ${opening}, ${clauses.join(", ")}` : `A ${opening}`;

  // Free text is its own sentence. Splicing it into the clause list would put whatever the
  // user typed behind a comma in the middle of a noun phrase, which reads as a fragment.
  return notes ? `${sentence}. ${notes}` : sentence;
}

/**
 * A fresh value for every field. "Surprise me" is a full reroll, not a one-time
 * fill-the-gaps: it must do something new on the fifth click on an already-full form.
 *
 * Order matters, and it is the field order above: `gender` is resolved before `hair`
 * (whose pool depends on it) and before `makeupLevel` (visible only for "woman"), so by
 * the time those are reached `next.gender` holds THIS pass's pick rather than a stale
 * value from the previous one.
 */
export function randomizeFields(current: AvatarFieldValues = {}): AvatarFieldValues {
  const next: AvatarFieldValues = {};
  for (const field of AVATAR_FIELDS) {
    if (field.freeText) {
      const kept = current[field.key];
      if (kept) next[field.key] = kept;
      continue;
    }
    if (!isFieldVisible(field, next)) continue;
    const pool = resolveSuggestions(field, next);
    if (pool.length === 0) continue;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick !== undefined) next[field.key] = pick;
  }
  return next;
}
