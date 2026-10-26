/**
 * INTERROGATOR PROMPT v1 — turns a one-line brief into a filled brief.
 *
 * Append-only (CLAUDE.md): a change ships as `prompt-v2.ts`.
 *
 * ── What it decides, and what it leaves to the owner ───────────────────────────
 * FR-5: the Interrogator asks only what is the owner's to decide. In this build those
 * questions are fixed fields at Gate A (the product photo, the product kind, the
 * length, what must not appear, the cast), so the model never asks anything: it
 * decides every craft question itself (audience, tone, setting, character) and never
 * leaves one blank for someone else to fill.
 *
 * ── productKind is a kind, never a look (the Mentic rule) ──────────────────────
 * The owner's photo carries what the product looks like. Words about its colour,
 * finish or label are how a label gets rewritten downstream (Mentic,
 * `lib/ugc-lab/generate-product-sheet.ts`), so the kind is the only product fact
 * this prompt lets out.
 *
 * The 4-30 range is literal text, not `MIN/MAX_VIDEO_SECONDS` read at run time, so a
 * contract change cannot silently rewrite v1; a test compares the two.
 */
export const INTERROGATOR_PROMPT_VERSION = "v1";

export function buildInterrogatorSystemPrompt(): string {
  return [
    "You read a one-line brief for a short cinematic video ad and fill in everything it leaves out.",
    "The ad is one video, generated in one take, with one product, one place and one person in it.",
    "",
    "You decide. Never ask a question, never offer options, never write \"unknown\", \"to be decided\" or \"depends\". Where the brief is silent, choose what makes the strongest ad for this product and commit to it. The owner reviews your choices and can change them.",
    "",
    "Return these fields:",
    "- productKind: what kind of thing the product is, in a few plain words, as you would name it to a shop assistant: \"wireless over-ear headphones\", \"a glass jar of face cream\", \"a trail running shoe\". Never what it looks like: no colour, finish, material description, size, pattern, label, lettering or logo. The owner's photo shows the look; your words must never compete with it.",
    "- audience: who the ad is for, in one line: their age range and the situation in their life where the product matters.",
    "- tone: how the ad should feel, in a few words: \"calm, quietly confident\", \"playful and fast\".",
    "- setting: the one place where the whole ad happens, and the time of day: \"a small city apartment at dawn\". One place only; the ad is one take and does not travel.",
    "- character: the one person in the ad, in one line: their age range, who they are and why the product matters to them right now. A fictional person, never a real or famous one.",
    `- suggestedSeconds: the length of the ad in whole seconds, only if the brief itself names one between 4 and 30. Otherwise null: the length is the owner's to choose, not yours.`,
    "",
    "Rules:",
    "1. No brand names, logos, slogans or trademarks in any field, not even the product's own brand if the brief names it. Name the kind of thing instead.",
    "2. Everything you write must be something a camera can show or a person can recognise on screen. No marketing claims.",
    "3. Write in English, whatever language the brief is in.",
  ].join("\n");
}

export function renderInterrogatorRequest(brief: string): string {
  return `The brief:\n\n${brief}`;
}
