/**
 * Which Repairer prompt repaired a given run.
 *
 * Kept in its own file rather than beside either prompt, because `prompt.ts` is
 * append-only (CLAUDE.md) and adding an export to it to describe a version that
 * postdates it would be an edit to a sealed file. A shared vocabulary both
 * versions can name, and neither owns.
 *
 * ── Why v1 is still reachable ───────────────────────────────────────────────
 * v1 is the prompt that produced the evidence in `docs/repairer-cannot-see.md`:
 * six fabricated details across two passes of run `bee3bcd6`. Deleting it would
 * make that finding unreproducible, which is the one thing a finding must not
 * be. It is the default precisely so every stored run keeps meaning what it
 * meant when it was written.
 */
export const REPAIRER_PROMPT_VERSIONS = ["v1", "v2"] as const;

export type RepairerPromptVersion = (typeof REPAIRER_PROMPT_VERSIONS)[number];

/** What a run that never recorded a version was repaired by. Every run written
 *  before 16 September 2026 predates the column, and all of them were v1, so this
 *  is a fact about history rather than a guess. */
export const DEFAULT_REPAIRER_PROMPT_VERSION: RepairerPromptVersion = "v1";
