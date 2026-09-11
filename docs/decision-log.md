# Decision log

## 2026-09-10 — Pre-registered failure condition for the character rubric

Written before the first agreement run, so it cannot be adjusted to fit the result.

The approach counts as failed if any of these hold:

1. Overall Cohen's kappa against the frozen gold set is below 0.40 for rubric v1 and does not
   reach 0.60 by v3.
2. Repaired descriptions score higher on the rubric while a later render comparison shows no
   reduction in identity drift or refusal rate.
3. More than a quarter of sub-threshold checks return quotes that cannot be verified verbatim,
   because then the defect list is not usable evidence.

If any of these holds, it gets reported as a null result rather than reframed.

## 2026-09-10 — Rubric narrowed from twelve stage items to nine character checks

The published twelve-item rubric scores a stage prompt. v1 of this agent scores only the character
description, so nine checks in three groups. Three components Higgsfield names that the twelve miss
(acting layer, skin-texture detail, negative constraints) are recorded for the stage rubric later.

## 2026-09-11 — Inferred latency dropped from the Architecture screen

The `verify`, `splice` and `gate` nodes report no latency. State, progress and a note still render
for all three — inferring sequence from the events that bracket a step is sound. Duration is not:
those three steps emit no wire events of their own, so any number shown would be attributed by
bracketing rather than measured.

This was checked, not assumed. Between `evaluator.group.completed` and `repairer.started` the
orchestrator can run a full `retryVerbatim` model call on any pass with an unverified quote — a real,
tested path — and that call is itself as expensive as an evaluator group call. A bracketed Verify
latency would silently absorb an entire evaluator re-ask it did not perform, on the one screen whose
stated purpose is that its numbers are real. Absent is more honest than a number that could be wrong
by seconds.

The correct fix is real wire events for those three steps, which was deliberately not taken in v1:
spec §6 enumerates exactly nine event names that the contract and its tests encode, so adding more is
a spec change, not a bug fix. Recorded here as a v2 candidate.

## 2026-09-11 — `no_brand_name` band 3 rewritten before any run referenced the rubric

The original band 3 read: "a brand is strongly implied by a distinctive logo description." The
check's own pass test and title are about *naming* a brand, not about visual implication — two
different axes stacked on one ladder, sitting at the 3/4 boundary that decides every pass/fail
verdict for this check. Spec §3 is the binding authority and defines the check as "no brand or
franchise name anywhere in the description," so the naming axis wins. Band 3 was rewritten to a
milder naming failure: a trademarked product-line, model, or franchise-specific proper noun without
the parent brand or franchise name itself ("Air Max", "the Batmobile").

The rubric is append-only once a run references it; no run had, so the rewrite is a version-zero
edit rather than a v2 change. The unnamed-logo case is real and belongs on a different check, and is
recorded here as a candidate for a rubric v2 check rather than a dropped concern.

## 2026-09-11 — Cross-provider bias check built; not run (no live calls made)

Task 23 built the second self-preference mitigation spec §4 names — making the Evaluator model a
config value so the same descriptions can be scored by an independent-lineage model, not just a
different Claude. `createOpenAiTransport` (`apps/backend/src/api/openaiTransport.ts`) satisfies the
existing `ParseTransport` interface from Task 6 unmodified — no widening was needed. `compareProviders`
(`apps/backend/src/cli/bias.ts`) scores each description through both transports and compares the
pass/fail decision per check (`isPass(band)`, not the raw ordinal band), reusing `cohensKappa` (Task
22) rather than a second agreement statistic. A check pair is excluded, not counted as agreement, when
either provider's group failed to evaluate; a check with zero comparable pairs is left out of the
per-check report as unmeasured, never reported as kappa 0.

No comparison has been run: this session made no calls to either the Anthropic or the OpenAI API (owner
instruction — both keys exist in `.env` but were never read). The `bias` CLI is gated on
`RUN_LIVE_API=1` in addition to requiring both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, exactly as the
live tests under `tests/live/` are gated, specifically so it cannot run by accident. There is therefore
no model pair, description count, or agreement number to record yet — recording one would be exactly
the kind of invented number this log has twice already had to correct. The owner runs
`RUN_LIVE_API=1 npx tsx apps/backend/src/cli/bias.ts -- <file-of-descriptions>` (default OpenAI side:
`gpt-5.1`) and this entry gets a follow-up with whatever the two providers actually show. If they
disagree substantially, that is the result to report, not a prompt to go tune away — tuning the
evaluator prompt until they agree would destroy the control.

## 2026-09-11 — What is measured and what is not

No API calls were made in this session (owner instruction). This section separates two different
risks: things that are **unmeasured** — the machinery exists, gated and tested, and running it is
what closes the gap — from the one thing in the failure condition above that is **unbuildable** in
v1: no command closes it, because the thing it needs does not exist in this project.

**Unmeasured** — the following are built but not yet verified against a real model, each listed with
what would close it:

- **Whether `zodOutputFormat` is runtime-compatible with `client.beta.messages.parse`.** Verified so
  far only by `tsc` against the SDK's type declarations. A live smoke test exists in
  `apps/backend/tests/live/`, gated behind `RUN_LIVE_API=1`. Closing this needs one run of that test
  with a real key.
- **Whether a real failing run reads as a failure end to end.** One real passing run was observed
  before the no-spend rule took effect. The failing path — a description that should score below
  threshold and trigger repair and a failed exit code — has only been exercised against fixtures
  built to have the same event shapes as a live run, never against an actual model response. Closing
  this needs a live run against a description known to fail at least one check.
- **The cross-provider bias check against OpenAI.** Not run (see the dated entry below for what was
  built). Closing this needs
  `RUN_LIVE_API=1 npx tsx apps/backend/src/cli/bias.ts -- <file-of-descriptions>` executed with both
  keys live.
- **The agreement study itself.** No kappa exists because no hand-marked gold set exists yet; that
  set can only be produced by the owner, marking each description blind to the agent's output. Both
  `kappa` and `perCheckKappa` in `data/versions/notes.json` stay `null` until that happens.

**Unbuildable in v1** — this is not a fifth item on the list above; it is a different kind of gap:

- **Failure condition clause 2** ("repaired descriptions score higher on the rubric while a later
  render comparison shows no reduction in identity drift or refusal rate") cannot currently be
  evaluated by anything in this repository. Evaluating it needs a render comparison: actually
  rendering the character descriptions through Seedance on Runway, across rubric versions, with a
  measured identity-drift or refusal-rate metric on the output video. None of that — the rendering
  step, the drift metric, the refusal metric — exists here, and building it is out of scope for v1,
  which stops at scoring and repairing text. It is not waiting on a command the way the four items
  above are; it is waiting on a different piece of research.

The clause stays in the failure condition above rather than being dropped or softened — it is the
right scientific commitment, and removing it would trade honesty for a cleaner-looking document. But
until it can be evaluated, **the approach is not fully tested**: conditions 1 and 3 passing is not the
same as the whole pre-registered condition passing, and a reader should not infer the latter from the
former.

An assessor should read this section as the boundary of what has actually been checked, not as a set
of caveats to discount.
