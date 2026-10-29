import { describe, expect, it, vi } from "vitest";
import {
  buildInterrogatorAskSystemPrompt,
  buildInterrogatorFillSystemPrompt,
  renderAskRequest,
  type AvatarChoice,
} from "../../../src/agents/interrogator/prompt-v2.js";
import {
  MAX_QUESTIONS,
  askQuestions,
  fillBrief,
  validateFill,
  validateQuestions,
} from "../../../src/agents/interrogator/runV2.js";
import { InterrogatorFillSchema, InterrogatorQuestionsSchema } from "../../../src/agents/interrogator/schema.js";
import type { ScrapeResult } from "../../../src/lab/scrape.js";
import { LabError } from "../../../src/lab/runStore.js";
import type { LabQuestion } from "../../../src/lab/types.js";

const BRIEF = "an ad for our headphones";
const AVATARS: AvatarChoice[] = [{ avatarId: "eaa18108", description: "A young man in his mid-twenties with wavy brown hair." }];
const SCRAPE: ScrapeResult = {
  url: "https://example.com/aurora",
  finalUrl: "https://example.com/aurora",
  ok: true,
  error: null,
  title: "Aurora Headphones | Northwind Audio",
  description: "Wireless over-ear headphones.",
  ogTitle: null,
  ogDescription: null,
  headings: ["Aurora Headphones"],
  text: "Sand-coloured fabric with brushed aluminium arms.",
  fetchedAt: "2026-10-29T12:00:00Z",
};

const question = (overrides: Partial<LabQuestion> = {}): LabQuestion => ({
  id: "q1",
  topic: "location",
  question: "Where should the ad happen?",
  ifYouDecide: "A small city apartment at dawn",
  ...overrides,
});

function fillOutput(overrides: Record<string, unknown> = {}) {
  return {
    productKind: "wireless over-ear headphones",
    product: "over-ear headphones in sand-coloured fabric with brushed aluminium arms",
    audience: "commuters in their twenties",
    tone: "calm, quietly confident",
    setting: "a small city apartment at dawn",
    character: "a man in his late twenties who works nights",
    seconds: 15,
    mustNotAppear: ["cats"],
    avatarId: null,
    ...overrides,
  };
}

describe("askQuestions", () => {
  it("sends the ask prompt with the brief, the scrape and the avatars, and returns the questions", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: { questions: [question()] } });
    const questions = await askQuestions({ transport }, { brief: BRIEF, scrape: SCRAPE, avatars: AVATARS });

    expect(questions).toEqual([question()]);
    const call = transport.mock.calls[0]![0] as { system: string; user: string; schema: unknown };
    expect(call.system).toBe(buildInterrogatorAskSystemPrompt());
    expect(call.schema).toBe(InterrogatorQuestionsSchema);
    expect(call.user).toContain(BRIEF);
    expect(call.user).toContain("Aurora Headphones | Northwind Audio");
    expect(call.user).toContain("eaa18108");
  });
});

describe("validateQuestions", () => {
  it("accepts no questions at all", () => {
    expect(validateQuestions({ questions: [] })).toEqual([]);
  });

  it("refuses a duplicate id", () => {
    expect(() => validateQuestions({ questions: [question(), question({ topic: "length" })] })).toThrow(LabError);
  });

  it(`refuses more than ${MAX_QUESTIONS} questions`, () => {
    const many = Array.from({ length: 7 }, (_, i) => question({ id: `q${i}`, topic: "other" }));
    expect(() => validateQuestions({ questions: many })).toThrow(/at most 6/);
  });

  it("refuses the same topic twice, except other", () => {
    expect(() =>
      validateQuestions({ questions: [question({ topic: "length" }), question({ id: "q2", topic: "length" })] }),
    ).toThrow(/length/);
    expect(
      validateQuestions({ questions: [question({ topic: "other" }), question({ id: "q2", topic: "other" })] }),
    ).toHaveLength(2);
  });

  it("refuses a question with no choice for 'you decide'", () => {
    expect(() => validateQuestions({ questions: [question({ ifYouDecide: " " })] })).toThrow(LabError);
  });
});

describe("renderAskRequest", () => {
  it("says when no website was given", () => {
    expect(renderAskRequest({ brief: BRIEF, scrape: null, avatars: [] })).toContain("No website was given.");
  });

  it("says why a website could not be read", () => {
    const failed = { ...SCRAPE, ok: false, error: "HTTP 403", text: "", title: null };
    expect(renderAskRequest({ brief: BRIEF, scrape: failed, avatars: [] })).toContain("HTTP 403");
  });
});

describe("fillBrief and validateFill", () => {
  const args = { brief: BRIEF, scrape: SCRAPE, avatars: AVATARS, questions: [question()], answers: { answers: [{ id: "q1", answer: "you decide" }] } };

  it("sends the fill prompt and keeps the caller's brief, never the model's", async () => {
    const transport = vi.fn().mockResolvedValue({ parsed_output: { ...fillOutput(), brief: "something else" } });
    const filled = await fillBrief({ transport }, args);
    const call = transport.mock.calls[0]![0] as { system: string; schema: unknown };
    expect(call.system).toBe(buildInterrogatorFillSystemPrompt());
    expect(call.schema).toBe(InterrogatorFillSchema);
    expect(filled.brief).toBe(BRIEF);
    expect(filled.seconds).toBe(15);
    expect(filled.suggestedSeconds).toBe(15);
    expect(filled.avatar).toBeNull();
  });

  it("refuses a length Seedance cannot render", () => {
    expect(() => validateFill(fillOutput({ seconds: 45 }), { brief: BRIEF, avatars: AVATARS })).toThrow(/4-30/);
  });

  it("refuses a blank product", () => {
    expect(() => validateFill(fillOutput({ product: " " }), { brief: BRIEF, avatars: AVATARS })).toThrow(/product/);
  });

  it("refuses an avatar that is not saved", () => {
    expect(() => validateFill(fillOutput({ avatarId: "nope" }), { brief: BRIEF, avatars: AVATARS })).toThrow(/unknown avatar nope/);
  });

  it("carries a saved avatar's description byte-identical", () => {
    const filled = validateFill(fillOutput({ avatarId: "eaa18108" }), { brief: BRIEF, avatars: AVATARS });
    expect(filled.avatar).toEqual(AVATARS[0]);
  });
});

describe("the v2 prompts", () => {
  it("let the owner say 'you decide' and cap the questions at 6", () => {
    const ask = buildInterrogatorAskSystemPrompt();
    expect(ask).toContain("you decide");
    expect(ask).toContain("6");
  });

  it("keep v1's brand rule when filling", () => {
    expect(buildInterrogatorFillSystemPrompt()).toContain("No brand names, logos, slogans or trademarks");
  });
});
