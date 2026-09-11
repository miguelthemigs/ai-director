/**
 * `negative_constraint_present` — one of the two invariants spec §3 calls out
 * as "checked by code, not by a model, because code compares strings exactly."
 * It follows Higgsfield's "Continuity: Characters, props, environment
 * identical across every cut. No identity drift." It is reported as a boolean
 * alongside the nine rubric checks; it is never scored as a band.
 *
 * Kept deliberately dumb: a regex that tried to match paraphrases of this line
 * would just be model-judgement wearing a disguise, which is exactly what
 * this invariant exists to avoid. Patterns are literal phrase fragments,
 * tested against a whitespace- and case-normalised description.
 */
export const NEGATIVE_CONSTRAINT_PATTERNS: RegExp[] = [
  /no identity drift/,
  /identical across every cut/,
];

export function hasNegativeConstraint(description: string): boolean {
  const normalized = description.toLowerCase().replace(/\s+/g, " ").trim();
  return NEGATIVE_CONSTRAINT_PATTERNS.some((pattern) => pattern.test(normalized));
}
