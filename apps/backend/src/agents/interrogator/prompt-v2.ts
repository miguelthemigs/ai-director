import type { ScrapeResult } from "../../lab/scrape.js";
import type { LabAnswers, LabQuestion } from "../../lab/types.js";

/**
 * INTERROGATOR PROMPT v2 — the architecture lab's Interrogator. Two calls instead of one.
 *
 * Append-only (CLAUDE.md): v1 is untouched and still serves the Director app.
 *
 * ── Why v2 asks, when v1 never did ──────────────────────────────────────────────
 * v1 never asked a question because Gate A asked the owner's questions as fixed fields
 * (the product photo, the length, what must not appear, the cast). The lab has no Gate A
 * and no photo: the owner gives a brief and maybe a website, and the Interrogator asks
 * only about what those leave open. Every question names the choice it makes on
 * "you decide", so the owner can be as vague as they like.
 *
 * ── Why the product may now be described ───────────────────────────────────────
 * v1 kept the product to its kind, because the owner's photo carried the look. With no
 * photo, words are all Seedance gets, so `product` says what a camera sees: shape,
 * materials, colours, from the website. Brand names, logos and label text stay out, as in
 * v1 rule 1.
 */
export const INTERROGATOR_PROMPT_VERSION_V2 = "v2";

export type AvatarChoice = { avatarId: string; description: string };

const SHARED_RULES = [
  "Rules:",
  "1. No brand names, logos, slogans or trademarks in any field, not even the product's own brand if the brief or the website names it. Name the kind of thing instead.",
  "2. Everything you write must be something a camera can show or a person can recognise on screen. No marketing claims.",
  "3. Write in English, whatever language the brief or the website is in.",
];

export function buildInterrogatorAskSystemPrompt(): string {
  return [
    "You prepare a short cinematic video ad: one product, one place, one person, one take of 4 to 30 seconds.",
    "You get the owner's brief, the text of their website if they gave one, and the people they have already saved.",
    "",
    "Ask the owner only about what the brief and the website leave open and only they can decide: which website, what exactly the product is, where the ad happens, who is in it, how long it is, and what must not appear. Never ask about craft (the audience, the tone, the shots, the camera): that is decided later, without them.",
    "",
    "The owner can answer any question with \"you decide\". So every question carries ifYouDecide: the concrete choice you will make if they do, written as the answer itself (\"A small city apartment at dawn\", \"15 seconds\", \"A new person: a woman in her thirties who runs before work\").",
    "",
    "Return questions, at most 6, each with:",
    "- id: q1, q2, ... in order.",
    "- topic: one of website, product, location, avatar, length, mustNotAppear, other. Each topic at most once, except other.",
    "- question: one short plain sentence.",
    "- ifYouDecide: your choice, as above.",
    "",
    "When to ask:",
    "- website: only when no website was given or it could not be read. Suggest the most likely official site in ifYouDecide.",
    "- product: only when it is unclear which product the ad is for.",
    "- avatar: offer the saved people by id, or a new person; ifYouDecide names one.",
    "- Anything the brief or the website already answers: do not ask. A detailed brief may need no questions at all; then return an empty list.",
    "",
    ...SHARED_RULES,
  ].join("\n");
}

export function buildInterrogatorFillSystemPrompt(): string {
  return [
    "You read a brief for a short cinematic video ad, the owner's website text, and their answers to your questions, and fill in everything the ad needs.",
    "The ad is one video, generated in one take, with one product, one place and one person in it.",
    "",
    "You decide. Never ask a question, never offer options, never write \"unknown\", \"to be decided\" or \"depends\". Where the owner answered, use their answer. Where they answered \"you decide\", use the choice you named for that question. Where nobody said, choose what makes the strongest ad for this product and commit to it.",
    "",
    "Return these fields:",
    "- productKind: what kind of thing the product is, in a few plain words: \"wireless over-ear headphones\".",
    "- product: what the product is and what a camera sees of it, in one or two sentences: its shape, materials and colours, from the website and the answers. Never a brand name, logo, lettering or label text.",
    "- audience: who the ad is for, in one line: their age range and the situation in their life where the product matters.",
    "- tone: how the ad should feel, in a few words.",
    "- setting: the one place where the whole ad happens, and the time of day. One place only; the ad does not travel.",
    "- character: the one person in the ad, in one line: their age range, who they are and why the product matters to them right now. A fictional person, never a real or famous one.",
    "- seconds: the length in whole seconds, between 4 and 30.",
    "- mustNotAppear: things the owner said must not appear, as short plain terms; an empty list if none.",
    "- avatarId: the id of the saved person the owner chose (or you chose for them), or null for a new person.",
    "",
    ...SHARED_RULES,
  ].join("\n");
}

function renderScrape(scrape: ScrapeResult | null): string[] {
  if (scrape === null) return ["No website was given."];
  if (!scrape.ok) return [`The website ${scrape.url} could not be read: ${scrape.error ?? "no reason given"}.`];
  const lines = [`The website (${scrape.finalUrl ?? scrape.url}):`];
  if (scrape.title) lines.push(`- Title: ${scrape.title}`);
  if (scrape.description) lines.push(`- Description: ${scrape.description}`);
  if (scrape.ogTitle) lines.push(`- Share title: ${scrape.ogTitle}`);
  if (scrape.ogDescription) lines.push(`- Share description: ${scrape.ogDescription}`);
  if (scrape.headings.length > 0) lines.push(`- Headings: ${scrape.headings.join(" / ")}`);
  lines.push(scrape.text === "" ? "- The page had no readable text." : `- Page text: ${scrape.text}`);
  return lines;
}

function renderAvatars(avatars: AvatarChoice[]): string[] {
  if (avatars.length === 0) return ["Saved people: none. The person will be new."];
  return ["Saved people:", ...avatars.map((avatar) => `- ${avatar.avatarId}: ${avatar.description}`)];
}

export function renderAskRequest(args: { brief: string; scrape: ScrapeResult | null; avatars: AvatarChoice[] }): string {
  return [`The brief:\n\n${args.brief}`, "", ...renderScrape(args.scrape), "", ...renderAvatars(args.avatars)].join("\n");
}

export function renderFillRequest(args: {
  brief: string;
  scrape: ScrapeResult | null;
  avatars: AvatarChoice[];
  questions: LabQuestion[];
  answers: LabAnswers;
}): string {
  const answered = args.questions.map((question) => {
    const answer = args.answers.answers.find((a) => a.id === question.id)?.answer ?? "you decide";
    return `- ${question.question}\n  Answer: ${answer}\n  (Your choice on "you decide": ${question.ifYouDecide})`;
  });
  return [
    renderAskRequest(args),
    "",
    answered.length > 0 ? "Your questions and the owner's answers:" : "You asked no questions.",
    ...answered,
  ].join("\n");
}
