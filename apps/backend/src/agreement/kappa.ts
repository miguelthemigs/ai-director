export type KappaResult = {
  kappa: number;
  observed: number;
  expected: number;
  n: number;
  table: {
    bothPass: number;
    bothFail: number;
    humanPassAgentFail: number;
    humanFailAgentPass: number;
  };
};

/**
 * Cohen's kappa: (observed - expected) / (1 - expected), where `expected` is
 * computed from each rater's own marginal pass rate -- not from the sample's
 * overall pass rate -- because that is what "agreement beyond chance"
 * requires: how often the two raters would agree if each kept their own
 * pass rate but marked independently at random.
 *
 * Degenerate case: when both raters pass (or both fail) every single item,
 * `expected` is 1 and the formula divides by zero. That happens precisely
 * when there is no variance to measure agreement over -- observed is also 1
 * in that case, since the raters agree on everything -- so kappa is defined
 * here as 1 rather than left as NaN or thrown. This is a deliberate choice,
 * not a fallback: a small gold set where one check passes for every item
 * will hit this, and reporting kappa 1 for total, informationless agreement
 * is more transparent than crashing or lying with NaN -- the observed/n in
 * the same result is what actually says there was no variance to measure.
 */
export function cohensKappa(pairs: Array<{ human: boolean; agent: boolean }>): KappaResult {
  const n = pairs.length;
  if (n === 0) throw new Error("no pairs to compare");

  let bothPass = 0;
  let bothFail = 0;
  let humanPassAgentFail = 0;
  let humanFailAgentPass = 0;
  for (const { human, agent } of pairs) {
    if (human && agent) bothPass += 1;
    else if (!human && !agent) bothFail += 1;
    else if (human && !agent) humanPassAgentFail += 1;
    else humanFailAgentPass += 1;
  }

  const observed = (bothPass + bothFail) / n;
  const humanPassRate = (bothPass + humanPassAgentFail) / n;
  const agentPassRate = (bothPass + humanFailAgentPass) / n;
  const expected = humanPassRate * agentPassRate + (1 - humanPassRate) * (1 - agentPassRate);
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);

  return {
    kappa,
    observed,
    expected,
    n,
    table: { bothPass, bothFail, humanPassAgentFail, humanFailAgentPass },
  };
}
