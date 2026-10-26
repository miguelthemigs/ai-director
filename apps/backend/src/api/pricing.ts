// Rates are micro-USD (1e-6 USD). $5 per million tokens is 5 micro-USD per token.

export const MICRO_USD_PER_INPUT_TOKEN: Record<string, number> = {
  // checked 2026-10-26, https://platform.claude.com/docs/en/about-claude/pricing ($5 / MTok)
  "claude-opus-5": 5,
  // checked 2026-10-26, same page ($2 / MTok); the served fallback model, so its calls are priced too
  "claude-sonnet-5": 2,
};

export const MICRO_USD_PER_OUTPUT_TOKEN: Record<string, number> = {
  // checked 2026-10-26, https://platform.claude.com/docs/en/about-claude/pricing ($25 / MTok)
  "claude-opus-5": 25,
  // checked 2026-10-26, same page ($10 / MTok)
  "claude-sonnet-5": 10,
};

export const MICRO_USD_PER_IMAGE: Record<string, number> = {
  // checked 2026-10-26, https://ai.google.dev/gemini-api/docs/pricing ($0.134 per 1K/2K image)
  "gemini-3-pro-image": 134_000,
};

/** Cost of one text call in micro-USD, or null when the model has no recorded rate (never 0). */
export function tokenMicroUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const input = MICRO_USD_PER_INPUT_TOKEN[model];
  const output = MICRO_USD_PER_OUTPUT_TOKEN[model];
  if (input === undefined || output === undefined) return null;
  return usage.inputTokens * input + usage.outputTokens * output;
}
