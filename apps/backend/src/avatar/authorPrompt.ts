import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Mentic's `authorActorPrompt` (`lib/ugc-lab/generate-actor.ts`), reproduced.
 *
 * This is the step between the guided form and the image: the form's fields go in, and
 * a model rewrites them into the identity paragraph that the sheet layout wraps. Mentic
 * runs it once per variation, each call independent, which is how four candidates from
 * one description end up as four different people.
 *
 * Reproducing it matters for the diagnosis. There are three places a description can
 * lose a check, and they need telling apart: the form can fail to ask for something,
 * this authoring step can drop it, or the describe step can fail to read it back off the
 * rendered sheet. Skipping this step would silently fold the first two together.
 */
const DOCTRINE_PATH = fileURLToPath(new URL("./doctrine/mentic-actor-image.md", import.meta.url));

/** Mentic's `MENTIC_UGC_TEXT_MODEL ?? "claude-sonnet-5"`. Not this repo's Opus: see
 *  `../describe/prompt.ts` for why a reproduction runs on the model it reproduces. */
export const MENTIC_TEXT_MODEL = "claude-sonnet-5";

export type TextTransport = (args: {
  system: string;
  user: string;
  model: string;
}) => Promise<{ text: string }>;

export function createAnthropicTextTransport(): TextTransport {
  return async ({ system, user, model }) => {
    const client = new Anthropic();
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { text };
  };
}

export async function loadMenticActorDoctrine(): Promise<string> {
  return readFile(DOCTRINE_PATH, "utf8");
}

/**
 * Description in, authored identity paragraph out.
 *
 * `variationHint` is Mentic's own second argument. Four candidates are four calls with
 * four different hints, which is why the same description does not produce the same
 * person twice.
 */
export async function authorActorPrompt(
  transport: TextTransport,
  args: { description: string; variationHint?: string; model?: string },
): Promise<string> {
  const doctrine = await loadMenticActorDoctrine();
  const { text } = await transport({
    system: doctrine,
    user: [`ACTOR DESCRIPTION\n${args.description}`, args.variationHint]
      .filter(Boolean)
      .join("\n\n"),
    model: args.model ?? MENTIC_TEXT_MODEL,
  });
  return text.trim();
}
