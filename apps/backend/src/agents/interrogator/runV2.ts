import { isValidVideoSeconds } from "@ai-director/contract";
import type { ParseTransport } from "../../api/client.js";
import { LabError } from "../../lab/runStore.js";
import type { LabBrief, LabQuestion } from "../../lab/types.js";
import {
  buildInterrogatorAskSystemPrompt,
  buildInterrogatorFillSystemPrompt,
  renderAskRequest,
  renderFillRequest,
  type AvatarChoice,
} from "./prompt-v2.js";
import { InterrogatorFillSchema, InterrogatorQuestionsSchema } from "./schema.js";

export const MAX_QUESTIONS = 6;

const DECIDED_FIELDS = ["productKind", "product", "audience", "tone", "setting", "character"] as const;

/** Why a schema refused a value, in one line an agent can act on. */
function schemaError(what: string, issues: Array<{ path: PropertyKey[]; message: string }>): LabError {
  const first = issues[0];
  const where = first && first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
  return new LabError(`${what} does not match the schema${where}: ${first?.message ?? "invalid"}`);
}

/**
 * The questions as the lab accepts them: ids unique and non-blank, every question and its
 * "you decide" choice written, at most `MAX_QUESTIONS`, each topic once except `other`.
 * No questions at all is valid: a detailed brief may leave nothing open.
 */
export function validateQuestions(raw: unknown): LabQuestion[] {
  const parsed = InterrogatorQuestionsSchema.safeParse(raw);
  if (!parsed.success) throw schemaError("the questions", parsed.error.issues);
  const questions = parsed.data.questions;

  if (questions.length > MAX_QUESTIONS) throw new LabError(`${questions.length} questions, at most ${MAX_QUESTIONS}`);
  const ids = new Set<string>();
  const topics = new Set<string>();
  for (const question of questions) {
    if (question.id.trim() === "") throw new LabError("a question has a blank id");
    if (ids.has(question.id)) throw new LabError(`question id ${question.id} is used twice`);
    ids.add(question.id);
    if (question.question.trim() === "") throw new LabError(`question ${question.id} is blank`);
    if (question.ifYouDecide.trim() === "") throw new LabError(`question ${question.id} has no choice for "you decide"`);
    if (question.topic !== "other" && topics.has(question.topic)) {
      throw new LabError(`topic ${question.topic} is asked twice`);
    }
    topics.add(question.topic);
  }
  return questions;
}

/**
 * The filled brief as the lab accepts it. `brief` is the caller's text, never the model's;
 * a saved avatar's description is carried byte-identical from the store, never retyped.
 */
export function validateFill(raw: unknown, args: { brief: string; avatars: AvatarChoice[] }): LabBrief {
  const parsed = InterrogatorFillSchema.safeParse(raw);
  if (!parsed.success) throw schemaError("the brief", parsed.error.issues);
  const output = parsed.data;

  for (const field of DECIDED_FIELDS) {
    if (output[field].trim() === "") throw new LabError(`the brief left ${field} blank`);
  }
  if (!isValidVideoSeconds(output.seconds)) throw new LabError(`seconds must be 4-30, got ${output.seconds}`);

  let avatar: LabBrief["avatar"] = null;
  if (output.avatarId !== null) {
    const found = args.avatars.find((choice) => choice.avatarId === output.avatarId);
    if (!found) throw new LabError(`unknown avatar ${output.avatarId}`);
    avatar = { avatarId: found.avatarId, description: found.description };
  }

  return {
    brief: args.brief,
    productKind: output.productKind,
    audience: output.audience,
    tone: output.tone,
    setting: output.setting,
    character: output.character,
    suggestedSeconds: output.seconds,
    product: output.product,
    seconds: output.seconds,
    mustNotAppear: output.mustNotAppear.map((term) => term.trim()).filter((term) => term !== ""),
    avatar,
  };
}

/** One call: the brief, the website and the saved people in; the questions out. */
export async function askQuestions(
  deps: { transport: ParseTransport },
  args: Parameters<typeof renderAskRequest>[0],
): Promise<LabQuestion[]> {
  const { parsed_output } = await deps.transport({
    system: buildInterrogatorAskSystemPrompt(),
    user: renderAskRequest(args),
    schema: InterrogatorQuestionsSchema,
  });
  if (parsed_output === null || parsed_output === undefined) throw new Error("interrogator parse failed");
  return validateQuestions(parsed_output);
}

/** One call: everything above plus the owner's answers in; the filled brief out. */
export async function fillBrief(
  deps: { transport: ParseTransport },
  args: Parameters<typeof renderFillRequest>[0],
): Promise<LabBrief> {
  const { parsed_output } = await deps.transport({
    system: buildInterrogatorFillSystemPrompt(),
    user: renderFillRequest(args),
    schema: InterrogatorFillSchema,
  });
  if (parsed_output === null || parsed_output === undefined) throw new Error("interrogator parse failed");
  return validateFill(parsed_output, { brief: args.brief, avatars: args.avatars });
}
