# Design: character description evaluator and repairer

Date: 2026-09-10
Owner: Miguel Roale
Status: approved in brainstorming, ready for implementation planning
Extends: `APPLIED-RESEARCH.md` (twelve-item rubric, implementation direction step 1-3), `MODEL-SELECTION.md`

## 1. Why these two agents exist

Seedance 2.5 on Runway refuses a real human face as any kind of input, measured three ways in
Subquestion 3. Two generations from the same written description return two different-looking
people. So the character's identity survives only as prose, and the quality of that prose is the
whole ballgame. That is what these agents measure and improve.

Both agents are text-only. Nothing here spends a render credit, which is what `APPLIED-RESEARCH.md`
step 3 means by "closing the score, defect and fix loop in text only". The measure-only rule in
conclusion 7 applies to render drift, not to text repair: no agent in this design corrects a render,
and drift is still measured rather than auto-corrected.

## 2. Scope

In v1:

- Evaluator agent scoring one character description against a versioned rubric.
- Repairer agent that may only rewrite fragments the Evaluator quoted.
- TypeScript backend exposing both over HTTP with a live event stream.
- TypeScript frontend with three screens: Run, Architecture, Versions.
- Run and version history on disk as files.
- An agreement study against a frozen human-marked set.

Out of scope in v1: database, Interrogator agent, Director agent, Identity Meter, any Runway call,
any render, auth, deployment, multi-user.

## 3. Rubric v1

One file, `rubric/v1.json`. Immutable once any run references it; changes ship as `v2.json`.

Each check carries: `id`, `group`, `passTest` (one line), `bands` (five written definitions),
`source`. The percentage shown in the UI is derived from the band, not free-formed by the model:
band 1 = 20, band 2 = 40, band 3 = 60, band 4 = 80, band 5 = 100. Pass threshold is band 4.

Group A, re-renderable look (source: Higgsfield character pattern, checked 2026-09-10 across
`cinematic_headphones`, `cinema-studio-3.0`, `seedance-prompting-guide`, `ai-commercial-youtube-guide`):

- `age_build` - names an age bracket and a build. Their pattern: "Identity: Male, Latino, ~30 years
  old", "Physique: Athletic, tall", "lean man, late 20s".
- `face_skin` - face and skin detail beyond generic, e.g. freckles, jawline, texture. Their pattern:
  "fair freckled skin", "Pore-level realism - vellus hair, asymmetric moles, capillary flush".
- `hair_spec` - colour and texture and style together. Their pattern: "Slick back, wavy, brown",
  "reddish-brown curly hair".
- `wardrobe` - stated head to toe including footwear. Their pattern: "dusty-rose short-sleeve shirt
  open over a white tee, light-wash baggy jeans, black-and-white low-top Converse".
- `anchor_marker` - at least one reusable identity anchor: earring, scar, tattoo, moustache. Their
  pattern: "small gold hoop earrings", "Facial hair: Mustache".

Group B, will not be refused (source: my own probe runs against Runway 2026-08-13 to 2026-08-30, and
third-party reporting on the 2.0 filter dated 13 April 2026 that it bites hardest on "real,
identifiable people, particularly public figures"):

- `no_real_person` - no celebrity, no public figure, no "looks like X", no lookalike framing.
- `no_brand_name` - no brand or franchise name anywhere in the description.

Group C, only drawable words (source: my render-tested shot-construction contract in
`APPLIED-RESEARCH.md`):

- `drawable_only` - no mood words, feelings, backstory or judgements: "cinematic", "confident",
  "striking" all fail, because no model can act on them.
- `no_cross_slot` - no camera, lighting, grade or audio instruction inside the character block, so
  the block stays reusable across stages.

Two invariants are checked by code, not by a model, because code compares strings exactly:

- `byte_identical` - the description is byte-identical everywhere it appears.
- `negative_constraint_present` - the identity-drift negative line is present, following
  Higgsfield's "Continuity: Characters, props, environment identical across every cut. No identity
  drift."

Logged revision: this is a narrowing of the published twelve-item stage rubric down to the character
sub-problem, plus three components Higgsfield names that the twelve miss (acting layer, skin-texture
layer, negative constraints). Recorded here so the difference reads as design rather than drift.

## 4. Agent contracts

Model: `claude-opus-5` for both agents. Adaptive thinking (`thinking: {type: "adaptive"}`),
`output_config: {effort: "high"}`. Server-side refusal fallback enabled by default:
`betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`. No `budget_tokens`, no
assistant prefill, both removed on this model. Pricing at time of writing: $5.00 per million input
tokens, $25.00 per million output.

Structured output via `client.messages.parse()` with `zodOutputFormat(Schema)` in
`output_config.format`, from `@anthropic-ai/sdk/helpers/zod`. `parsed_output` is null on parse
failure and must be guarded, never asserted.

Evaluator, three calls per pass, one per group, run concurrently. Each call sees only its own
group's checks, so a weak wardrobe line cannot drag the filter-safety score down through halo
effect. Returns per check: `checkId`, `band` (1-5), `reason` (one sentence), and `quotes` (array of
verbatim fragments from the input) which must be non-empty for any band below 4. It never rewrites,
and it never sees the Repairer's reasoning.

Repairer, one call per pass. Input is the failing checks and their verified fragments only, never
the full description. Returns `replacements: [{spanId, newText, rationale}]`, one entry per
fragment. It cannot return a full paragraph, so there is no channel through which it can touch
passing text.

Bias note: Evaluator and Repairer are the same model family, which the LLM-judge literature
associates with self-preference. Mitigations: the frozen human set is the anchor, and the Evaluator
model is a config value so the same runs can be repeated on a different model as a bias check.

## 5. What code enforces

- Span verification. For every returned quote, `description.indexOf(quote)` in code. Offsets are
  computed locally; the model is never asked for character positions because models miscount. A
  quote that does not match verbatim gets one retry with an instruction to quote exactly, then is
  marked `unverified`, excluded from repair, and logged as prompt-tuning signal.
- Splice. Verified offsets are sorted and each range replaced with `newText`, then the string is
  reassembled by code. Everything outside a quoted fragment is byte-identical by construction.
- Post-splice assertion. Diff the untouched regions before and after; throw if they differ. This
  should be unreachable and is a test target.
- Loop control. Maximum three passes. Terminal state is one of `passed`, `improved_still_failing`,
  `no_improvement`. The UI must never show a success state for the last two.

## 6. Run lifecycle and events

`POST /runs` starts a run, `GET /runs/:id/events` streams progress as server-sent events, chosen
over WebSocket because traffic is server to client only and `EventSource` reconnects with
`Last-Event-ID`, which a multi-pass loop needs. Event names: `run.started`, `pass.started`,
`evaluator.group.started`, `evaluator.group.completed`, `repairer.started`, `repairer.completed`,
`pass.completed`, `run.completed`, `run.failed`. Each event carries an id of the form
`<pass>-<step>` for resume.

## 7. Files, versioning, and the path to Supabase

```
apps/backend/src/
  agents/evaluator/{schema.ts,run.ts}
  agents/repairer/{schema.ts,run.ts}
  prompts/evaluator/v1.md
  prompts/repairer/v1.md
  rubric/v1.json
  enforce/{verifySpans.ts,splice.ts}
  routes/runs.ts
  store/{RunStore.ts,FileRunStore.ts}
data/runs/<runId>/manifest.json        # rubricVersion, promptVersions, model, status, timings
data/runs/<runId>/pass-<n>-eval.json
data/runs/<runId>/pass-<n>-repair.json
data/versions/notes.json               # why each version changed, required field
data/agreement/gold-set.json           # frozen, human marks
data/agreement/results-<rubricVersion>.json
```

Prompt and rubric files are append-only: a new version is a new file, which is what makes the
Versions screen honest. `RunStore` and `VersionStore` are interfaces with file implementations, so a
`SupabaseRunStore` can land later without touching anything above the store layer.

## 8. Evidence protocol

- Gold set: 30 to 50 character descriptions, a mix of ones I wrote properly, ones deliberately
  broken per check, and ones taken from published examples. I mark every check pass or fail by hand,
  once, blind to the agent's output. The set is frozen and reused unchanged across every rubric
  version, so v1 and v2 are graded on the same exam.
- Statistic: Cohen's kappa per check plus overall, with the confusion counts, not raw percentage
  agreement, because these are threshold decisions where chance agreement is high.
- Pre-registered failure condition, written before the first run: if repaired descriptions score
  better while a later render comparison shows no reduction in drift or refusal, the approach failed
  and that null result gets reported. Recorded now so it cannot be quietly dropped later.
- Cost: roughly 1.1k input and 600 output tokens per group call, three calls per pass, so about
  $0.06 per evaluation pass and under $3 to score a 40-item gold set once.

## 9. Frontend

Three screens. React and TypeScript, Vite.

- Run. Description on the left, read-only once submitted. Checks on the right, grouped under the
  three group headers, all nine always visible with their own percentage; groups are headers, never
  an aggregate score that hides which check failed. Clicking a check highlights its quoted fragment
  in the text and vice versa. A pass stepper shows passes 1 to 3, each pass rendering only the
  fragments that changed as a diff, never a whole-text rewrite. An explicit "fragment not found"
  state when a quote fails verification, because silently not highlighting would read as a UI bug
  and hide a real pipeline defect.
- Architecture. Live node graph of the pipeline driven by the same events as the Run screen, with
  states queued, running, done, failed, and the unbuilt agents dashed and labelled planned. Nodes
  are clickable and show that step's real payload, latency and token cost, which makes the screen an
  audit view rather than decoration.
- Versions. One row per rubric or prompt version with a delta badge, a small inline sparkline, and a
  required note saying why it changed. A two-version compare shows the prompt diff and the per-check
  score delta, so "v2 beat v1" is legible check by check.

Animation rules: motion is tied to real state changes only, specifically the checks revealing as
scores land, flow along the graph edges between agents, and the fragment diff transitions. No
looping or ambient motion, no animation of unchanged scores, none while typing.

Implementation must invoke the `impeccable`, `ui-ux-pro-max` and `motion` skills before the screens
are built. This is a requirement of the design, not a preference.

## 10. Build order

1. Rubric v1 file plus the Evaluator prompt, run from a CLI command that prints bands and quotes and
   writes a run file. No server, no UI.
2. Span verification and its tests, including the paraphrase-retry path.
3. Repairer plus splice plus the post-splice assertion, and the three terminal states.
4. Gold set marked by hand, agreement script, kappa reported for rubric v1.
5. Backend routes and the event stream.
6. Run screen.
7. Architecture and Versions screens, with the design and motion skills loaded.

Steps 1 to 4 produce the graded evidence before any interface exists, which is the risk control:
if time runs out, the research still has its result.

## 11. Open questions

- Exact band wording per check. Drafted during step 1 against real descriptions, then frozen with
  the rubric version.
- Whether the negative-constraint line belongs to the character block or the stage prompt. Currently
  a code check on the block; may move when the Director agent arrives.
- Gold set size: 30 is the floor, 50 preferred, decided by how long hand-marking actually takes.
