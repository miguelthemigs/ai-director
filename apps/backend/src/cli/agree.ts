import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { createAnthropicTransport } from "../api/client.js";
import { isPass } from "../enforce/score.js";
import { loadRubric } from "../rubric/load.js";
import { buildAgreementReport, type GoldItem } from "../agreement/report.js";

const GOLD_SET_PATH = "data/agreement/gold-set.json";

export async function main(): Promise<number> {
  // Read the key at call time, not at import time -- see api/client.ts and
  // cli/score.ts for the same guard, and the same reasoning: importing this
  // module without a key set must never throw, and a missing key must fail
  // with a message before any file or network I/O, not a stack trace.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Export it before running the agreement study, e.g.:\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...",
    );
    return 1;
  }

  const rubric = await loadRubric("v1");
  const gold = JSON.parse(await readFile(GOLD_SET_PATH, "utf8")) as { items: GoldItem[] };

  if (gold.items.length === 0) {
    console.error(
      `${GOLD_SET_PATH} has no items. It ships as a frozen skeleton -- fill it with 30 to ` +
        "50 hand-marked items (marked blind to any agent output) before running the study.",
    );
    return 1;
  }

  const transport = createAnthropicTransport();

  const agentMarks: Record<string, Record<string, boolean>> = {};
  for (const item of gold.items) {
    const results = await evaluateAllGroups({ transport }, { rubric, description: item.description });
    // A check whose group failed to evaluate comes back as `not_evaluated`
    // (no band at all -- see EvaluatedCheck in agents/evaluator/run.ts). That
    // is not the same as a fail, so it must not be coerced into `isPass`
    // returning false for it: it is left out of this item's marks entirely,
    // and buildAgreementReport skips any check pair with a missing mark
    // rather than inventing one.
    agentMarks[item.id] = Object.fromEntries(
      results.filter((result) => result.status === "scored").map((result) => [result.checkId, isPass(result.band)]),
    );
    console.log(`scored ${item.id}`);
  }

  const report = buildAgreementReport(
    gold.items,
    agentMarks,
    rubric.checks.map((check) => check.id),
    rubric.version,
  );

  await mkdir("data/agreement", { recursive: true });
  await writeFile(
    `data/agreement/results-${rubric.version}.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), report, agentMarks }, null, 2),
    "utf8",
  );

  console.log(`\noverall kappa: ${report.overall.kappa.toFixed(3)} (n=${report.overall.n})`);
  for (const checkId of rubric.checks.map((check) => check.id)) {
    const result = report.perCheck[checkId];
    if (!result) {
      console.log(`  ${checkId}: unmeasured (no marked pairs)`);
      continue;
    }
    console.log(`  ${checkId}: kappa ${result.kappa.toFixed(3)}, observed ${(result.observed * 100).toFixed(0)}%`);
  }
  console.log(`\ndisagreements: ${report.disagreements.length}`);
  for (const d of report.disagreements) {
    console.log(`  ${d.itemId} ${d.checkId}: human ${d.human ? "pass" : "fail"}, agent ${d.agent ? "pass" : "fail"}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`agree: unexpected error: ${message}`);
      process.exit(1);
    });
}
