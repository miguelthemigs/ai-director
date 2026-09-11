import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { cohensKappa } from "../agreement/kappa.js";
import { createAnthropicTransport, DEFAULT_MODEL, type ParseTransport } from "../api/client.js";
import { createOpenAiTransport, DEFAULT_OPENAI_MODEL } from "../api/openaiTransport.js";
import { isPass } from "../enforce/score.js";
import { loadRubric, type Rubric } from "../rubric/load.js";

const OUTPUT_DIR = "data/agreement";

export type ProviderComparison = {
  perCheck: Record<string, { agree: number; disagree: number; excluded: number; kappa: number }>;
  overall: number;
  n: number;
  excluded: number;
};

/**
 * Runs the same descriptions through two transports and compares them on the
 * pass/fail DECISION per check (`isPass(band)`), never on the raw ordinal
 * band. The band is ordinal and ad hoc; the threshold is what the product
 * acts on, so two evaluators splitting between band 2 and band 3 agree on
 * everything that matters, while band 3 vs band 4 is a real disagreement.
 *
 * Reuses `cohensKappa` (Task 22) rather than a second agreement statistic --
 * two different "agreement" numbers in one project would invite exactly the
 * question this check exists to answer, not settle it.
 *
 * If EITHER transport's group failed to evaluate a given check for a given
 * description -- a transport reject or a null `parsed_output`, surfacing as
 * `EvaluatedCheck.status === "not_evaluated"` (see agents/evaluator/run.ts)
 * -- that description-check pair is excluded from the comparison and counted
 * in `excluded`, never folded into agreement. Silently treating a failed
 * call as agreement would bias the result toward the conclusion this check
 * exists to test.
 *
 * A check with zero comparable pairs across every description is left out
 * of `perCheck` entirely (same convention as `buildAgreementReport`, Task
 * 22) and reported by the CLI as "unmeasured" -- never fabricated as
 * agreement or a kappa of 0.
 *
 * IMPORTANT, read before touching the evaluator prompt because of a result
 * from this function: if the two providers disagree substantially, that is
 * the finding to report. Tuning the evaluator prompt until this number looks
 * better would destroy the control -- it would make the instrument measure
 * the tuning instead of the self-preference risk it exists to detect.
 */
export async function compareProviders(
  deps: { a: ParseTransport; b: ParseTransport },
  args: { rubric: Rubric; descriptions: string[] },
): Promise<ProviderComparison> {
  const checkIds = args.rubric.checks.map((check) => check.id);
  const pairsByCheck = new Map<string, Array<{ human: boolean; agent: boolean }>>(
    checkIds.map((id) => [id, []]),
  );
  const excludedByCheck = new Map<string, number>(checkIds.map((id) => [id, 0]));
  let excluded = 0;

  for (const description of args.descriptions) {
    const [resultsA, resultsB] = await Promise.all([
      evaluateAllGroups({ transport: deps.a }, { rubric: args.rubric, description }),
      evaluateAllGroups({ transport: deps.b }, { rubric: args.rubric, description }),
    ]);
    const byIdA = new Map(resultsA.map((result) => [result.checkId, result]));
    const byIdB = new Map(resultsB.map((result) => [result.checkId, result]));

    for (const id of checkIds) {
      const a = byIdA.get(id);
      const b = byIdB.get(id);
      if (!a || !b || a.status !== "scored" || b.status !== "scored") {
        excluded += 1;
        excludedByCheck.set(id, (excludedByCheck.get(id) ?? 0) + 1);
        continue;
      }
      // The two "raters" `cohensKappa` was written for a human and an agent
      // (Task 22's gold-set study); here both sides are agents, one per
      // provider. The field names are inherited, not literal -- `human` is
      // provider A's pass/fail, `agent` is provider B's.
      pairsByCheck.get(id)?.push({ human: isPass(a.band), agent: isPass(b.band) });
    }
  }

  const perCheck: ProviderComparison["perCheck"] = {};
  const allPairs: Array<{ human: boolean; agent: boolean }> = [];
  for (const id of checkIds) {
    const pairs = pairsByCheck.get(id) ?? [];
    if (pairs.length === 0) continue; // unmeasured -- never fabricated as agree/disagree/kappa
    const agree = pairs.filter((pair) => pair.human === pair.agent).length;
    perCheck[id] = {
      agree,
      disagree: pairs.length - agree,
      excluded: excludedByCheck.get(id) ?? 0,
      kappa: cohensKappa(pairs).kappa,
    };
    allPairs.push(...pairs);
  }

  // Same degenerate-input contract as buildAgreementReport (Task 22): if
  // literally nothing was comparable across the whole run, cohensKappa
  // throws rather than this function inventing an overall number.
  return { perCheck, overall: cohensKappa(allPairs).kappa, n: allPairs.length, excluded };
}

/**
 * Splits a text file into descriptions on blank lines, so one file can carry
 * several multi-line character descriptions (see data/samples/*.txt for the
 * shape of a single one). Blank/whitespace-only blocks are dropped rather
 * than counted as an empty description.
 */
export function parseDescriptions(raw: string): string[] {
  return raw
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export async function main(argv: string[]): Promise<number> {
  const file = argv[2];
  if (!file) {
    console.error(
      "usage: npx tsx apps/backend/src/cli/bias.ts -- <file-of-descriptions>\n" +
        "  <file-of-descriptions> is a text file with one character description per\n" +
        "  paragraph, separated by a blank line -- see data/samples/*.txt for the shape\n" +
        "  of a single description.",
    );
    return 1;
  }

  // This CLI is gated on RUN_LIVE_API=1 itself, not only its tests -- unlike
  // score.ts/agree.ts, which only check for an API key. It calls TWO paid
  // providers per description and exists to be run deliberately by the
  // project owner (spec §4's second self-preference mitigation), never
  // triggered incidentally. Same env var and same intent as the live tests
  // under tests/live/*.live.test.ts.
  if (process.env.RUN_LIVE_API !== "1") {
    console.error(
      "RUN_LIVE_API is not set to 1. This command makes real, billed calls to both " +
        "Anthropic and OpenAI for every description -- it refuses to run without an " +
        "explicit opt-in. Re-run as:\n" +
        "  RUN_LIVE_API=1 npx tsx apps/backend/src/cli/bias.ts -- <file-of-descriptions>",
    );
    return 1;
  }

  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
    console.error(
      "Both ANTHROPIC_API_KEY and OPENAI_API_KEY must be set before running the bias " +
        "check, e.g.:\n  export ANTHROPIC_API_KEY=sk-ant-...\n  export OPENAI_API_KEY=sk-...",
    );
    return 1;
  }

  const raw = await readFile(file, "utf8");
  const descriptions = parseDescriptions(raw);
  if (descriptions.length === 0) {
    console.error(`${file} has no descriptions in it (blank-line-separated paragraphs expected).`);
    return 1;
  }

  const rubric = await loadRubric("v1");
  const transportA = createAnthropicTransport();
  const transportB = createOpenAiTransport();

  const comparison = await compareProviders(
    { a: transportA, b: transportB },
    { rubric, descriptions },
  );

  await mkdir(OUTPUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = `${OUTPUT_DIR}/bias-${date}.json`;
  await writeFile(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        rubricVersion: rubric.version,
        providerA: { name: "anthropic", model: DEFAULT_MODEL },
        providerB: { name: "openai", model: DEFAULT_OPENAI_MODEL },
        descriptionCount: descriptions.length,
        comparison,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\ncross-provider bias check: ${DEFAULT_MODEL} (Anthropic) vs ${DEFAULT_OPENAI_MODEL} (OpenAI)`);
  console.log(
    `descriptions: ${descriptions.length}   comparable pairs (n): ${comparison.n}   excluded: ${comparison.excluded}`,
  );
  console.log(`overall kappa: ${comparison.overall.toFixed(3)}`);
  console.log("");
  for (const check of rubric.checks) {
    const result = comparison.perCheck[check.id];
    if (!result) {
      console.log(`  ${check.id}: unmeasured (no comparable pairs)`);
      continue;
    }
    const excludedNote = result.excluded > 0 ? `  excluded ${result.excluded}` : "";
    console.log(
      `  ${check.id}: kappa ${result.kappa.toFixed(3)}  agree ${result.agree}  disagree ${result.disagree}${excludedNote}`,
    );
  }
  console.log(
    "\nA low or negative kappa here is a finding about self-preference risk between the " +
      "Evaluator's model family and an independent one -- it is not a bug in the evaluator " +
      "prompt. Do not tune that prompt to raise this number: doing so would make this " +
      "instrument measure the tuning instead of the bias it exists to check. See spec §4 and " +
      "record the result, whatever it is, in docs/decision-log.md.",
  );
  console.log(`\nwrote ${outPath}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv)
    .then((code) => process.exit(code))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`bias: unexpected error: ${message}`);
      process.exit(1);
    });
}
