import { cohensKappa, type KappaResult } from "./kappa.js";

export type GoldItem = { id: string; description: string; marks: Record<string, boolean> };

export type AgreementReport = {
  rubricVersion: string;
  perCheck: Record<string, KappaResult>;
  overall: KappaResult;
  disagreements: Array<{ itemId: string; checkId: string; human: boolean; agent: boolean }>;
};

/**
 * `agentMarks` must have an entry for every item -- a missing item means the
 * agent was never run on it at all, which is a study-setup error and throws
 * rather than silently excluding the item. A missing checkId *within* an
 * item's marks (human or agent) is different: that check was genuinely not
 * evaluated for that item (e.g. its group failed -- see `EvaluatedCheck`'s
 * `not_evaluated` status), so the pair is skipped rather than fabricated
 * into a boolean. A check with zero such pairs across the whole gold set is
 * left out of `perCheck` entirely (see the CLI, which reports it as
 * "unmeasured") rather than reported with an invented kappa of 0.
 */
export function buildAgreementReport(
  items: GoldItem[],
  agentMarks: Record<string, Record<string, boolean>>,
  checkIds: string[],
  rubricVersion = "v1",
): AgreementReport {
  const all: Array<{ human: boolean; agent: boolean }> = [];
  const perCheck: Record<string, KappaResult> = {};
  const disagreements: AgreementReport["disagreements"] = [];

  for (const checkId of checkIds) {
    const pairs: Array<{ human: boolean; agent: boolean }> = [];
    for (const item of items) {
      const agentItem = agentMarks[item.id];
      if (!agentItem) throw new Error(`no agent marks for ${item.id}`);
      const human = item.marks[checkId];
      const agent = agentItem[checkId];
      if (human === undefined || agent === undefined) continue;
      pairs.push({ human, agent });
      all.push({ human, agent });
      if (human !== agent) disagreements.push({ itemId: item.id, checkId, human, agent });
    }
    if (pairs.length > 0) perCheck[checkId] = cohensKappa(pairs);
  }

  return { rubricVersion, perCheck, overall: cohensKappa(all), disagreements };
}
