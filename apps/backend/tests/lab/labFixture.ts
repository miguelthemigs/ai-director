import type { LabBrief } from "../../src/lab/types.js";

/** A filled lab brief for a 15-second headphones ad, a new person cast. */
export function labBrief(overrides: Partial<LabBrief> = {}): LabBrief {
  return {
    brief: "an ad for our headphones",
    productKind: "wireless over-ear headphones",
    product: "over-ear headphones in sand-coloured fabric with brushed aluminium arms",
    audience: "commuters in their twenties",
    tone: "calm, quietly confident",
    setting: "a small city apartment at dawn",
    character: "a man in his late twenties who works nights",
    suggestedSeconds: 15,
    seconds: 15,
    mustNotAppear: ["cats"],
    avatar: null,
    ...overrides,
  };
}
