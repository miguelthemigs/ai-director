# ai-director

Applied research on directing AI video models. The build in progress is **Prompt Coach v1**: a
character-description Evaluator and Repairer, three screens, and the evidence that grades them.

## Read before changing anything

- `docs/superpowers/specs/2026-09-10-character-description-agents-design.md` — the approved design,
  and the authority when the plan and the code disagree.
- `docs/superpowers/plans/2026-09-11-prompt-coach-v1.md` — the implementation plan in flight.
- `PRODUCT.md` — product constraints and principles.
- `docs/decision-log.md` — decisions already taken, including the pre-registered failure condition.

## Layout

- `packages/contract` — the only definition of types that cross the network. Defining one of these
  types a second time anywhere else is a defect.
- `apps/backend` — rubric, agents, enforcement, orchestration, store, CLI, server.
- `apps/frontend` — React 19 + Vite. Three screens: Run, Architecture, Versions.
- `data/` — runs (gitignored), frozen gold set, version notes.

## Rules that are not negotiable

- Model for both agents is `claude-opus-5`. Never a date-suffixed variant.
- Bands 1-5 map to 20/40/60/80/100. Pass is band 4. The percentage is derived from the band, never
  produced by a model.
- Any check below band 4 carries verbatim quotes, verified in code with `indexOf`. Never trust a
  model for character offsets.
- The Repairer only ever sees failing fragments, never the whole description.
- Three passes maximum. Terminal state is `passed`, `improved_still_failing` or `no_improvement`,
  and the UI must never show a success state for the last two.
- Rubric and prompt files are append-only. A change ships as a new version file.
- Motion is tied to real state changes only. No ambient or looping animation anywhere.
- Never commit a key. Secrets live in `.env`; `.env.example` documents them.

## Commands

- `npm test` — the full suite. Live API tests are skipped unless `RUN_LIVE_API=1`.
- `npm run typecheck`
- `npm run score <file>` — grade and repair one description from the command line.
- `npm run agree` — the agreement study against the frozen gold set.
