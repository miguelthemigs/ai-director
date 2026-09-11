# Agent guide

This file is for agent harnesses other than Claude Code. It is intentionally the same guidance as
`CLAUDE.md`, which is the canonical copy — read that file. If the two ever disagree, `CLAUDE.md`
wins and this file is the one to fix.

Quick orientation:

- The approved design is `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`.
- The plan in flight is `docs/superpowers/plans/2026-09-11-prompt-coach-v1.md`.
- `packages/contract` owns every type that crosses the network; do not redefine one elsewhere.
- Bands map to 20/40/60/80/100, pass at band 4, percentages derived in code.
- Quotes are verified with `indexOf` in code, never taken from a model's character offsets.
- `improved_still_failing` and `no_improvement` must never render as success.
- Tests: `npm test`. Live API tests need `RUN_LIVE_API=1` and a key in `.env`.
