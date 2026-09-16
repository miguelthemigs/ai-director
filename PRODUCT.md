# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + TypeScript + Vite. Plain CSS or CSS modules with custom properties — no Tailwind, no
component library. `motion/react` for animation. TypeScript backend over HTTP with server-sent
events. Runs and version history on disk as files, with store interfaces sized for a later Supabase
implementation. (Source: `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`
sections 2, 7, 9, and the implementation brief.)

## Users

Primary user: Miguel Roale, the researcher, writing and repairing character descriptions for an AI
video model during an applied-research project at Fontys. Sits at a desktop, iterating on one
description at a time, reading nine check scores and the exact words that failed.

Second audience, confirmed: Fontys assessors reading the tool as evidence. They do not operate it to
get work done; they operate it to judge whether the method is sound and whether the numbers on
screen can be traced to something real. *(Inferred from the brief's "shown to assessors"; not
user-confirmed.)*

## Product Purpose

A writer pastes a character description for an AI video model. An Evaluator agent scores it against
a versioned nine-check rubric and quotes verbatim the words that failed. A Repairer agent rewrites
only those quoted fragments. Up to three passes. The product's job is to make the score, the
evidence for the score, and the repair all inspectable in the same screen, so a claim like "v2 beat
v1" is legible check by check rather than asserted.

Success: the researcher can see which check failed, which words caused it, what was changed, and
what it cost — without leaving the screen or trusting a number they cannot trace.

## Positioning

The identity of a character survives only as prose, because Seedance 2.5 refuses a real human face
as any kind of input and two generations from the same description return two different people. So
the tool measures and repairs prose. Grading spends no render credit; the Compare screen, added
2026-09-16, is the one surface that does, and it renders the same avatar twice to test whether a
repaired description buys anything a viewer can see. Its
mechanism a neighbouring product could not truthfully copy: every failing score carries verbatim
quotes that are verified in code with `description.indexOf(quote)`, and every repair is a spliced
range with a post-splice assertion that untouched text is byte-identical. The scores are not the
model's opinion of itself; they are anchored to a frozen, hand-marked gold set and reported as
Cohen's kappa.

## Operating Context

- One run at a time, desktop, indoor office light, long sessions of iteration. *(Ambient-light scene
  inferred from the research setting; not user-confirmed.)*
- The run streams. Progress arrives as server-sent events: `run.started`, `pass.started`,
  `evaluator.group.started`, `evaluator.group.completed`, `repairer.started`, `repairer.completed`,
  `pass.completed`, `run.completed`, `run.failed`, each with an id of the form `<pass>-<step>`.
- Four screens: Run, Architecture, Versions, Compare. The Architecture screen is an audit view
  driven by the same event stream as Run; Compare polls, and adds no event to that stream.
- Rubric and prompt files are append-only. A new version is a new file, which is what makes the
  Versions screen honest.
- The tool is also demonstrated live to assessors, so its screens are read by people who did not
  write them.

## Capabilities and Constraints

- Nine checks in three groups. Group A look: `age_build`, `face_skin`, `hair_spec`, `wardrobe`,
  `anchor_marker`. Group B safety: `no_real_person`, `no_brand_name`. Group C drawable:
  `drawable_only`, `no_cross_slot`.
- Bands 1–5 map to fixed percentages 20/40/60/80/100. Pass threshold is band 4 (80%). The
  percentage is derived from the band, never free-formed by the model.
- Any check below band 4 must carry non-empty verbatim quotes from the input.
- A quote that fails verification is marked `unverified`, excluded from repair, and logged. The UI
  must show this explicitly, because silently not highlighting would read as a UI bug and hide a
  real pipeline defect.
- Maximum three passes. Terminal state is one of `passed`, `improved_still_failing`,
  `no_improvement`. **The UI must never show a success state for the last two.**
- Groups are headers only. Never an aggregate score that hides which check failed.
- Each pass renders only the fragments that changed, as a diff, never a whole-text rewrite.
- The description is read-only once submitted.
- Designed but unbuilt agents — Interrogator, Director, Identity Meter — appear on the Architecture
  graph as planned, and must be visually distinguishable from built ones.
- Out of scope in v1: database, auth, deployment, multi-user.
- Rendering is out of scope for the grading surface and always will be: no screen that scores a
  description may spend a render credit. The Compare screen is a separate fourth screen, added
  2026-09-16, which grades nothing and exists to evaluate failure-condition clause 2. It renders
  through OpenRouter rather than Runway — the same model and the same weights, a different vendor
  billing for it.
- Motion is tied to real state changes only: checks revealing as scores land, flow along graph edges
  between agents, fragment diff transitions. No looping or ambient motion, no animation of unchanged
  scores, none while typing.

## Brand Commitments

- The owner runs a product called **mentic**. *(Named in the brief; no logo, palette, or type asset
  supplied, and none is inferred here.)*
- Binding visual constraint volunteered in the brief: the tool should read as a serious instrument —
  closer to an oscilloscope or a lab notebook than a SaaS marketing page.
- Webfonts may only be loaded from `fonts.googleapis.com`.

## Evidence on Hand

- `docs/superpowers/specs/2026-09-10-character-description-agents-design.md` — the approved design.
- `docs/superpowers/plans/2026-09-10-evaluator-repairer-agents.md` — the implementation plan.
- `APPLIED-RESEARCH.md`, `MODEL-SELECTION.md`, `AI-USE-LOG.md`, `LEARNING-OUTCOMES.md`.
- Real measurements exist and may be shown: refusal probes against Runway 2026-08-13 to 2026-08-30;
  per-pass cost of roughly 1.1k input and 600 output tokens per group call, about $0.06 per
  evaluation pass; pricing $5.00/M input and $25.00/M output for `claude-opus-5`.
- A gold set of 30–50 hand-marked descriptions is planned but **not yet marked**. Agreement numbers
  (Cohen's kappa per check) do not exist yet and must not be fabricated in any screen or mock.
- No customers, no testimonials, no benchmarks against other tools. None may be invented.

## Product Principles

1. **Every number traces to its evidence.** A score is never shown without a path to the words that
   caused it.
2. **Never round away a failure.** No aggregate, no group average, no summary badge that can hide
   one failing check among eight passing ones.
3. **Failure states stay failures.** `improved_still_failing` and `no_improvement` are reported as
   plainly as `passed`, and never borrow its colour, icon, or language.
4. **Show the pipeline, including what is not built.** Planned agents are drawn, labelled planned,
   and never mistaken for running ones.
5. **A defect in the pipeline must look like a defect.** Unverified quotes, failed nodes, and missing
   fragments get explicit states rather than silence.

## Accessibility & Inclusion

- The band ramp is read constantly and carries pass/fail meaning, so it must stay legible under
  red-green colour blindness and must never use colour as the only signal.
- The check↔fragment relationship is the core interaction and must be fully operable from the
  keyboard.
- A run streams; its progress must be announced to assistive technology without flooding it.
- Reduced-motion users must still receive every state change the motion carries.
