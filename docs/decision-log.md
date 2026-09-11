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

## 2026-09-11 — What is measured and what is not

No API calls were made in this session (owner instruction). The following are built but not yet
verified against a real model, and each is listed with what would close it:

- **Whether `zodOutputFormat` is runtime-compatible with `client.beta.messages.parse`.** Verified so
  far only by `tsc` against the SDK's type declarations. A live smoke test exists in
  `apps/backend/tests/live/`, gated behind `RUN_LIVE_API=1`. Closing this needs one run of that test
  with a real key.
- **Whether a real failing run reads as a failure end to end.** One real passing run was observed
  before the no-spend rule took effect. The failing path — a description that should score below
  threshold and trigger repair and a failed exit code — has only been exercised against fixtures
  built to have the same event shapes as a live run, never against an actual model response. Closing
  this needs a live run against a description known to fail at least one check.
- **The cross-provider bias check against OpenAI.** Not run. Closing this needs Task 23 executed with
  both keys live.
- **The agreement study itself.** No kappa exists because no hand-marked gold set exists yet; that
  set can only be produced by the owner, marking each description blind to the agent's output. Both
  `kappa` and `perCheckKappa` in `data/versions/notes.json` stay `null` until that happens.

An assessor should read this list as the boundary of what has actually been checked, not as a set of
caveats to discount.
