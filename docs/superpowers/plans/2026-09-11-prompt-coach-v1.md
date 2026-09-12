# Prompt Coach v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the whole of Prompt Coach v1 — a scoring engine that grades a character description against a versioned nine-check rubric and repairs only the fragments that failed, three React screens that make the run, the pipeline and the rubric history legible, and the HTTP and event-stream layer that joins them.

**Architecture:** Four phases in dependency order. Phase A builds the engine as pure functions behind injectable transports, driven from a CLI, with no server and no UI — this is where the graded evidence comes from. Phase B builds the three screens against a typed wire contract served by fixtures, so the interface is designed and reviewable before any network code exists. Phase C replaces the fixture adapter with Fastify routes and a server-sent event stream that satisfy the same contract. Phase D produces the research evidence: a live smoke test, a cross-provider bias check, the agreement study, and the pre-registered failure condition.

**Tech Stack:** Node 24, TypeScript (ESM), `@anthropic-ai/sdk`, `openai`, `zod`, `fastify`, React 19, Vite 6, `motion`, `vitest`, `@testing-library/react`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`

**Design inputs:** `docs/superpowers/design/2026-09-11-prompt-coach-ui-design.md` (tokens, layouts, component signatures) and `docs/superpowers/design/2026-09-11-prompt-coach-motion-spec.md` (motion moments, timing tokens, reduced-motion behaviour). Phase B tasks cite these by section; an implementer reads the cited section, not the whole file.

**Supersedes:** `docs/superpowers/plans/2026-09-10-evaluator-repairer-agents.md`. Phase A here is that plan's Tasks 1-10 unchanged; Phase D is its Tasks 11-13, renumbered. Do not execute both plans.

## Global Constraints

### Engine and agents

- Model for both agents: `claude-opus-5`. Never a date-suffixed variant.
- Request shape for both agents: `thinking: { type: "adaptive" }`, `output_config: { effort: "high", format: zodOutputFormat(Schema) }`, `max_tokens: 16000`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- Never send `budget_tokens` and never prefill an assistant turn: both are removed on this model and return 400.
- `client.messages.parse()` returns `parsed_output` that is `null` on parse failure. Always guard, never assert with `!`.
- Rubric and prompt files are append-only. `rubric/v1.json` is immutable once any run references it; changes ship as `v2.json`.
- Pass threshold is band 4. Band to percent mapping is exactly `{1:20, 2:40, 3:60, 4:80, 5:100}`.
- Maximum three passes per run. Terminal state is exactly one of `passed`, `improved_still_failing`, `no_improvement`.
- The Repairer never receives the full description, only failing fragments.
- ESM only: `__dirname` is undefined. Derive paths with `path.dirname(fileURLToPath(import.meta.url))` or use cwd-relative paths.
- No network calls in unit tests. Live API calls happen only in the tests of Tasks 20 and 21, which are skipped unless `RUN_LIVE_API=1`.

### Interface

- The UI must never show a success state for `improved_still_failing` or `no_improvement`. This is a spec requirement, not a style choice, and every task that renders a terminal state is reviewed against it.
- Group headers never carry an aggregate score. All nine checks are always visible with their own percentage.
- Percentages shown in the UI are derived from the band by `bandToPercent`, never free-formed.
- A quote that failed verification renders an explicit "fragment not found" state. Silently not highlighting is forbidden.
- Motion is tied to real state changes only: checks revealing as scores land, flow along graph edges, fragment diff transitions. No looping or ambient motion, no animation of unchanged scores, none while typing.
- Every animated component honours `useReducedMotion` and never conveys information by motion alone.
- No Tailwind, no component library. Plain CSS with custom properties, following the token block in the UI design doc.
- The only permitted external stylesheet host is `fonts.googleapis.com`.

### Shared

- The wire contract in `packages/contract` is the single definition of every type crossing the network. The engine, the fixtures, the API and the UI all import it. A type defined twice is a defect.
- Secrets live in `.env`, which is gitignored, and are documented in `.env.example`. Never commit a key.
- Every task ends with a commit. Run the focused test while iterating, the full suite once before committing.

---

## File Structure

```
package.json                                  # npm workspaces root, scripts
tsconfig.base.json                            # strict ESM config, shared
vitest.config.ts                              # backend + contract (node)
CLAUDE.md                                     # repo guide for Claude Code
AGENTS.md                                     # repo guide for other agent harnesses
.env.example                                  # documents every key, no values

packages/contract/                            # the only definition of wire types
  package.json
  src/index.ts                                # re-exports everything below
  src/checks.ts                               # CheckId, CheckGroup, Band, CHECK_IDS, group membership
  src/run.ts                                  # RunView, PassView, CheckResultView, SpanView
  src/events.ts                               # RunEvent union, event names, event ids
  src/pipeline.ts                             # PipelineNode, NodeState, the v1 graph incl. planned
  src/versions.ts                             # VersionRow, VersionCompare, CheckDelta
  src/fixtures.ts                             # canned runs the UI and tests render
  tests/*.test.ts

apps/backend/
  package.json
  src/rubric/{types.ts,v1.json,load.ts}       # nine checks, five bands, sources
  src/agents/evaluator/{schema.ts,prompt.ts,run.ts}
  src/agents/repairer/{schema.ts,prompt.ts,run.ts}
  src/api/client.ts                           # Anthropic client + shared request options
  src/api/openaiTransport.ts                  # bias-check transport, same interface
  src/enforce/{score.ts,verifySpans.ts,splice.ts}
  src/orchestrate/{runPass.ts,runToCompletion.ts,events.ts}
  src/store/{RunStore.ts,FileRunStore.ts,VersionStore.ts,FileVersionStore.ts}
  src/agreement/{kappa.ts,report.ts}
  src/cli/{score.ts,agree.ts,bias.ts}
  src/server/{app.ts,routes/runs.ts,routes/versions.ts,sse.ts,server.ts}
  tests/                                      # mirrors src/
  tests/live/                                 # gated on RUN_LIVE_API=1

apps/frontend/
  package.json
  index.html
  vite.config.ts
  vitest.config.ts                            # jsdom, separate from backend
  src/main.tsx
  src/App.tsx                                 # routing between the three screens
  src/styles/{tokens.css,base.css}            # the design doc's token block
  src/motion/tokens.ts                        # durations, easings, springs
  src/data/{RunClient.ts,FixtureRunClient.ts,HttpRunClient.ts}
  src/components/                             # one file per component in the design doc
  src/screens/{RunScreen.tsx,ArchitectureScreen.tsx,VersionsScreen.tsx}
  tests/                                      # mirrors src/

docs/decision-log.md                          # pre-registered failure condition
data/runs/<runId>/…                           # created at runtime, gitignored
data/versions/notes.json                      # why each version changed
data/agreement/gold-set.json                  # hand-marked, frozen
data/samples/*.txt                            # descriptions used by live tests
```

### Task map

| Phase | Tasks | Deliverable |
|---|---|---|
| A — Engine | 1-10 | `npm run score <file>` grades and repairs a real description end to end |
| B — Interface | 11-16 | Three screens running on fixtures at `npm run dev`, fully reviewable |
| C — Wiring | 17-20 | Fastify + SSE behind the same contract; the screens go live on real runs |
| D — Evidence | 21-24 | Live smoke, cross-provider bias check, agreement study, decision log |

Phase A is the only phase that must run in order. Within Phase B, Task 11 gates everything; Tasks 13
and 14 are the same screen and must run in order; Tasks 15 and 16 are independent of each other.
Phase C must follow Phase B, because the client interface Task 20 swaps is defined in Task 12.

---

# Phase A — Engine

Phase A is `docs/superpowers/plans/2026-09-10-evaluator-repairer-agents.md` Tasks 1-10, reproduced
unchanged so this plan is self-contained. Two corrections apply to Task 1 and are stated inside it:
the repository is already initialised, and `.gitignore` already exists and must be extended rather
than overwritten.

### Task 1: Workspace, TypeScript, test harness, and the band scale

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `CLAUDE.md`, `AGENTS.md`
- Create: `packages/contract/package.json`, `apps/backend/package.json`
- Modify: `.gitignore` (it already exists — extend it, do not overwrite)
- Create: `apps/backend/src/enforce/score.ts`
- Test: `apps/backend/tests/enforce/score.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `bandToPercent(band: 1|2|3|4|5): number`, `PASS_BAND = 4`, `isPass(band: number): boolean`, all exported from `apps/backend/src/enforce/score.ts`. Also the npm workspace layout every later task builds into.

**Two corrections to the environment you will find:**

1. The repository is **already initialised** and you are **already on the branch** `feat/prompt-coach-v1`, with commits in history. Do **not** run `git init` and do not create a branch.
2. `.gitignore` **already exists** and contains a `.superpowers/` line that must survive. Append the missing entries; never overwrite the file.

- [ ] **Step 1: Install dependencies**

```bash
npm init -y
npm install zod
npm install -D typescript vitest tsx @types/node
```

- [ ] **Step 2: Make the root a workspace**

Replace the generated `package.json` with exactly this:

```json
{
  "name": "ai-director",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "score": "tsx apps/backend/src/cli/score.ts",
    "agree": "tsx apps/backend/src/cli/agree.ts"
  }
}
```

`packages/contract/package.json`:

```json
{
  "name": "@ai-director/contract",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`apps/backend/package.json`:

```json
{
  "name": "@ai-director/backend",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

Then run `npm install` once more so npm links the workspaces.

- [ ] **Step 3: Write the TypeScript and vitest configuration**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["apps/backend/**/*.ts", "packages/**/*.ts"]
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/backend/**/tests/**/*.test.ts", "packages/**/tests/**/*.test.ts"],
    environment: "node",
  },
});
```

The frontend gets its own vitest config in Phase B, because it needs `jsdom` and this one must stay `node`.

- [ ] **Step 4: Extend `.gitignore`**

Read the existing file first. It already contains `node_modules`, `dist`, `.env`, `data/runs` and `.superpowers/`. Add only what is missing:

```
coverage
apps/frontend/dist
.DS_Store
```

Verify `.superpowers/` is still present when you are done. If it is gone, you overwrote the file — restore it.

- [ ] **Step 5: Write `.env.example`**

Both keys already exist in the developer's real `.env`, which is gitignored. This file documents them and holds no values.

```
# Anthropic — the Evaluator and Repairer agents
ANTHROPIC_API_KEY=

# OpenAI — used only by the cross-provider bias check in Task 21
OPENAI_API_KEY=

# Set to 1 to run the live API tests, which are skipped by default
RUN_LIVE_API=0
```

- [ ] **Step 6: Write `CLAUDE.md` and `AGENTS.md`**

`CLAUDE.md`:

```markdown
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
```

`AGENTS.md`:

```markdown
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
```

- [ ] **Step 7: Write the failing test**

`apps/backend/tests/enforce/score.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { bandToPercent, isPass, PASS_BAND } from "../../src/enforce/score.js";

describe("band scoring", () => {
  it("maps every band to its fixed percentage", () => {
    expect([1, 2, 3, 4, 5].map((b) => bandToPercent(b as 1))).toEqual([20, 40, 60, 80, 100]);
  });

  it("passes at band 4 and above only", () => {
    expect(PASS_BAND).toBe(4);
    expect([1, 2, 3].every((b) => isPass(b))).toBe(false);
    expect(isPass(4)).toBe(true);
    expect(isPass(5)).toBe(true);
  });

  it("rejects a band outside 1 to 5", () => {
    expect(() => bandToPercent(0 as 1)).toThrow(/band must be 1-5/);
    expect(() => bandToPercent(6 as 1)).toThrow(/band must be 1-5/);
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/enforce/score.test.ts`
Expected: FAIL, cannot find module `../../src/enforce/score.js`.

- [ ] **Step 9: Write the implementation**

`apps/backend/src/enforce/score.ts`:

```typescript
export type Band = 1 | 2 | 3 | 4 | 5;

export const PASS_BAND = 4;

const PERCENT: Record<Band, number> = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

export function bandToPercent(band: Band): number {
  const percent = PERCENT[band];
  if (percent === undefined) throw new Error(`band must be 1-5, got ${band}`);
  return percent;
}

export function isPass(band: number): boolean {
  return band >= PASS_BAND;
}
```

- [ ] **Step 10: Run it and watch it pass**

Run: `npx vitest run apps/backend/tests/enforce/score.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: npm workspace, typescript, vitest, agent guides, band scoring"
```

---

### Task 2: Rubric v1 file and validating loader

**Files:**
- Create: `apps/backend/src/rubric/types.ts`, `apps/backend/src/rubric/v1.json`, `apps/backend/src/rubric/load.ts`
- Test: `apps/backend/tests/rubric/load.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RubricSchema`, `type Rubric`, `type RubricCheck`, `type CheckGroup = "look" | "safety" | "drawable"`, `loadRubric(version: string): Promise<Rubric>`, `checksForGroup(rubric: Rubric, group: CheckGroup): RubricCheck[]`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/rubric/load.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { checksForGroup, loadRubric } from "../../src/rubric/load.js";

describe("rubric v1", () => {
  it("loads and validates", async () => {
    const rubric = await loadRubric("v1");
    expect(rubric.version).toBe("v1");
    expect(rubric.checks).toHaveLength(9);
  });

  it("gives every check five bands and a source", async () => {
    const rubric = await loadRubric("v1");
    for (const check of rubric.checks) {
      expect(Object.keys(check.bands)).toEqual(["1", "2", "3", "4", "5"]);
      expect(check.source.length).toBeGreaterThan(0);
      expect(check.passTest.length).toBeGreaterThan(0);
    }
  });

  it("splits into 5 look, 2 safety, 2 drawable checks", async () => {
    const rubric = await loadRubric("v1");
    expect(checksForGroup(rubric, "look").map((c) => c.id)).toEqual([
      "age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker",
    ]);
    expect(checksForGroup(rubric, "safety").map((c) => c.id)).toEqual([
      "no_real_person", "no_brand_name",
    ]);
    expect(checksForGroup(rubric, "drawable").map((c) => c.id)).toEqual([
      "drawable_only", "no_cross_slot",
    ]);
  });

  it("rejects an unknown version rather than inventing one", async () => {
    await expect(loadRubric("v99")).rejects.toThrow(/rubric v99 not found/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/rubric/load.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the schema**

`apps/backend/src/rubric/types.ts`:

```typescript
import { z } from "zod";

export const CheckGroupSchema = z.enum(["look", "safety", "drawable"]);
export type CheckGroup = z.infer<typeof CheckGroupSchema>;

export const RubricCheckSchema = z.object({
  id: z.string().min(1),
  group: CheckGroupSchema,
  title: z.string().min(1),
  passTest: z.string().min(1),
  bands: z.object({
    "1": z.string().min(1),
    "2": z.string().min(1),
    "3": z.string().min(1),
    "4": z.string().min(1),
    "5": z.string().min(1),
  }),
  source: z.string().min(1),
});
export type RubricCheck = z.infer<typeof RubricCheckSchema>;

export const RubricSchema = z.object({
  version: z.string().min(1),
  frozenOn: z.string().min(1),
  passBand: z.literal(4),
  checks: z.array(RubricCheckSchema).length(9),
});
export type Rubric = z.infer<typeof RubricSchema>;
```

- [ ] **Step 4: Write the rubric file**

`apps/backend/src/rubric/v1.json`. Write all nine checks. The five band strings must be written as observable states, never as adjectives. Use exactly these ids, groups and sources; the band wording below is the starting draft and is frozen when this file is committed.

```json
{
  "version": "v1",
  "frozenOn": "2026-09-10",
  "passBand": 4,
  "checks": [
    {
      "id": "age_build",
      "group": "look",
      "title": "Age bracket and build",
      "passTest": "States an age bracket and a body build.",
      "bands": {
        "1": "Neither age nor build appears.",
        "2": "One of the two appears, vaguely (\"young\").",
        "3": "Both appear but at least one is vague (\"young, average\").",
        "4": "Age bracket and build both stated concretely (\"late 20s, lean\").",
        "5": "Age bracket, build, and a height or proportion cue, all concrete."
      },
      "source": "Higgsfield Cast fields and cinematic_headphones, checked 2026-09-10"
    },
    {
      "id": "face_skin",
      "group": "look",
      "title": "Face and skin detail",
      "passTest": "Names at least two specific face or skin features that a render could be checked against.",
      "bands": {
        "1": "No face or skin detail.",
        "2": "Only an evaluative word (\"pretty face\").",
        "3": "One concrete feature named.",
        "4": "Two or more concrete features named (jaw shape, eye colour, freckles).",
        "5": "Two or more concrete features plus a skin-texture cue (freckling, capillary flush, pore detail)."
      },
      "source": "Higgsfield cinematic_headphones pore-level realism line, checked 2026-09-10"
    },
    {
      "id": "hair_spec",
      "group": "look",
      "title": "Hair specified three ways",
      "passTest": "States hair colour and texture and style together.",
      "bands": {
        "1": "Hair not mentioned.",
        "2": "One of colour, texture or style.",
        "3": "Two of the three.",
        "4": "Colour, texture and style all stated.",
        "5": "All three plus length or parting."
      },
      "source": "Higgsfield Cast fields (\"Slick back, wavy, brown\"), checked 2026-09-10"
    },
    {
      "id": "wardrobe",
      "group": "look",
      "title": "Wardrobe head to toe",
      "passTest": "Names every visible garment including footwear, with colours.",
      "bands": {
        "1": "No wardrobe.",
        "2": "A category only (\"casual clothes\").",
        "3": "Some garments named, footwear missing.",
        "4": "All visible garments named with colours, footwear included.",
        "5": "As band 4 plus fit or condition cues (\"zip half open\", \"light-wash baggy\")."
      },
      "source": "Higgsfield cinematic_headphones full outfit line, checked 2026-09-10"
    },
    {
      "id": "anchor_marker",
      "group": "look",
      "title": "Identity anchor marker",
      "passTest": "Names at least one small reusable marker that can be checked shot to shot.",
      "bands": {
        "1": "No marker.",
        "2": "A marker implied but not localised (\"jewellery\").",
        "3": "One marker named without position or count.",
        "4": "One marker named with position or count (\"two moles on the left cheek\").",
        "5": "Two or more such markers, each localised or counted."
      },
      "source": "Higgsfield gold hoop earrings and moustache examples, checked 2026-09-10"
    },
    {
      "id": "no_real_person",
      "group": "safety",
      "title": "No real-person anchor",
      "passTest": "Contains no celebrity, public figure, or lookalike framing.",
      "bands": {
        "1": "Names a real person as the character.",
        "2": "Lookalike framing (\"looks like X\", \"X vibes\").",
        "3": "An indirect real-person pointer (a named role a single living person holds).",
        "4": "No real-person pointer of any kind.",
        "5": "No real-person pointer, and the text states the character is fictional or generated."
      },
      "source": "My own Runway probe runs 2026-08-13 to 2026-08-30; filter reporting dated 13 April 2026"
    },
    {
      "id": "no_brand_name",
      "group": "safety",
      "title": "No brand or franchise name",
      "passTest": "Contains no brand, franchise, or trademarked property name.",
      "bands": {
        "1": "A brand or franchise name appears as the subject.",
        "2": "A brand name appears on wardrobe or a prop.",
        "3": "A brand is strongly implied by a distinctive logo description.",
        "4": "No brand or franchise reference.",
        "5": "No brand reference, and garments are described generically enough to be re-renderable."
      },
      "source": "My own Runway moderation refusals, recorded in APPLIED-RESEARCH.md"
    },
    {
      "id": "drawable_only",
      "group": "drawable",
      "title": "Only drawable words",
      "passTest": "Contains no mood word, feeling, backstory or judgement.",
      "bands": {
        "1": "Mostly mood, feeling or backstory.",
        "2": "Several undrawable phrases.",
        "3": "One or two undrawable phrases.",
        "4": "No undrawable phrases.",
        "5": "No undrawable phrases, and every sentence names something visible."
      },
      "source": "My render-tested shot-construction contract, APPLIED-RESEARCH.md"
    },
    {
      "id": "no_cross_slot",
      "group": "drawable",
      "title": "No cross-slot instructions",
      "passTest": "Contains no camera, lighting, colour grade or audio instruction.",
      "bands": {
        "1": "Multiple camera or lighting instructions inside the description.",
        "2": "One camera or lighting instruction plus a grade or audio note.",
        "3": "One such instruction.",
        "4": "None: the block describes only the person.",
        "5": "None, and the block is a single self-contained paragraph reusable in any stage."
      },
      "source": "My render-tested shot-construction contract, APPLIED-RESEARCH.md"
    }
  ]
}
```

- [ ] **Step 5: Write the loader**

`apps/backend/src/rubric/load.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckGroup, type Rubric, type RubricCheck, RubricSchema } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadRubric(version: string): Promise<Rubric> {
  const file = path.join(here, `${version}.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(`rubric ${version} not found at ${file}`);
  }
  return RubricSchema.parse(JSON.parse(raw));
}

export function checksForGroup(rubric: Rubric, group: CheckGroup): RubricCheck[] {
  return rubric.checks.filter((check) => check.group === group);
}

export type { CheckGroup, Rubric, RubricCheck };
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run apps/backend/tests/rubric/load.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: rubric v1 with nine sourced checks and validating loader"
```

---

### Task 3: Span verification

**Files:**
- Create: `apps/backend/src/enforce/verifySpans.ts`
- Test: `apps/backend/tests/enforce/verifySpans.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Span = { spanId: string; checkId: string; quote: string; start: number; end: number }`, `type UnverifiedQuote = { checkId: string; quote: string; reason: "not_found" | "ambiguous" }`, `verifySpans(description: string, quotes: Array<{ checkId: string; quote: string }>): { spans: Span[]; unverified: UnverifiedQuote[] }`.

**Overlap policy, corrected after review.** `verifySpans` keeps **every** individually-verifiable
span, including spans that nest or overlap across checks. It must NOT demote an overlapping span to
`unverified`. `ambiguous` means one thing only: the quote appears more than once in the description,
so no single location exists. A quote that appears exactly once is verified, full stop, whatever
other checks quoted around it.

The reasoning: two checks quoting overlapping text are two true findings. On the description
"...in a Nike hoodie", `wardrobe` quoting "Nike hoodie" and `no_brand_name` quoting "Nike" are both
correct and both locatable. Demoting either discards real evidence, and it discards it by array
order, which meant a *safety* check could lose its evidence to a *look* check — the wrong trade in a
product whose safety group exists to avoid model refusals.

Overlap is only ever a problem for the splice, which cannot apply two replacements to the same
characters. That is resolved in Task 9, where the Repairer's input is chosen, and defended in Task 4,
which throws on overlapping replacements. Verification is not the place for it.

Add this test to `apps/backend/tests/enforce/verifySpans.test.ts`:

```typescript
it("verifies nested quotes from different checks instead of discarding one", () => {
  const description = "A lean man in a Nike hoodie and black jeans.";
  const { spans, unverified } = verifySpans(description, [
    { checkId: "wardrobe", quote: "Nike hoodie" },
    { checkId: "no_brand_name", quote: "Nike" },
  ]);
  expect(unverified).toEqual([]);
  expect(spans).toHaveLength(2);
  for (const span of spans) {
    expect(description.slice(span.start, span.end)).toBe(span.quote);
  }
});

it("still reports a genuinely repeated quote as ambiguous", () => {
  const { spans, unverified } = verifySpans("black shoes and black jeans", [
    { checkId: "wardrobe", quote: "black" },
  ]);
  expect(spans).toEqual([]);
  expect(unverified).toEqual([{ checkId: "wardrobe", quote: "black", reason: "ambiguous" }]);
});
```

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/enforce/verifySpans.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { verifySpans } from "../../src/enforce/verifySpans.js";

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

describe("verifySpans", () => {
  it("finds a verbatim quote and computes its offsets in code", () => {
    const { spans, unverified } = verifySpans(description, [
      { checkId: "drawable_only", quote: "very cinematic presence" },
    ]);
    expect(unverified).toEqual([]);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(description.slice(span.start, span.end)).toBe("very cinematic presence");
    expect(span.spanId).toBe("drawable_only:0");
  });

  it("marks a paraphrase unverified instead of guessing", () => {
    const { spans, unverified } = verifySpans(description, [
      { checkId: "drawable_only", quote: "cinematic vibes" },
    ]);
    expect(spans).toEqual([]);
    expect(unverified).toEqual([
      { checkId: "drawable_only", quote: "cinematic vibes", reason: "not_found" },
    ]);
  });

  it("marks a quote that appears more than once as ambiguous", () => {
    const { spans, unverified } = verifySpans("grey hoodie, grey shoes", [
      { checkId: "wardrobe", quote: "grey" },
    ]);
    expect(spans).toEqual([]);
    expect(unverified[0]!.reason).toBe("ambiguous");
  });

  it("keeps spans sorted and non-overlapping", () => {
    const { spans } = verifySpans(description, [
      { checkId: "wardrobe", quote: "grey hoodie" },
      { checkId: "age_build", quote: "lean man" },
    ]);
    expect(spans.map((s) => s.start)).toEqual([2, 57]);
  });

  it("rejects an empty quote", () => {
    const { unverified } = verifySpans(description, [{ checkId: "wardrobe", quote: "  " }]);
    expect(unverified[0]!.reason).toBe("not_found");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/enforce/verifySpans.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

`apps/backend/src/enforce/verifySpans.ts`:

```typescript
export type Span = {
  spanId: string;
  checkId: string;
  quote: string;
  start: number;
  end: number;
};

export type UnverifiedQuote = {
  checkId: string;
  quote: string;
  reason: "not_found" | "ambiguous";
};

export function verifySpans(
  description: string,
  quotes: Array<{ checkId: string; quote: string }>,
): { spans: Span[]; unverified: UnverifiedQuote[] } {
  const spans: Span[] = [];
  const unverified: UnverifiedQuote[] = [];
  const perCheckCount = new Map<string, number>();

  for (const { checkId, quote } of quotes) {
    const trimmed = quote.trim();
    if (trimmed.length === 0) {
      unverified.push({ checkId, quote, reason: "not_found" });
      continue;
    }
    const first = description.indexOf(trimmed);
    if (first === -1) {
      unverified.push({ checkId, quote, reason: "not_found" });
      continue;
    }
    if (description.indexOf(trimmed, first + 1) !== -1) {
      unverified.push({ checkId, quote, reason: "ambiguous" });
      continue;
    }
    const index = perCheckCount.get(checkId) ?? 0;
    perCheckCount.set(checkId, index + 1);
    spans.push({
      spanId: `${checkId}:${index}`,
      checkId,
      quote: trimmed,
      start: first,
      end: first + trimmed.length,
    });
  }

  spans.sort((a, b) => a.start - b.start);
  const kept: Span[] = [];
  for (const span of spans) {
    const previous = kept[kept.length - 1];
    if (previous && span.start < previous.end) {
      unverified.push({ checkId: span.checkId, quote: span.quote, reason: "ambiguous" });
      continue;
    }
    kept.push(span);
  }
  return { spans: kept, unverified };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/backend/tests/enforce/verifySpans.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: verify quoted spans verbatim and compute offsets in code"
```

---

### Task 4: Splice with byte-identity assertion, and the two code-checked invariants

**Files:**
- Create: `apps/backend/src/enforce/splice.ts`, `apps/backend/src/enforce/invariants.ts`
- Test: `apps/backend/tests/enforce/splice.test.ts`, `apps/backend/tests/enforce/invariants.test.ts`

**Added to this task to close a spec gap.** Spec §3 names two invariants that are "checked by code,
not by a model, because code compares strings exactly": `byte_identical` and
`negative_constraint_present`. The splice below is the first. The second has no other home in this
plan, and it belongs beside the splice because both are string comparisons the model never sees.

`negative_constraint_present` checks that the identity-drift negative line is present, following
Higgsfield's "Continuity: Characters, props, environment identical across every cut. No identity
drift." It is not one of the nine rubric checks and must never be scored as a band — it is a boolean
invariant reported alongside them. Spec §11 records it as an open question whether this line belongs
to the character block or the stage prompt; v1 checks it on the block, and that open question is why
it is a separate boolean rather than a tenth check.

Write `apps/backend/tests/enforce/invariants.test.ts` first:

```typescript
import { describe, expect, it } from "vitest";
import { hasNegativeConstraint, NEGATIVE_CONSTRAINT_PATTERNS } from "../../src/enforce/invariants.js";

describe("hasNegativeConstraint", () => {
  it("accepts the canonical continuity line", () => {
    expect(
      hasNegativeConstraint(
        "Male, 30, lean. Continuity: characters, props, environment identical across every cut. No identity drift.",
      ),
    ).toBe(true);
  });

  it("accepts the shorter form that names identity drift alone", () => {
    expect(hasNegativeConstraint("Male, 30, lean. No identity drift between shots.")).toBe(true);
  });

  it("is case and whitespace insensitive, because writers do not retype it exactly", () => {
    expect(hasNegativeConstraint("male, 30.  NO   IDENTITY   DRIFT.")).toBe(true);
  });

  it("rejects a description with no negative constraint at all", () => {
    expect(hasNegativeConstraint("Male, Latino, around 30, lean and tall.")).toBe(false);
  });

  it("does not accept the mere word continuity without the constraint", () => {
    expect(hasNegativeConstraint("He has continuity of style across his wardrobe.")).toBe(false);
  });

  it("exposes the patterns it matched on, so the UI can say which form it found", () => {
    expect(NEGATIVE_CONSTRAINT_PATTERNS.length).toBeGreaterThan(0);
  });
});
```

Then implement `hasNegativeConstraint(description: string): boolean` over a small, exported array of
regular expressions, normalising whitespace and case before testing. Keep the patterns few and
literal; a clever regex that matches paraphrases would be exactly the model-judgement this invariant
exists to avoid.

**Interfaces:**
- Consumes: `Span` from Task 3.
- Produces: `type Replacement = { spanId: string; newText: string }`, `applyReplacements(description: string, spans: Span[], replacements: Replacement[]): string`, throws `SpliceError`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/enforce/splice.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { applyReplacements } from "../../src/enforce/splice.js";
import { verifySpans } from "../../src/enforce/verifySpans.js";

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

describe("applyReplacements", () => {
  it("replaces only the quoted span", () => {
    const { spans } = verifySpans(description, [
      { checkId: "drawable_only", quote: "very cinematic presence" },
    ]);
    const out = applyReplacements(description, spans, [
      { spanId: "drawable_only:0", newText: "square jaw and a chipped left incisor" },
    ]);
    expect(out).toBe(
      "A lean man, late 20s, with a square jaw and a chipped left incisor and grey hoodie.",
    );
  });

  it("leaves the untouched text byte-identical", () => {
    const { spans } = verifySpans(description, [{ checkId: "wardrobe", quote: "grey hoodie" }]);
    const out = applyReplacements(description, spans, [
      { spanId: "wardrobe:0", newText: "charcoal hoodie, zip half open, white low-top sneakers" },
    ]);
    expect(out.startsWith("A lean man, late 20s, with a very cinematic presence and ")).toBe(true);
    expect(out.endsWith(".")).toBe(true);
  });

  it("applies two replacements without offset drift", () => {
    const { spans } = verifySpans(description, [
      { checkId: "age_build", quote: "lean man" },
      { checkId: "wardrobe", quote: "grey hoodie" },
    ]);
    const out = applyReplacements(description, spans, [
      { spanId: "age_build:0", newText: "lean man of 178cm" },
      { spanId: "wardrobe:0", newText: "charcoal hoodie and white sneakers" },
    ]);
    expect(out).toContain("lean man of 178cm");
    expect(out).toContain("charcoal hoodie and white sneakers");
  });

  it("throws when a replacement names an unknown span", () => {
    expect(() => applyReplacements(description, [], [{ spanId: "nope:0", newText: "x" }])).toThrow(
      /unknown spanId nope:0/,
    );
  });

  it("throws when a replacement is empty", () => {
    const { spans } = verifySpans(description, [{ checkId: "wardrobe", quote: "grey hoodie" }]);
    expect(() => applyReplacements(description, spans, [{ spanId: "wardrobe:0", newText: " " }])).toThrow(
      /empty replacement/,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/enforce/splice.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

`apps/backend/src/enforce/splice.ts`:

```typescript
import type { Span } from "./verifySpans.js";

export type Replacement = { spanId: string; newText: string };

export class SpliceError extends Error {}

export function applyReplacements(
  description: string,
  spans: Span[],
  replacements: Replacement[],
): string {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const ordered: Array<{ span: Span; newText: string }> = [];

  for (const replacement of replacements) {
    const span = byId.get(replacement.spanId);
    if (!span) throw new SpliceError(`unknown spanId ${replacement.spanId}`);
    if (replacement.newText.trim().length === 0) {
      throw new SpliceError(`empty replacement for ${replacement.spanId}`);
    }
    ordered.push({ span, newText: replacement.newText });
  }

  ordered.sort((a, b) => a.span.start - b.span.start);

  let out = "";
  let cursor = 0;
  const untouched: string[] = [];
  for (const { span, newText } of ordered) {
    untouched.push(description.slice(cursor, span.start));
    out += description.slice(cursor, span.start) + newText;
    cursor = span.end;
  }
  untouched.push(description.slice(cursor));
  out += description.slice(cursor);

  // Defence in depth: every region we did not replace must survive byte-identical.
  let check = "";
  let checkCursor = 0;
  for (const { span } of ordered) {
    check += description.slice(checkCursor, span.start);
    checkCursor = span.end;
  }
  check += description.slice(checkCursor);
  if (check !== untouched.join("")) {
    throw new SpliceError("untouched text changed during splice");
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/backend/tests/enforce/splice.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: splice replacements into quoted spans only, asserting the rest"
```

---

### Task 5: Evaluator schema and prompt

**Files:**
- Create: `apps/backend/src/agents/evaluator/schema.ts`, `apps/backend/src/agents/evaluator/prompt.ts`
- Test: `apps/backend/tests/agents/evaluator/prompt.test.ts`

**Interfaces:**
- Consumes: `Rubric`, `RubricCheck`, `CheckGroup`, `checksForGroup` from Task 2.
- Produces: `EvaluatorGroupOutputSchema`, `type EvaluatorGroupOutput = { results: Array<{ checkId: string; band: 1|2|3|4|5; reason: string; quotes: string[] }> }`, `buildEvaluatorSystemPrompt(rubric: Rubric, group: CheckGroup): string`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/agents/evaluator/prompt.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildEvaluatorSystemPrompt } from "../../../src/agents/evaluator/prompt.js";
import { EvaluatorGroupOutputSchema } from "../../../src/agents/evaluator/schema.js";
import { loadRubric } from "../../../src/rubric/load.js";

describe("evaluator prompt", () => {
  it("includes only the checks of the requested group", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "safety");
    expect(prompt).toContain("no_real_person");
    expect(prompt).toContain("no_brand_name");
    expect(prompt).not.toContain("hair_spec");
  });

  it("states the verbatim-quote rule and the no-rewrite rule", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "look");
    expect(prompt).toMatch(/copied character for character/i);
    expect(prompt).toMatch(/never rewrite/i);
  });

  it("prints every band definition so the score has an anchor", async () => {
    const rubric = await loadRubric("v1");
    const prompt = buildEvaluatorSystemPrompt(rubric, "drawable");
    expect(prompt).toContain("Band 1:");
    expect(prompt).toContain("Band 5:");
  });
});

describe("evaluator schema", () => {
  it("accepts a well-formed group result", () => {
    const parsed = EvaluatorGroupOutputSchema.parse({
      results: [{ checkId: "no_brand_name", band: 5, reason: "No brand appears.", quotes: [] }],
    });
    expect(parsed.results[0]!.band).toBe(5);
  });

  it("rejects a band outside 1 to 5", () => {
    expect(() =>
      EvaluatorGroupOutputSchema.parse({
        results: [{ checkId: "x", band: 7, reason: "r", quotes: [] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/agents/evaluator/prompt.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the schema**

`apps/backend/src/agents/evaluator/schema.ts`:

```typescript
import { z } from "zod";

export const EvaluatorCheckResultSchema = z.object({
  checkId: z.string(),
  band: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  reason: z.string(),
  quotes: z.array(z.string()),
});

export const EvaluatorGroupOutputSchema = z.object({
  results: z.array(EvaluatorCheckResultSchema),
});

export type EvaluatorCheckResult = z.infer<typeof EvaluatorCheckResultSchema>;
export type EvaluatorGroupOutput = z.infer<typeof EvaluatorGroupOutputSchema>;
```

- [ ] **Step 4: Write the prompt builder**

`apps/backend/src/agents/evaluator/prompt.ts`:

```typescript
import { checksForGroup, type CheckGroup, type Rubric } from "../../rubric/load.js";

export function buildEvaluatorSystemPrompt(rubric: Rubric, group: CheckGroup): string {
  const checks = checksForGroup(rubric, group);
  const rendered = checks
    .map((check) => {
      const bands = ([1, 2, 3, 4, 5] as const)
        .map((n) => `  Band ${n}: ${check.bands[String(n) as "1"]}`)
        .join("\n");
      return `Check ${check.id} - ${check.title}\n  Pass test: ${check.passTest}\n${bands}`;
    })
    .join("\n\n");

  return [
    "You score one character description that will be sent to a text-to-video model.",
    "The model cannot receive a photograph of the character, so this text is the only channel the character's identity has.",
    "",
    `Score only these checks, from rubric ${rubric.version}:`,
    "",
    rendered,
    "",
    "Rules:",
    "1. For each check, choose the single band whose definition matches the description. Do not invent intermediate scores.",
    "2. For any band below 4, quotes must contain the offending words copied character for character from the description. No paraphrase, no ellipsis, no added punctuation. If you cannot copy an exact fragment, use band 4 or above.",
    "3. For band 4 or 5, quotes must be an empty array.",
    "4. Never rewrite, improve, or suggest replacement wording. Another agent does that.",
    "5. reason is one sentence, naming the observable fact behind the band.",
  ].join("\n");
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/backend/tests/agents/evaluator/prompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: evaluator output schema and per-group system prompt"
```

---

### Task 6: Evaluator call with injectable transport

**Files:**
- Create: `apps/backend/src/api/client.ts`, `apps/backend/src/agents/evaluator/run.ts`
- Test: `apps/backend/tests/agents/evaluator/run.test.ts`

**Interfaces:**
- Consumes: Task 2 rubric, Task 5 schema and prompt.
**Failure granularity, added after the Task 5 review.** The quotes-required-below-band-4 rule is NOT
enforced by the schema. `zodOutputFormat()` cannot express a zod `.refine()` in the JSON Schema handed
to the model, so a refinement fires only at parse time and turns one malformed check into a null
`parsed_output` — losing every check in that group call, and with `Promise.all`, all nine.

Enforce it here instead, per check, mirroring the pattern the spec already uses for span verification
("marked `unverified`, excluded from repair, and logged as prompt-tuning signal"):

1. After a group parse succeeds, a check with `band < 4` and an empty `quotes` array is marked as
   having no verifiable evidence — keep its band and reason, set a `missingEvidence` boolean, and
   exclude it from repair downstream. It is not a parse failure.
2. `evaluateAllGroups` uses `Promise.allSettled`, never `Promise.all`. One group failing must not
   lose the other two.
3. A group that rejects or returns a null parse has its checks returned in an explicit
   "not evaluated" state, distinguishable from both pass and fail. Never omit them, never default
   them to a passing band, never return a short array. A check with no result must say so — the
   product's claim is that every score traces to evidence, and a missing result silently reading as a
   good one would break that claim at the one moment it matters.

Test all three: a transport that rejects, a parse that returns null, and a single check returning
band 3 with no quotes. In each case assert the other groups' results survive intact and that nothing
reports as passed.

- Produces: `type ParseTransport = (args: { system: string; user: string; schema: unknown }) => Promise<{ parsed_output: unknown }>`, `createAnthropicTransport(model?: string): ParseTransport`, `evaluateGroup(deps: { transport: ParseTransport }, args: { rubric: Rubric; group: CheckGroup; description: string }): Promise<EvaluatorGroupOutput>`, `evaluateAllGroups(deps, args: { rubric: Rubric; description: string }): Promise<EvaluatorCheckResult[]>`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/agents/evaluator/run.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { evaluateAllGroups, evaluateGroup } from "../../../src/agents/evaluator/run.js";
import { loadRubric } from "../../../src/rubric/load.js";

const ok = (results: unknown) => vi.fn().mockResolvedValue({ parsed_output: { results } });

describe("evaluateGroup", () => {
  it("returns the parsed results", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([
      { checkId: "no_real_person", band: 5, reason: "No real person.", quotes: [] },
      { checkId: "no_brand_name", band: 5, reason: "No brand.", quotes: [] },
    ]);
    const out = await evaluateGroup({ transport }, { rubric, group: "safety", description: "x" });
    expect(out.results).toHaveLength(2);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("throws when parsing failed rather than returning null", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/parse failed/);
  });

  it("throws when the model scores a check outside the group", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([{ checkId: "hair_spec", band: 5, reason: "r", quotes: [] }]);
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/unexpected checkId hair_spec/);
  });

  it("throws when a check of the group is missing", async () => {
    const rubric = await loadRubric("v1");
    const transport = ok([{ checkId: "no_brand_name", band: 5, reason: "r", quotes: [] }]);
    await expect(
      evaluateGroup({ transport }, { rubric, group: "safety", description: "x" }),
    ).rejects.toThrow(/missing result for no_real_person/);
  });
});

describe("evaluateAllGroups", () => {
  it("runs three calls and returns nine results", async () => {
    const rubric = await loadRubric("v1");
    const transport = vi.fn(async ({ system }: { system: string }) => ({
      parsed_output: {
        results: rubric.checks
          .filter((check) => system.includes(`Check ${check.id} `))
          .map((check) => ({ checkId: check.id, band: 5, reason: "r", quotes: [] })),
      },
    }));
    const results = await evaluateAllGroups({ transport }, { rubric, description: "x" });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/agents/evaluator/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the transport**

`apps/backend/src/api/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

export const DEFAULT_MODEL = "claude-opus-5";

export type ParseTransport = (args: {
  system: string;
  user: string;
  schema: ZodType;
}) => Promise<{ parsed_output: unknown }>;

export function createAnthropicTransport(model: string = DEFAULT_MODEL): ParseTransport {
  const client = new Anthropic();
  return async ({ system, user, schema }) => {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(schema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return { parsed_output: response.parsed_output };
  };
}
```

If the installed SDK types reject `betas`/`fallbacks` on `messages.parse`, move both to `client.beta.messages.parse` and keep the rest identical; the compiler error names the right path.

- [ ] **Step 4: Write the evaluator run**

`apps/backend/src/agents/evaluator/run.ts`:

```typescript
import type { ParseTransport } from "../../api/client.js";
import { checksForGroup, type CheckGroup, type Rubric } from "../../rubric/load.js";
import { buildEvaluatorSystemPrompt } from "./prompt.js";
import {
  type EvaluatorCheckResult,
  type EvaluatorGroupOutput,
  EvaluatorGroupOutputSchema,
} from "./schema.js";

export async function evaluateGroup(
  deps: { transport: ParseTransport },
  args: { rubric: Rubric; group: CheckGroup; description: string },
): Promise<EvaluatorGroupOutput> {
  const { rubric, group, description } = args;
  const system = buildEvaluatorSystemPrompt(rubric, group);
  const { parsed_output } = await deps.transport({
    system,
    user: `Character description to score:\n\n${description}`,
    schema: EvaluatorGroupOutputSchema,
  });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error(`evaluator parse failed for group ${group}`);
  }
  const output = EvaluatorGroupOutputSchema.parse(parsed_output);

  const expected = new Set(checksForGroup(rubric, group).map((check) => check.id));
  for (const result of output.results) {
    if (!expected.has(result.checkId)) {
      throw new Error(`unexpected checkId ${result.checkId} in group ${group}`);
    }
  }
  const returned = new Set(output.results.map((result) => result.checkId));
  for (const id of expected) {
    if (!returned.has(id)) throw new Error(`missing result for ${id} in group ${group}`);
  }
  return output;
}

export async function evaluateAllGroups(
  deps: { transport: ParseTransport },
  args: { rubric: Rubric; description: string },
): Promise<EvaluatorCheckResult[]> {
  const groups: CheckGroup[] = ["look", "safety", "drawable"];
  const outputs = await Promise.all(
    groups.map((group) => evaluateGroup(deps, { ...args, group })),
  );
  return outputs.flatMap((output) => output.results);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/backend/tests/agents/evaluator/run.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: evaluator runs three concurrent group calls with strict result checks"
```

---

### Task 7: Repairer schema, prompt, and call

**Files:**
- Create: `apps/backend/src/agents/repairer/schema.ts`, `apps/backend/src/agents/repairer/prompt.ts`, `apps/backend/src/agents/repairer/run.ts`
- Test: `apps/backend/tests/agents/repairer/run.test.ts`

**Interfaces:**
- Consumes: `Span` (Task 3), `Replacement` (Task 4), `ParseTransport` (Task 6), `RubricCheck` (Task 2).
- Produces: `RepairerOutputSchema`, `buildRepairerSystemPrompt(checks: RubricCheck[]): string`, `repairSpans(deps: { transport: ParseTransport }, args: { spans: Span[]; checks: RubricCheck[]; reasons: Record<string, string> }): Promise<{ replacements: Replacement[]; rejected: RejectedReplacement[] }>`, `type RejectedReplacement = { spanId: string; reason: "unknown_span" | "empty_text" }`.

**Failure granularity, corrected after implementation.** An earlier draft of this task had
`repairSpans` throw on an unknown `spanId` or an empty `newText`, discarding the whole batch. That is
wrong, and it is inconsistent with every other failure path in this pipeline.

The rule everywhere else is: mark the bad item, exclude it, keep the rest, log it as prompt-tuning
signal. `verifySpans` does it for a quote it cannot locate. Task 6 does it for a check with missing
evidence and for a whole group that fails. `repairSpans` does the same:

- A replacement naming a `spanId` that was not sent is **dropped**, recorded in `rejected` with
  reason `unknown_span`, and the remaining replacements are returned and applied. It is safe to apply
  them: the splice validates every replacement against known spans regardless, and the dropped span is
  simply not repaired this pass. The next pass re-evaluates and quotes it again if it is still wrong.
- A replacement with an empty `newText` is **dropped** the same way, with reason `empty_text`. Remove
  the `.min(1)` from the schema field so this is a code decision rather than a parse failure, for the
  same reason the Evaluator's quotes rule moved out of its schema in Task 5.

Throwing costs a whole repair pass out of only three because the model hallucinated one id. Dropping
costs one span for one pass. The `rejected` array is what stops that being silent: the orchestrator
logs it, and a repairer that regularly invents span ids is a prompt defect the run should surface.

**Open question recorded, not decided here:** whether an empty `newText` should instead be treated as
a legitimate *deletion* — removing "Nike " from "a Nike hoodie" is a valid repair for `no_brand_name`.
v1 rejects it, because a deletion can leave doubled spaces and broken grammar that nothing in the
pipeline checks. Revisit with the rubric v2 work.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/agents/repairer/run.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { repairSpans } from "../../../src/agents/repairer/run.js";
import { loadRubric } from "../../../src/rubric/load.js";

const spans = [
  { spanId: "drawable_only:0", checkId: "drawable_only", quote: "very cinematic presence", start: 22, end: 45 },
];

describe("repairSpans", () => {
  it("returns one replacement per span", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: {
        replacements: [
          { spanId: "drawable_only:0", newText: "square jaw", rationale: "replaced a mood word" },
        ],
      },
    });
    const out = await repairSpans({ transport }, { spans, checks, reasons: { "drawable_only:0": "mood word" } });
    expect(out).toEqual([{ spanId: "drawable_only:0", newText: "square jaw" }]);
  });

  it("never sends the full description to the model", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: { replacements: [{ spanId: "drawable_only:0", newText: "square jaw", rationale: "r" }] },
    });
    await repairSpans({ transport }, { spans, checks, reasons: {} });
    const call = transport.mock.calls[0]![0] as { user: string };
    expect(call.user).toContain("very cinematic presence");
    expect(call.user).not.toContain("A lean man, late 20s");
  });

  it("throws when the model invents a spanId", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({
      parsed_output: { replacements: [{ spanId: "wardrobe:9", newText: "x", rationale: "r" }] },
    });
    await expect(
      repairSpans({ transport }, { spans, checks, reasons: {} }),
    ).rejects.toThrow(/unknown spanId wardrobe:9/);
  });

  it("throws when parsing failed", async () => {
    const rubric = await loadRubric("v1");
    const checks = rubric.checks.filter((c) => c.id === "drawable_only");
    const transport = vi.fn().mockResolvedValue({ parsed_output: null });
    await expect(repairSpans({ transport }, { spans, checks, reasons: {} })).rejects.toThrow(
      /parse failed/,
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/agents/repairer/run.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write schema, prompt, and run**

`apps/backend/src/agents/repairer/schema.ts`:

```typescript
import { z } from "zod";

export const RepairerOutputSchema = z.object({
  replacements: z.array(
    z.object({
      spanId: z.string(),
      newText: z.string().min(1),
      rationale: z.string(),
    }),
  ),
});

export type RepairerOutput = z.infer<typeof RepairerOutputSchema>;
```

`apps/backend/src/agents/repairer/prompt.ts`:

```typescript
import type { RubricCheck } from "../../rubric/load.js";

export function buildRepairerSystemPrompt(checks: RubricCheck[]): string {
  const rendered = checks
    .map((check) => `${check.id} - ${check.title}\n  Pass test: ${check.passTest}\n  Band 5: ${check.bands["5"]}`)
    .join("\n\n");

  return [
    "You repair fragments of a character description for a text-to-video model.",
    "You are given only the fragments that failed a check, never the whole description.",
    "",
    "The checks these fragments failed:",
    "",
    rendered,
    "",
    "Rules:",
    "1. Return exactly one replacement per spanId you were given, and never a spanId you were not given.",
    "2. The replacement must read grammatically where the fragment sat, because code splices it back in unchanged.",
    "3. Replace with observable facts a video model can draw: countable features, named colours, named garments. No mood words, no feelings, no camera or lighting instructions.",
    "4. Never name a real person and never name a brand.",
    "5. Keep the replacement close in length to the fragment unless the check requires more detail.",
  ].join("\n");
}
```

`apps/backend/src/agents/repairer/run.ts`:

```typescript
import type { ParseTransport } from "../../api/client.js";
import type { Replacement } from "../../enforce/splice.js";
import type { Span } from "../../enforce/verifySpans.js";
import type { RubricCheck } from "../../rubric/load.js";
import { buildRepairerSystemPrompt } from "./prompt.js";
import { RepairerOutputSchema } from "./schema.js";

export async function repairSpans(
  deps: { transport: ParseTransport },
  args: { spans: Span[]; checks: RubricCheck[]; reasons: Record<string, string> },
): Promise<Replacement[]> {
  const { spans, checks, reasons } = args;
  if (spans.length === 0) return [];

  const user = spans
    .map(
      (span) =>
        `spanId: ${span.spanId}\ncheck: ${span.checkId}\nwhy it failed: ${reasons[span.spanId] ?? "below pass band"}\nfragment: ${span.quote}`,
    )
    .join("\n\n");

  const { parsed_output } = await deps.transport({
    system: buildRepairerSystemPrompt(checks),
    user,
    schema: RepairerOutputSchema,
  });
  if (parsed_output === null || parsed_output === undefined) {
    throw new Error("repairer parse failed");
  }
  const output = RepairerOutputSchema.parse(parsed_output);

  const known = new Set(spans.map((span) => span.spanId));
  for (const replacement of output.replacements) {
    if (!known.has(replacement.spanId)) {
      throw new Error(`unknown spanId ${replacement.spanId} from repairer`);
    }
  }
  return output.replacements.map(({ spanId, newText }) => ({ spanId, newText }));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/backend/tests/agents/repairer/run.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: repairer rewrites only the fragments it is handed"
```

---

### Task 8: Run store

**Files:**
- Create: `apps/backend/src/store/RunStore.ts`, `apps/backend/src/store/FileRunStore.ts`
- Test: `apps/backend/tests/store/FileRunStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type RunManifest = { runId: string; rubricVersion: string; model: string; status: RunStatus; startedAt: string; finishedAt?: string; passes: number }`, `type RunStatus = "running" | "passed" | "improved_still_failing" | "no_improvement" | "failed"`, `interface RunStore { createRun(m: RunManifest): Promise<void>; writePass(runId: string, pass: number, kind: "eval" | "repair", payload: unknown): Promise<void>; finishRun(runId: string, status: RunStatus, passes: number): Promise<void>; getRun(runId: string): Promise<RunManifest>; listRuns(): Promise<RunManifest[]> }`, `class FileRunStore implements RunStore` with constructor `(root: string)`.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/store/FileRunStore.test.ts`:

```typescript
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileRunStore } from "../../src/store/FileRunStore.js";

const manifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "running" as const,
  startedAt: "2026-09-10T10:00:00.000Z",
  passes: 0,
};

describe("FileRunStore", () => {
  it("writes a manifest and reads it back", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "runs-"));
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    expect((await store.getRun("run-1")).rubricVersion).toBe("v1");
  });

  it("writes one file per pass and kind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "runs-"));
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.writePass("run-1", 1, "eval", { results: [] });
    const raw = await readFile(path.join(root, "run-1", "pass-1-eval.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ results: [] });
  });

  it("records the terminal status and pass count", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "runs-"));
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.finishRun("run-1", "improved_still_failing", 3);
    const saved = await store.getRun("run-1");
    expect(saved.status).toBe("improved_still_failing");
    expect(saved.passes).toBe(3);
    expect(saved.finishedAt).toBeTruthy();
  });

  it("lists runs newest first", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "runs-"));
    const store = new FileRunStore(root);
    await store.createRun(manifest);
    await store.createRun({ ...manifest, runId: "run-2", startedAt: "2026-09-10T11:00:00.000Z" });
    expect((await store.listRuns()).map((r) => r.runId)).toEqual(["run-2", "run-1"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/store/FileRunStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the interface and implementation**

`apps/backend/src/store/RunStore.ts`:

```typescript
export type RunStatus =
  | "running"
  | "passed"
  | "improved_still_failing"
  | "no_improvement"
  | "failed";

export type RunManifest = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  passes: number;
};

export interface RunStore {
  createRun(manifest: RunManifest): Promise<void>;
  writePass(runId: string, pass: number, kind: "eval" | "repair", payload: unknown): Promise<void>;
  finishRun(runId: string, status: RunStatus, passes: number): Promise<void>;
  getRun(runId: string): Promise<RunManifest>;
  listRuns(): Promise<RunManifest[]>;
}
```

`apps/backend/src/store/FileRunStore.ts`:

```typescript
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunManifest, RunStatus, RunStore } from "./RunStore.js";

export class FileRunStore implements RunStore {
  constructor(private readonly root: string) {}

  private dir(runId: string): string {
    return path.join(this.root, runId);
  }

  async createRun(manifest: RunManifest): Promise<void> {
    await mkdir(this.dir(manifest.runId), { recursive: true });
    await this.save(manifest);
  }

  async writePass(
    runId: string,
    pass: number,
    kind: "eval" | "repair",
    payload: unknown,
  ): Promise<void> {
    await mkdir(this.dir(runId), { recursive: true });
    await writeFile(
      path.join(this.dir(runId), `pass-${pass}-${kind}.json`),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  }

  async finishRun(runId: string, status: RunStatus, passes: number): Promise<void> {
    const manifest = await this.getRun(runId);
    await this.save({ ...manifest, status, passes, finishedAt: new Date().toISOString() });
  }

  async getRun(runId: string): Promise<RunManifest> {
    const raw = await readFile(path.join(this.dir(runId), "manifest.json"), "utf8");
    return JSON.parse(raw) as RunManifest;
  }

  async listRuns(): Promise<RunManifest[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const manifests = await Promise.all(
      entries.filter((e) => e.isDirectory()).map((e) => this.getRun(e.name)),
    );
    return manifests.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async save(manifest: RunManifest): Promise<void> {
    await writeFile(
      path.join(this.dir(manifest.runId), "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/backend/tests/store/FileRunStore.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: file-backed run store behind a swappable interface"
```

---

### Task 9: Orchestrator with three passes and honest terminal states

**Files:**
- Create: `apps/backend/src/orchestrate/runPass.ts`, `apps/backend/src/orchestrate/runToCompletion.ts`
- Test: `apps/backend/tests/orchestrate/runToCompletion.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 4, 6, 7, 8.

**Interface change from Task 6, confirmed by its review.** `evaluateAllGroups` does NOT return a flat
`EvaluatorCheckResult[]`. It returns `EvaluatedCheck[]`, a discriminated union on `status`:

```typescript
type EvaluatedCheck =
  | { status: "scored"; checkId: CheckId; band: Band; reason: string; quotes: string[]; missingEvidence: boolean }
  | { status: "not_evaluated"; checkId: CheckId; reason: string };
```

The `not_evaluated` branch deliberately carries no `band`, so a naive `r.band >= 4` filter is a
compile error rather than a silent pass. Do not widen, flatten or default this union to make consuming
it easier — that would reintroduce exactly the failure the shape exists to prevent. Narrow on `status`
and handle `not_evaluated` explicitly: such a check is neither passing nor failing, it has no result,
and `runToCompletion` must never count it toward a terminal `passed`.
- Produces: `type PassResult = { pass: number; description: string; results: EvaluatorCheckResult[]; failing: string[]; unverified: UnverifiedQuote[]; negativeConstraintPresent: boolean; repairedDescription?: string }`, `runPass(deps, args): Promise<PassResult>`, `runToCompletion(deps, args: { rubric: Rubric; description: string; runId: string; maxPasses?: number }): Promise<{ status: RunStatus; passes: PassResult[]; finalDescription: string }>`.

**Six corrections from the Task 9 review. These supersede the reference loop below where they differ.**

1. **`no_improvement` is classified by improvement, not by failing count.** UI design doc §6.2 is
   binding and fixes the banner's second line to "no fragment improved its band". Classifying on count
   alone makes that sentence false whenever a band rose without the failing set shrinking. Rule:
   `no_improvement` only when nothing improved — neither the failing set shrank nor any check's band
   rose between the first and last pass. Otherwise `improved_still_failing`.

2. **The early break must not fire on a transient group failure.** A pass with nothing repairable
   currently breaks the loop. That is correct when the state is genuinely unrepairable, and wrong when
   the cause is a `not_evaluated` check, which means a group *call* failed and may be transient. One
   API error on one of three parallel calls would otherwise report a passing description as
   `no_improvement` with zero re-attempts, and the retry cannot rescue it because a `not_evaluated`
   check produces no unverified quote. Rule: if there is nothing to repair but any check is
   `not_evaluated`, continue to the next pass and re-evaluate; only break when nothing is repairable
   and every check was actually evaluated.

3. **`PassResult` gains `notEvaluated: string[]`.** `failing` currently mixes "scored below band 4"
   with "never scored". That is correct for the `passed` gate, which must fold in both, but wrong as a
   display count — design doc §6.2 binds the banner numeral to "the count of checks still below band
   4", and a check with no band is not below 4. Keep `failing` as the gate, add `notEvaluated` so the
   presenter can render each honestly.

4. **Wrap the loop in an error boundary and finish `"failed"`.** There is no try/catch, and
   `RunStatus` already carries `"failed"` unused. A reachable path: `repairSpans` does not dedupe
   spanIds, so a model returning two replacements for one span passes its validation and then
   `applyReplacements` throws `SpliceError`. The exception escapes, `finishRun` is never called, and
   the run is stranded at `status: "running"` forever with the CLI showing a stack trace. Catch,
   call `finishRun(runId, "failed", passes)`, and rethrow or return the failure — but never leave an
   orphaned `running` manifest.

5. **`rejected` goes into the pass payload, not `console.warn`.** Task 7 returns `rejected` precisely
   so a repairer that invents span ids is *surfaced*. A console line reaches neither the CLI, the
   store, nor the UI, and when every replacement is rejected no repair file is written at all, so the
   failure leaves no trace. Put it in the pass's `repair` payload written through the store.

6. **Do not repair on the final pass.** If the last allowed pass evaluates and then repairs, the run
   returns text that nothing ever scored, while reporting scores that describe *different* text. Task
   17 highlighting `finalDescription` with that pass's spans would compute offsets into the wrong
   string, and the repair call is pure cost that is never measured. Rule: the final pass evaluates and
   stops. `finalDescription` is always the exact text the final scores describe. This product's claim
   is that every number traces to the words that produced it; handing back unscored text at the last
   step breaks that claim at the one place a user reads the result.

**Added to this task after review: choosing which spans the Repairer receives.** Task 3 now returns
every verified span, including spans that nest across checks, so two of them can cover the same
characters. The splice cannot apply both in one pass, and Task 4 throws if asked to. `runPass` is
where the subset is chosen.

Select a maximal non-overlapping set, by this order:

1. **Group priority: safety, then drawable, then look.** The safety checks exist so the model does
   not refuse the prompt, which is the product's reason to exist, so their evidence wins a collision.
2. **Longer span first** within the same group, because the longer quote carries more context for
   the Repairer.
3. **Lower start offset** as the final tiebreak, so the selection is deterministic and testable.

A span that loses a collision is **not** discarded and **not** marked unverified. It stays in the
pass result as a verified span, it still highlights in the UI, and it is simply not repaired this
pass. The next pass re-evaluates the spliced text and quotes it again if it is still a problem. That
is what the three-pass loop is for, and it means a deferred repair costs a pass rather than a finding.

Add to `apps/backend/tests/orchestrate/runToCompletion.test.ts`:

```typescript
it("sends the safety check's span to the repairer when it collides with a wardrobe span", async () => {
  // description contains "a Nike hoodie"; wardrobe quotes "Nike hoodie", no_brand_name quotes "Nike"
  // assert the repairer's input contains the no_brand_name span and not the wardrobe span
});

it("keeps the deferred span verified rather than marking it unverified", async () => {
  // assert the wardrobe span is still in PassResult.results[...].spans and absent from unverified
});

it("repairs the deferred span on a later pass once the collision is gone", async () => {
  // pass 1 repairs the brand name; pass 2's wardrobe quote no longer collides and is repaired
});
```

**Added to this task to close a spec gap: the quote-exactly retry.** Spec §5 specifies the full path,
and the plan previously stopped halfway through it:

> A quote that does not match verbatim gets one retry with an instruction to quote exactly, then is
> marked `unverified`, excluded from repair, and logged as prompt-tuning signal.

Task 3's `verifySpans` is pure and does the marking. The retry needs a second model call, so it lives
here, in `runPass`, which is the only place that holds both the transport and the verifier. Implement
it as: run the group call, verify the quotes, and if any came back unverified, make **exactly one**
re-ask for those checks only, with an instruction to quote verbatim from the description; verify the
new quotes; anything still unverified after that one retry stays unverified and is excluded from
repair. One retry, never a loop — a retry loop against a model that cannot quote would burn tokens
indefinitely, and the unverified count is itself the signal the spec wants logged.

Add these tests to `apps/backend/tests/orchestrate/runToCompletion.test.ts`, with a fake transport:

```typescript
it("re-asks once when a quote does not match verbatim", async () => {
  // transport returns a paraphrased quote on call 1 and an exact quote on call 2
  // assert the transport was called twice for that group, and the span is verified
});

it("gives up after exactly one retry and marks the quote unverified", async () => {
  // transport returns a paraphrase both times
  // assert exactly two calls for that group, the quote is in `unverified`,
  // and the repairer never receives it
});

it("does not retry a group whose quotes all verified first time", async () => {
  // assert exactly one call for that group
});

it("reports the negative-constraint invariant on every pass", async () => {
  // assert PassResult.negativeConstraintPresent is false for a description without the line
});
```

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/orchestrate/runToCompletion.test.ts`:

```typescript
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runToCompletion } from "../../src/orchestrate/runToCompletion.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileRunStore } from "../../src/store/FileRunStore.js";

const description = "A lean man, late 20s, with a very cinematic presence and grey hoodie.";

const allPass = (rubric: Awaited<ReturnType<typeof loadRubric>>) =>
  rubric.checks.map((c) => ({ checkId: c.id, band: 5 as const, reason: "r", quotes: [] }));

const failDrawable = (rubric: Awaited<ReturnType<typeof loadRubric>>) =>
  rubric.checks.map((c) =>
    c.id === "drawable_only"
      ? { checkId: c.id, band: 2 as const, reason: "mood word", quotes: ["very cinematic presence"] }
      : { checkId: c.id, band: 5 as const, reason: "r", quotes: [] },
  );

async function store() {
  return new FileRunStore(await mkdtemp(path.join(tmpdir(), "runs-")));
}

describe("runToCompletion", () => {
  it("stops after one pass when everything passes", async () => {
    const rubric = await loadRubric("v1");
    const evaluate = vi.fn().mockResolvedValue(allPass(rubric));
    const repair = vi.fn();
    const out = await runToCompletion(
      { evaluate, repair, store: await store() },
      { rubric, description, runId: "run-1" },
    );
    expect(out.status).toBe("passed");
    expect(out.passes).toHaveLength(1);
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs, re-scores, and passes on the second pass", async () => {
    const rubric = await loadRubric("v1");
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(failDrawable(rubric))
      .mockResolvedValueOnce(allPass(rubric));
    const repair = vi
      .fn()
      .mockResolvedValue([{ spanId: "drawable_only:0", newText: "a square jaw" }]);
    const out = await runToCompletion(
      { evaluate, repair, store: await store() },
      { rubric, description, runId: "run-2" },
    );
    expect(out.status).toBe("passed");
    expect(out.passes).toHaveLength(2);
    expect(out.finalDescription).toContain("a square jaw");
    expect(out.finalDescription).not.toContain("very cinematic presence");
  });

  it("gives up after three passes and says it still fails", async () => {
    const rubric = await loadRubric("v1");
    const evaluate = vi.fn().mockResolvedValue(failDrawable(rubric));
    const repair = vi
      .fn()
      .mockResolvedValue([{ spanId: "drawable_only:0", newText: "very cinematic presence" }]);
    const out = await runToCompletion(
      { evaluate, repair, store: await store() },
      { rubric, description, runId: "run-3" },
    );
    expect(out.passes).toHaveLength(3);
    expect(out.status).toBe("no_improvement");
  });

  it("reports improved_still_failing when the failing set shrinks but is not empty", async () => {
    const rubric = await loadRubric("v1");
    const twoFail = rubric.checks.map((c) =>
      c.id === "drawable_only"
        ? { checkId: c.id, band: 2 as const, reason: "m", quotes: ["very cinematic presence"] }
        : c.id === "wardrobe"
          ? { checkId: c.id, band: 2 as const, reason: "w", quotes: ["grey hoodie"] }
          : { checkId: c.id, band: 5 as const, reason: "r", quotes: [] },
    );
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce(twoFail)
      .mockResolvedValue(failDrawable(rubric));
    const repair = vi.fn().mockResolvedValue([
      { spanId: "drawable_only:0", newText: "very cinematic presence" },
      { spanId: "wardrobe:0", newText: "charcoal hoodie and white sneakers" },
    ]);
    const out = await runToCompletion(
      { evaluate, repair, store: await store() },
      { rubric, description, runId: "run-4" },
    );
    expect(out.status).toBe("improved_still_failing");
  });

  it("writes an eval file per pass to the store", async () => {
    const rubric = await loadRubric("v1");
    const s = await store();
    const spy = vi.spyOn(s, "writePass");
    const evaluate = vi.fn().mockResolvedValue(allPass(rubric));
    await runToCompletion(
      { evaluate, repair: vi.fn(), store: s },
      { rubric, description, runId: "run-5" },
    );
    expect(spy).toHaveBeenCalledWith("run-5", 1, "eval", expect.anything());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/orchestrate/runToCompletion.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write runPass**

`apps/backend/src/orchestrate/runPass.ts`:

```typescript
import type { EvaluatorCheckResult } from "../agents/evaluator/schema.js";
import { isPass } from "../enforce/score.js";
import { applyReplacements, type Replacement } from "../enforce/splice.js";
import { verifySpans, type Span, type UnverifiedQuote } from "../enforce/verifySpans.js";
import type { Rubric } from "../rubric/load.js";

export type PassResult = {
  pass: number;
  description: string;
  results: EvaluatorCheckResult[];
  failing: string[];
  unverified: UnverifiedQuote[];
  repairedDescription?: string;
};

export type EvaluateFn = (args: {
  rubric: Rubric;
  description: string;
}) => Promise<EvaluatorCheckResult[]>;

export type RepairFn = (args: {
  spans: Span[];
  rubric: Rubric;
  reasons: Record<string, string>;
}) => Promise<Replacement[]>;

export async function runPass(
  deps: { evaluate: EvaluateFn; repair: RepairFn },
  args: { rubric: Rubric; description: string; pass: number },
): Promise<PassResult> {
  const { rubric, description, pass } = args;
  const results = await deps.evaluate({ rubric, description });
  const failingResults = results.filter((result) => !isPass(result.band));
  const failing = failingResults.map((result) => result.checkId);

  const { spans, unverified } = verifySpans(
    description,
    failingResults.flatMap((result) =>
      result.quotes.map((quote) => ({ checkId: result.checkId, quote })),
    ),
  );

  const base: PassResult = { pass, description, results, failing, unverified };
  if (spans.length === 0) return base;

  const reasons: Record<string, string> = {};
  for (const span of spans) {
    const result = failingResults.find((r) => r.checkId === span.checkId);
    if (result) reasons[span.spanId] = result.reason;
  }

  const replacements = await deps.repair({ spans, rubric, reasons });
  return { ...base, repairedDescription: applyReplacements(description, spans, replacements) };
}
```

- [ ] **Step 4: Write runToCompletion**

`apps/backend/src/orchestrate/runToCompletion.ts`:

```typescript
import type { Rubric } from "../rubric/load.js";
import type { RunStatus, RunStore } from "../store/RunStore.js";
import { runPass, type EvaluateFn, type PassResult, type RepairFn } from "./runPass.js";

export const MAX_PASSES = 3;

export async function runToCompletion(
  deps: { evaluate: EvaluateFn; repair: RepairFn; store: RunStore },
  args: { rubric: Rubric; description: string; runId: string; maxPasses?: number },
): Promise<{ status: RunStatus; passes: PassResult[]; finalDescription: string }> {
  const { rubric, runId } = args;
  const maxPasses = args.maxPasses ?? MAX_PASSES;

  await deps.store.createRun({
    runId,
    rubricVersion: rubric.version,
    model: "claude-opus-5",
    status: "running",
    startedAt: new Date().toISOString(),
    passes: 0,
  });

  const passes: PassResult[] = [];
  let description = args.description;
  let firstFailingCount: number | null = null;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const result = await runPass(deps, { rubric, description, pass });
    passes.push(result);
    await deps.store.writePass(runId, pass, "eval", {
      description: result.description,
      results: result.results,
      failing: result.failing,
      unverified: result.unverified,
    });
    if (result.repairedDescription) {
      await deps.store.writePass(runId, pass, "repair", {
        from: result.description,
        to: result.repairedDescription,
      });
    }
    if (firstFailingCount === null) firstFailingCount = result.failing.length;

    if (result.failing.length === 0) {
      await deps.store.finishRun(runId, "passed", pass);
      return { status: "passed", passes, finalDescription: description };
    }
    if (!result.repairedDescription) break;
    description = result.repairedDescription;
  }

  const lastFailingCount = passes[passes.length - 1]!.failing.length;
  const status: RunStatus =
    firstFailingCount !== null && lastFailingCount < firstFailingCount
      ? "improved_still_failing"
      : "no_improvement";
  await deps.store.finishRun(runId, status, passes.length);
  return { status, passes, finalDescription: description };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/backend/tests/orchestrate/runToCompletion.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: three-pass loop with passed, improved-still-failing and no-improvement"
```

---

### Task 10: Scoring CLI

**Files:**
- Create: `apps/backend/src/cli/score.ts`
- Test: `apps/backend/tests/cli/score.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 7, 9.
- Produces: `formatPassResult(result: PassResult, rubric: Rubric): string`, `main(argv: string[]): Promise<number>`.

**You must wire the third orchestrator dependency.** Task 9's `runToCompletion` takes three deps, not
two: `evaluate`, `repair`, and `retryVerbatim`. The third exists because the quote-exactly retry has
to be scoped to a single group's transport call rather than a whole-run re-ask, and Task 9 left it
unwired because the real transport lives outside its file ownership. The CLI is the first caller that
constructs real dependencies, so it is the first place this must be satisfied.

`retryVerbatim` has the same shape as a single-group evaluate call. Build it from
`createAnthropicTransport` and `buildEvaluatorSystemPrompt(rubric, group)` exactly as the normal
group call is built, with the additional instruction that the model must quote verbatim from the
description. Do not fold it into `evaluate` — the retry asks a different question and Task 9's review
judged the separate seam correct.

**The review flagged that nothing in the repo forces this and neither half exists yet.** There is no
production `RetryVerbatimFn` anywhere, and `agents/evaluator/prompt.ts` carries no verbatim-quoting
instruction to build one from. You are writing both. Add a `buildVerbatimRetryPrompt(rubric, group)`
to `agents/evaluator/prompt.ts` — the group's normal prompt plus an explicit instruction to quote
exactly and only text that appears in the description — and test that it contains that instruction and
still contains only its own group's check ids.

If you find `runToCompletion` cannot be called without it, that is the point: a missing retry
dependency should be a compile error, not a silently skipped retry.

- [ ] **Step 1: Write the failing test**

`apps/backend/tests/cli/score.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { formatPassResult } from "../../src/cli/score.js";
import { loadRubric } from "../../src/rubric/load.js";

describe("formatPassResult", () => {
  it("prints every check as a percentage with its quote", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      {
        pass: 1,
        description: "A lean man with a very cinematic presence.",
        results: rubric.checks.map((c) =>
          c.id === "drawable_only"
            ? { checkId: c.id, band: 2 as const, reason: "mood word", quotes: ["very cinematic presence"] }
            : { checkId: c.id, band: 5 as const, reason: "fine", quotes: [] },
        ),
        failing: ["drawable_only"],
        unverified: [],
      },
      rubric,
    );
    expect(out).toContain("drawable_only");
    expect(out).toContain("40%");
    expect(out).toContain("very cinematic presence");
    expect(out).toContain("100%");
  });

  it("flags unverified quotes rather than hiding them", async () => {
    const rubric = await loadRubric("v1");
    const out = formatPassResult(
      {
        pass: 1,
        description: "x",
        results: rubric.checks.map((c) => ({ checkId: c.id, band: 5 as const, reason: "r", quotes: [] })),
        failing: [],
        unverified: [{ checkId: "wardrobe", quote: "paraphrased", reason: "not_found" }],
      },
      rubric,
    );
    expect(out).toMatch(/unverified quote/i);
    expect(out).toContain("paraphrased");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/cli/score.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the CLI**

`apps/backend/src/cli/score.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { repairSpans } from "../agents/repairer/run.js";
import { createAnthropicTransport } from "../api/client.js";
import { bandToPercent, isPass } from "../enforce/score.js";
import { loadRubric, type Rubric } from "../rubric/load.js";
import type { PassResult } from "../orchestrate/runPass.js";
import { runToCompletion } from "../orchestrate/runToCompletion.js";
import { FileRunStore } from "../store/FileRunStore.js";

export function formatPassResult(result: PassResult, rubric: Rubric): string {
  const lines = [`Pass ${result.pass}`, ""];
  for (const check of rubric.checks) {
    const scored = result.results.find((r) => r.checkId === check.id);
    if (!scored) continue;
    const mark = isPass(scored.band) ? "pass" : "FAIL";
    lines.push(
      `${bandToPercent(scored.band).toString().padStart(4)}%  ${mark}  ${check.id} - ${scored.reason}`,
    );
    for (const quote of scored.quotes) lines.push(`         quote: "${quote}"`);
  }
  if (result.unverified.length > 0) {
    lines.push("", "Unverified quotes (not found verbatim, excluded from repair):");
    for (const item of result.unverified) {
      lines.push(`  ${item.checkId}: "${item.quote}" (${item.reason})`);
    }
  }
  return lines.join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const file = argv[2];
  if (!file) {
    console.error("usage: npm run score -- <path-to-description.txt>");
    return 1;
  }
  const description = (await readFile(file, "utf8")).trim();
  const rubric = await loadRubric("v1");
  const transport = createAnthropicTransport();
  const store = new FileRunStore("data/runs");
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;

  const out = await runToCompletion(
    {
      store,
      evaluate: (args) => evaluateAllGroups({ transport }, args),
      repair: ({ spans, rubric: r, reasons }) =>
        repairSpans(
          { transport },
          {
            spans,
            reasons,
            checks: r.checks.filter((check) => spans.some((span) => span.checkId === check.id)),
          },
        ),
    },
    { rubric, description, runId },
  );

  for (const pass of out.passes) console.log(formatPassResult(pass, rubric), "\n");
  console.log(`status: ${out.status}`);
  console.log(`run: data/runs/${runId}`);
  if (out.finalDescription !== description) {
    console.log("\nfinal description:\n", out.finalDescription);
  }
  return out.status === "passed" ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/backend/tests/cli/score.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: score CLI printing per-check percentages, quotes and run path"
```

---

# Phase B — Interface

Phase B builds the three screens against fixtures. No network code exists yet: `FixtureRunClient`
satisfies the same `RunClient` interface that `HttpRunClient` will satisfy in Phase C, so the
screens never learn which one they are talking to. This is deliberate — the interface gets designed
and reviewed while the data is canned and cheap, and Phase C is then a swap rather than a rewrite.

Every Phase B task cites a section of `docs/superpowers/design/2026-09-11-prompt-coach-ui-design.md`
or `docs/superpowers/design/2026-09-11-prompt-coach-motion-spec.md`. Read the cited section. Do not
read either file end to end, and do not invent a value that the design doc already fixes.

### Task 11: The wire contract and its fixtures

**Files:**
- Create: `packages/contract/src/checks.ts`, `packages/contract/src/run.ts`, `packages/contract/src/events.ts`, `packages/contract/src/fixtures.ts`, `packages/contract/src/index.ts`
- Test: `packages/contract/tests/contract.test.ts`, `packages/contract/tests/fixtures.test.ts`

**Interfaces:**
- Consumes: nothing. This package must not import from `apps/backend` or `apps/frontend`; it is the leaf both depend on.
- Produces: every type below, re-exported from `packages/contract/src/index.ts`. Phase B imports these for rendering, Phase C imports them for serialising, and a type redefined outside this package is a defect.

This is the keystone task of the plan. The nine check ids, the three groups, the nine event names and
the terminal states all appear here once and are imported everywhere else.

- [ ] **Step 1: Write the failing contract test**

`packages/contract/tests/contract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CHECK_IDS,
  CHECKS_BY_GROUP,
  CHECK_GROUPS,
  EVENT_NAMES,
  TERMINAL_STATUSES,
  eventId,
  isTerminal,
  isSuccess,
} from "../src/index.js";

describe("check identity", () => {
  it("names exactly nine checks", () => {
    expect(CHECK_IDS).toHaveLength(9);
    expect(new Set(CHECK_IDS).size).toBe(9);
  });

  it("splits them 5 / 2 / 2 across the three groups in spec order", () => {
    expect(CHECK_GROUPS).toEqual(["look", "safety", "drawable"]);
    expect(CHECKS_BY_GROUP.look).toEqual([
      "age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker",
    ]);
    expect(CHECKS_BY_GROUP.safety).toEqual(["no_real_person", "no_brand_name"]);
    expect(CHECKS_BY_GROUP.drawable).toEqual(["drawable_only", "no_cross_slot"]);
  });

  it("puts every check in exactly one group", () => {
    const flattened = CHECK_GROUPS.flatMap((g) => CHECKS_BY_GROUP[g]);
    expect(flattened.slice().sort()).toEqual(CHECK_IDS.slice().sort());
  });
});

describe("events", () => {
  it("names the nine spec events", () => {
    expect(EVENT_NAMES).toEqual([
      "run.started",
      "pass.started",
      "evaluator.group.started",
      "evaluator.group.completed",
      "repairer.started",
      "repairer.completed",
      "pass.completed",
      "run.completed",
      "run.failed",
    ]);
  });

  it("builds a resumable id of the form <pass>-<step>", () => {
    expect(eventId(1, 0)).toBe("1-0");
    expect(eventId(3, 7)).toBe("3-7");
  });
});

describe("terminal status", () => {
  it("names the three terminal states", () => {
    expect(TERMINAL_STATUSES).toEqual(["passed", "improved_still_failing", "no_improvement"]);
  });

  it("treats running as not terminal", () => {
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("passed")).toBe(true);
    expect(isTerminal("no_improvement")).toBe(true);
  });

  it("counts only passed as success, which is what stops the UI celebrating a failure", () => {
    expect(isSuccess("passed")).toBe(true);
    expect(isSuccess("improved_still_failing")).toBe(false);
    expect(isSuccess("no_improvement")).toBe(false);
    expect(isSuccess("failed")).toBe(false);
    expect(isSuccess("running")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/contract/tests/contract.test.ts`
Expected: FAIL, cannot find module `../src/index.js`.

- [ ] **Step 3: Write the check identity module**

`packages/contract/src/checks.ts`:

```typescript
export const CHECK_GROUPS = ["look", "safety", "drawable"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

export const CHECKS_BY_GROUP = {
  look: ["age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker"],
  safety: ["no_real_person", "no_brand_name"],
  drawable: ["drawable_only", "no_cross_slot"],
} as const satisfies Record<CheckGroup, readonly string[]>;

export const CHECK_IDS = [
  ...CHECKS_BY_GROUP.look,
  ...CHECKS_BY_GROUP.safety,
  ...CHECKS_BY_GROUP.drawable,
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export type Band = 1 | 2 | 3 | 4 | 5;

/** The percentage a band is displayed as. Derived in code, never produced by a model. */
export type Percent = 20 | 40 | 60 | 80 | 100;

export function groupOf(checkId: CheckId): CheckGroup {
  for (const group of CHECK_GROUPS) {
    if ((CHECKS_BY_GROUP[group] as readonly string[]).includes(checkId)) return group;
  }
  throw new Error(`unknown check id: ${checkId}`);
}
```

- [ ] **Step 4: Write the run view module**

`packages/contract/src/run.ts`:

```typescript
import type { Band, CheckGroup, CheckId, Percent } from "./checks.js";

/** A verified quote: the model supplied the text, code supplied the offsets. */
export type SpanView = {
  spanId: string;
  checkId: CheckId;
  quote: string;
  start: number;
  end: number;
};

/** A quote the model returned that code could not find verbatim in the description. */
export type UnverifiedQuoteView = {
  checkId: CheckId;
  quote: string;
  reason: "not_found" | "ambiguous";
};

/**
 * A check as the wire carries it. This is a discriminated union, mirroring the engine's
 * `EvaluatedCheck`, and it is deliberately NOT a flat shape with an optional band.
 *
 * The failure this project fears is a consumer treating an unevaluated check as passing. With a flat
 * optional `band`, a naive read of `passed` compiles fine and goes through undetected. With the union,
 * `band`, `percent` and `passed` exist only inside the `scored` branch, so any code path reading them
 * without narrowing on `status` fails to compile. The engine already has that guarantee; this carries
 * it across the network instead of silently downgrading it.
 */
export type CheckResultView =
  | {
      status: "scored";
      checkId: CheckId;
      group: CheckGroup;
      band: Band;
      /** Always bandToPercent(band). Sent by the server so no client recomputes it. */
      percent: Percent;
      passed: boolean;
      reason: string;
      spans: SpanView[];
      unverified: UnverifiedQuoteView[];
      /** True when the check scored below band 4 but returned no quotes to back it. */
      missingEvidence: boolean;
    }
  | {
      status: "not_evaluated";
      checkId: CheckId;
      group: CheckGroup;
      /** Why the group call failed. Never a band, never a percent. */
      reason: string;
    };

/** One fragment the Repairer rewrote, as the Run screen's diff renders it. */
export type ReplacementView = {
  spanId: string;
  checkId: CheckId;
  oldText: string;
  newText: string;
  rationale: string;
};

**The rationale must survive the whole pipeline.** The Repairer's schema already requires it, but
`repairSpans` narrows its output to a bare `{spanId, newText}` and drops it, and `PassResult` never
carried the replacements at all — so every real run rendered an empty fragment diff. Both are fixed:
`repairSpans` retains `rationale`, and `PassResult` carries the replacements through to the presenter.


export type PassView = {
  pass: number;
  description: string;
  results: CheckResultView[];
  failing: CheckId[];
  replacements: ReplacementView[];
  repairedDescription?: string;
};

export const TERMINAL_STATUSES = [
  "passed",
  "improved_still_failing",
  "no_improvement",
] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type RunStatus = "running" | TerminalStatus | "failed";

/**
 * Every field is optional, and that is load-bearing. An absent field means "not measured" and the UI
 * renders it as such; a present `0` means a real measurement of zero. A required numeric field cannot
 * express the difference, so an unmeasured run would arrive as a confident `$0.00` — the exact
 * fabrication the Architecture screen's "not measured" rule exists to prevent.
 */
export type StepCost = {
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  latencyMs?: number;
};

/**
 * What `GET /runs` can actually answer from a manifest, without reading every pass file.
 * `listRuns` returns these; a full `RunView` requires `GET /runs/:id`.
 */
export type RunSummary = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  passes: number;
};

export type RunView = {
  runId: string;
  rubricVersion: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  originalDescription: string;
  finalDescription: string;
  passes: PassView[];
  cost: StepCost;
  /** Present only when status is "failed". */
  error?: string;
};

export function isTerminal(status: RunStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status) || status === "failed";
}

/**
 * The single source of truth for whether the UI may render a success state.
 * `improved_still_failing` and `no_improvement` are terminal but are NOT success, per spec §5.
 */
export function isSuccess(status: RunStatus): boolean {
  return status === "passed";
}
```

- [ ] **Step 5: Write the event module**

`packages/contract/src/events.ts`:

```typescript
import type { CheckGroup } from "./checks.js";
import type { CheckResultView, ReplacementView, RunStatus, RunView, StepCost } from "./run.js";

export const EVENT_NAMES = [
  "run.started",
  "pass.started",
  "evaluator.group.started",
  "evaluator.group.completed",
  "repairer.started",
  "repairer.completed",
  "pass.completed",
  "run.completed",
  "run.failed",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** `<pass>-<step>`, per spec §6, so EventSource can resume with Last-Event-ID. */
export function eventId(pass: number, step: number): string {
  return `${pass}-${step}`;
}

export function parseEventId(id: string): { pass: number; step: number } {
  const [pass, step] = id.split("-");
  const parsed = { pass: Number(pass), step: Number(step) };
  if (!Number.isInteger(parsed.pass) || !Number.isInteger(parsed.step)) {
    throw new Error(`malformed event id: ${id}`);
  }
  return parsed;
}

type Base<N extends EventName, P> = { id: string; name: N; at: string } & P;

export type RunEvent =
  | Base<"run.started", { runId: string; rubricVersion: string; model: string; description: string }>
  | Base<"pass.started", { pass: number; description: string }>
  | Base<"evaluator.group.started", { pass: number; group: CheckGroup }>
  /**
   * A group's bands and reasons, as soon as that group's call settles.
   * Its results ALWAYS carry empty `spans` and `unverified`: span verification is pass-wide and
   * needs every group's quotes together, so nothing honest exists at group-settle time. Verified
   * spans arrive on `pass.completed`, which fires after verification has fully resolved.
   */
  | Base<"evaluator.group.completed", { pass: number; group: CheckGroup; results: CheckResultView[]; cost: StepCost }>
  | Base<"repairer.started", { pass: number; spanIds: string[] }>
  | Base<"repairer.completed", { pass: number; replacements: ReplacementView[]; cost: StepCost }>
  | Base<"pass.completed", { pass: number; repairedDescription?: string; failing: string[]; results: CheckResultView[] }>
  | Base<"run.completed", { status: RunStatus; run: RunView }>
  | Base<"run.failed", { error: string }>;

export type EventOf<N extends EventName> = Extract<RunEvent, { name: N }>;
```

- [ ] **Step 5b: Write the pipeline and version modules**

These two also cross the network, so they belong here rather than in the screens that render them.
`packages/contract/src/pipeline.ts`:

```typescript
export const NODE_STATES = ["planned", "queued", "running", "done", "failed"] as const;
export type NodeState = (typeof NODE_STATES)[number];

export type NodeKind = "intake" | "agent" | "enforce" | "gate";

export type PipelineNode = {
  id: string;
  label: string;
  kind: NodeKind;
  state: NodeState;
  /** `<pass>-<step>` of the event that last moved this node. */
  cueId?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  payload?: unknown;
  error?: string;
  /** Short human line, e.g. "11 verified, 1 unverified". */
  note?: string;
};

export type PipelineEdge = { from: string; to: string };

/**
 * The v1 pipeline, including the three agents the spec designs but does not build.
 * A `planned` node is never given a state by any event; it is planned for the life of v1.
 */
export const PIPELINE_NODES: readonly PipelineNode[] = [
  { id: "intake", label: "Description", kind: "intake", state: "queued" },
  { id: "interrogator", label: "Interrogator", kind: "agent", state: "planned" },
  { id: "evaluator", label: "Evaluator", kind: "agent", state: "queued" },
  { id: "verify", label: "Span verification", kind: "enforce", state: "queued" },
  { id: "repairer", label: "Repairer", kind: "agent", state: "queued" },
  { id: "splice", label: "Splice", kind: "enforce", state: "queued" },
  { id: "gate", label: "Pass gate", kind: "gate", state: "queued" },
  { id: "director", label: "Director", kind: "agent", state: "planned" },
  { id: "identity", label: "Identity Meter", kind: "agent", state: "planned" },
];

export const PIPELINE_EDGES: readonly PipelineEdge[] = [
  { from: "intake", to: "evaluator" },
  { from: "evaluator", to: "verify" },
  { from: "verify", to: "repairer" },
  { from: "repairer", to: "splice" },
  { from: "splice", to: "gate" },
  { from: "gate", to: "evaluator" },
  { from: "gate", to: "director" },
  { from: "director", to: "identity" },
];
```

`packages/contract/src/versions.ts`:

```typescript
import type { Band, CheckId, Percent } from "./checks.js";

export type VersionKind = "rubric" | "evaluator_prompt" | "repairer_prompt";

export type VersionRow = {
  id: string;
  kind: VersionKind;
  version: string;
  sealedAt: string;
  /** Required by spec §7. Never optional, never empty. */
  why: string;
  meanPercent: number | null;
  deltaPercent: number | null;
  /** Nine points in rubric order. Null until a run has scored against this version. */
  profile: Record<CheckId, Percent> | null;
  /** Null until the agreement study has run. Never invent a number here. */
  kappa: number | null;
  perCheckKappa: Record<CheckId, number> | null;
  goldSetSize: number | null;
};

export type CheckDelta = {
  checkId: CheckId;
  /** Null when either side is unmeasured. Never coerce an unmeasured side to zero. */
  deltaPercent: number | null;
  bandA: Band | null;
  bandB: Band | null;
};

export type VersionCompare = {
  a: VersionRow;
  b: VersionRow;
  promptDiff: Array<{ kind: "same" | "added" | "removed"; text: string }>;
  perCheck: CheckDelta[];
};
```

Add one test per module to `packages/contract/tests/contract.test.ts`: that `PIPELINE_NODES` contains
exactly three `planned` nodes and that their ids are `interrogator`, `director` and `identity`; that
every edge's `from` and `to` name a real node id; and that `VersionRow`'s `kappa` and `profile` are
allowed to be null, asserted by constructing one with nulls and type-checking it.

- [ ] **Step 6: Write the barrel**

`packages/contract/src/index.ts`:

```typescript
export * from "./checks.js";
export * from "./run.js";
export * from "./events.js";
export * from "./pipeline.js";
export * from "./versions.js";
export * from "./fixtures.js";
```

- [ ] **Step 7: Run the contract test and watch it pass**

Run: `npx vitest run packages/contract/tests/contract.test.ts`
Expected: PASS, 8 tests. `fixtures.js` does not exist yet, so create it as an empty file exporting nothing if the barrel fails to resolve, and fill it in the next step.

- [ ] **Step 8: Write the failing fixtures test**

`packages/contract/tests/fixtures.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  FIXTURE_RUNS,
  FIXTURE_EVENT_LOG,
  CHECK_IDS,
  isSuccess,
  type RunView,
} from "../src/index.js";

const everyRun = Object.values(FIXTURE_RUNS) as RunView[];

describe("fixture runs", () => {
  it("covers all three terminal states plus a failure", () => {
    expect(Object.keys(FIXTURE_RUNS).sort()).toEqual([
      "failed", "improvedStillFailing", "noImprovement", "passed",
    ]);
  });

  it("covers all nine checks in every pass of every run, scored or not", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        expect(pass.results.map((r) => r.checkId).sort()).toEqual(CHECK_IDS.slice().sort());
      }
    }
  });

  it("gives the failed run a partial pass carrying not_evaluated checks", () => {
    const pass = FIXTURE_RUNS.failed.passes[0];
    expect(pass).toBeDefined();
    const notEvaluated = pass!.results.filter((r) => r.status === "not_evaluated");
    expect(notEvaluated.length).toBeGreaterThan(0);
    for (const result of notEvaluated) {
      expect(result).not.toHaveProperty("band");
      expect(result).not.toHaveProperty("percent");
      expect(result).not.toHaveProperty("passed");
    }
  });

  it("derives percent from band everywhere, never freely", () => {
    const expected = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 } as const;
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results) {
          expect(result.percent).toBe(expected[result.band]);
          expect(result.passed).toBe(result.band >= 4);
        }
      }
    }
  });

  it("gives every sub-threshold check at least one span or one unverified quote", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const result of pass.results.filter((r) => !r.passed)) {
          expect(result.spans.length + result.unverified.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("makes every span's offsets quote the description exactly", () => {
    for (const run of everyRun) {
      for (const pass of run.passes) {
        for (const span of pass.results.flatMap((r) => r.spans)) {
          expect(pass.description.slice(span.start, span.end)).toBe(span.quote);
        }
      }
    }
  });

  it("carries at least one unverified quote somewhere, so the UI's 'fragment not found' state is exercised", () => {
    const unverified = everyRun.flatMap((run) =>
      run.passes.flatMap((pass) => pass.results.flatMap((r) => r.unverified)),
    );
    expect(unverified.length).toBeGreaterThan(0);
  });

  it("marks only the passed run as success", () => {
    expect(isSuccess(FIXTURE_RUNS.passed.status)).toBe(true);
    expect(isSuccess(FIXTURE_RUNS.improvedStillFailing.status)).toBe(false);
    expect(isSuccess(FIXTURE_RUNS.noImprovement.status)).toBe(false);
    expect(isSuccess(FIXTURE_RUNS.failed.status)).toBe(false);
  });

  it("never invents an agreement number, because the gold set is not marked yet", () => {
    const serialised = JSON.stringify(FIXTURE_RUNS);
    expect(serialised).not.toMatch(/kappa/i);
  });
});

describe("fixture event log", () => {
  it("opens with run.started and closes with a terminal event", () => {
    expect(FIXTURE_EVENT_LOG[0]?.name).toBe("run.started");
    const last = FIXTURE_EVENT_LOG[FIXTURE_EVENT_LOG.length - 1];
    expect(["run.completed", "run.failed"]).toContain(last?.name);
  });

  it("gives every event a unique <pass>-<step> id", () => {
    const ids = FIXTURE_EVENT_LOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d+-\d+$/);
  });

  it("starts and completes each evaluator group exactly once per pass", () => {
    const started = FIXTURE_EVENT_LOG.filter((e) => e.name === "evaluator.group.started");
    const completed = FIXTURE_EVENT_LOG.filter((e) => e.name === "evaluator.group.completed");
    expect(started.length).toBe(completed.length);
    expect(started.length % 3).toBe(0);
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npx vitest run packages/contract/tests/fixtures.test.ts`
Expected: FAIL, `FIXTURE_RUNS` is not exported.

- [ ] **Step 10: Write the fixtures**

`packages/contract/src/fixtures.ts`. Build them with helpers so the offsets are computed rather than hand-counted — hand-counted offsets are how the "offsets quote the description exactly" test fails at 2am.

```typescript
import { CHECKS_BY_GROUP, CHECK_GROUPS, groupOf, type Band, type CheckId } from "./checks.js";
import { eventId, type RunEvent } from "./events.js";
import type {
  CheckResultView,
  PassView,
  Percent,
  ReplacementView,
  RunView,
  SpanView,
  StepCost,
  UnverifiedQuoteView,
} from "./run.js";

const PERCENT: Record<Band, Percent> = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };

/** Locate a quote in the description so no offset is ever hand-written. */
function spanFor(description: string, checkId: CheckId, quote: string, n: number): SpanView {
  const start = description.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote not present in description: ${quote}`);
  return { spanId: `${checkId}-${n}`, checkId, quote, start, end: start + quote.length };
}

function result(
  description: string,
  checkId: CheckId,
  band: Band,
  reason: string,
  quotes: string[] = [],
  unverified: UnverifiedQuoteView[] = [],
): CheckResultView {
  return {
    checkId,
    group: groupOf(checkId),
    band,
    percent: PERCENT[band],
    passed: band >= 4,
    reason,
    spans: quotes.map((q, i) => spanFor(description, checkId, q, i)),
    unverified,
  };
}

const COST: StepCost = { inputTokens: 1100, outputTokens: 600, usd: 0.02, latencyMs: 4200 };

const WEAK = [
  "A confident young man with striking features and an effortlessly cool presence.",
  "He wears a Nike hoodie and looks a bit like Ryan Gosling.",
  "Shot with dramatic side lighting and a shallow depth of field.",
].join(" ");

const STRONG = [
  "Male, Latino, around 30, lean and tall with broad shoulders.",
  "Fair freckled skin, a sharp jawline, a small mole below the left eye.",
  "Dark brown wavy hair, slicked back, collar length.",
  "A dusty-rose short-sleeve shirt open over a white tee, light-wash baggy jeans,",
  "black-and-white low-top canvas sneakers.",
  "A small gold hoop earring in the left ear and a thin scar through the right eyebrow.",
].join(" ");

function weakPassOne(): PassView {
  const d = WEAK;
  return {
    pass: 1,
    description: d,
    results: [
      result(d, "age_build", 2, "Names 'young' but gives no bracket and no build.", ["young man"]),
      result(d, "face_skin", 1, "No face or skin detail beyond a judgement.", ["striking features"]),
      result(d, "hair_spec", 1, "Hair is absent entirely.", ["A confident young man"]),
      result(d, "wardrobe", 2, "One garment, no footwear.", ["a Nike hoodie"]),
      result(d, "anchor_marker", 1, "No reusable identity anchor.", ["effortlessly cool presence"]),
      result(d, "no_real_person", 1, "Names a public figure as a lookalike.", ["looks a bit like Ryan Gosling"]),
      result(d, "no_brand_name", 1, "Names a brand.", ["Nike"]),
      result(d, "drawable_only", 1, "Mood and judgement words no model can draw.", [
        "confident", "striking", "effortlessly cool",
      ]),
      result(d, "no_cross_slot", 1, "Camera and lighting instruction inside the character block.", [
        "dramatic side lighting", "shallow depth of field",
      ], [{ checkId: "no_cross_slot", quote: "shot on a 35mm lens", reason: "not_found" }]),
    ],
    failing: [
      "age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker",
      "no_real_person", "no_brand_name", "drawable_only", "no_cross_slot",
    ],
    replacements: [
      { spanId: "age_build-0", checkId: "age_build", oldText: "young man", newText: "man in his late twenties, lean and tall", rationale: "Adds the bracket and the build the check requires." },
      { spanId: "no_brand_name-0", checkId: "no_brand_name", oldText: "Nike", newText: "plain grey", rationale: "Removes the brand name without changing the garment." },
      { spanId: "no_real_person-0", checkId: "no_real_person", oldText: "looks a bit like Ryan Gosling", newText: "has a broad, square jaw and pale grey eyes", rationale: "Replaces the lookalike framing with drawable features." },
    ],
    repairedDescription: WEAK
      .replace("young man", "man in his late twenties, lean and tall")
      .replace("Nike", "plain grey")
      .replace("looks a bit like Ryan Gosling", "has a broad, square jaw and pale grey eyes"),
  };
}
```

Complete the file to export:

- `FIXTURE_RUNS.passed` — a one-pass run over `STRONG` where all nine checks are band 4 or 5, `status: "passed"`, `finalDescription === originalDescription`, and `replacements: []`.
- `FIXTURE_RUNS.improvedStillFailing` — three passes starting from `WEAK` where the count in `failing` shrinks each pass but is non-empty at pass 3, `status: "improved_still_failing"`.
- `FIXTURE_RUNS.noImprovement` — two passes where `failing` is identical in both, `status: "no_improvement"`, and the pass-2 `replacements` array is empty.
- `FIXTURE_RUNS.failed` — a run that emits `run.started`, `pass.started`, one `evaluator.group.started`, then stops with `status: "failed"` and an `error` string. Its `passes` array holds **one partial pass**: the groups that completed are `scored`, and the group that did not is present as `not_evaluated` entries, one per check id in that group. All nine check ids appear; none is omitted. This is the fixture that makes the UI build a "not evaluated" state at all, so it is not optional.
- `FIXTURE_EVENT_LOG` — the full `RunEvent[]` for `improvedStillFailing`, in wall-clock order, ids from `eventId(pass, step)`, the three groups of each pass interleaved rather than strictly sequential so the UI's out-of-order arrival is exercised.

Every offset must come from `spanFor`. Every percent must come from `PERCENT`. No fixture may contain the word "kappa" or any agreement number: the gold set is not marked yet and `PRODUCT.md` forbids inventing one.

- [ ] **Step 11: Run both tests and watch them pass**

Run: `npx vitest run packages/contract`
Expected: PASS, all tests, output pristine.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: wire contract and fixtures for runs, checks and events"
```

---

### Task 12: Frontend workspace, tokens, and the run client seam

**Files:**
- Create: `apps/frontend/package.json`, `apps/frontend/index.html`, `apps/frontend/vite.config.ts`, `apps/frontend/vitest.config.ts`, `apps/frontend/tsconfig.json`
- Create: `apps/frontend/src/main.tsx`, `apps/frontend/src/App.tsx`, `apps/frontend/src/styles/tokens.css`, `apps/frontend/src/styles/base.css`, `apps/frontend/src/motion/tokens.ts`, `apps/frontend/src/motion/useMotionPrefs.ts`
- Create the shared chrome from design doc §5 "Shared": `apps/frontend/src/components/{AppShell,TopBar,ScreenTabs,RunIdentityStrip,ThemeToggle,EmptyState,ErrorPanel,SkeletonRows}.tsx`
- Create: `apps/frontend/src/data/RunClient.ts`, `apps/frontend/src/data/FixtureRunClient.ts`
- Modify: root `package.json` (add the `dev:web` and frontend test scripts)
- Test: `apps/frontend/tests/data/FixtureRunClient.test.ts`, `apps/frontend/tests/App.test.tsx`

**Interfaces:**
- Consumes: every type from `@ai-director/contract` (Task 11), especially `RunView`, `RunEvent` and `FIXTURE_RUNS`.
- Produces: `interface RunClient { startRun(description: string): Promise<{ runId: string }>; getRun(runId: string): Promise<RunView>; listRuns(): Promise<RunView[]>; subscribe(runId: string, from: string | undefined, sink: (event: RunEvent) => void): () => void }`, `class FixtureRunClient implements RunClient` with constructor `(options?: { speedMs?: number; scenario?: keyof typeof FIXTURE_RUNS })`, `type Screen = "run" | "architecture" | "versions"`, and the motion token constants.

**Design inputs:** the token block in §2 and the typography in §3 of
`docs/superpowers/design/2026-09-11-prompt-coach-ui-design.md`, copied verbatim — do not retype the
values from memory or adjust them to taste. The shared token block in the "shared token block"
section of `docs/superpowers/design/2026-09-11-prompt-coach-motion-spec.md`, likewise verbatim.

`RunClient` is the seam that lets the whole interface be built and reviewed before any network code
exists. `FixtureRunClient` replays `FIXTURE_EVENT_LOG` on a timer so the screens see events arriving
over time exactly as they will from SSE — a fixture that resolves instantly would hide every
streaming bug the design is meant to handle.

- [ ] **Step 1: Install the frontend dependencies**

```bash
npm install react react-dom motion --workspace @ai-director/frontend
npm install -D @vitejs/plugin-react vite @types/react @types/react-dom jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  --workspace @ai-director/frontend
```

`apps/frontend/package.json`:

```json
{
  "name": "@ai-director/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@ai-director/contract": "*" }
}
```

Add to the root `package.json` scripts:

```json
"dev:web": "vite --config apps/frontend/vite.config.ts",
"test:web": "vitest run --config apps/frontend/vitest.config.ts",
"build:web": "vite build --config apps/frontend/vite.config.ts"
```

and change the root `test` script to `"test": "vitest run && npm run test:web"`, because the two
suites need different environments and one vitest config cannot hold both.

- [ ] **Step 2: Write the configuration**

`apps/frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: { port: 5173 },
});
```

`apps/frontend/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["apps/frontend/tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: [fileURLToPath(new URL("./tests/setup.ts", import.meta.url))],
    globals: true,
  },
});
```

`apps/frontend/tests/setup.ts` is one line: `import "@testing-library/jest-dom/vitest";`

`apps/frontend/index.html` loads `/src/main.tsx` and nothing else. Put the Google Fonts `<link>` tags
named in design doc §3 in its `<head>`; that is the only external host permitted anywhere in this
project.

- [ ] **Step 3: Write the token stylesheets**

`src/styles/tokens.css` holds the design doc §2 block verbatim: `:root` for the dark theme as
primary, `[data-theme="light"]` for the light theme. `src/styles/base.css` holds the reset, the body
type, focus-visible rings, and a `@media (prefers-reduced-motion: reduce)` block. Every later
component reads `var(--…)`; a hex literal in a component file is a defect.

`src/motion/tokens.ts` exports the motion spec's durations, easings and springs as typed constants.
Components import these. A duration typed inline in a component is a defect for the same reason.

- [ ] **Step 4: Write the failing client test**

`apps/frontend/tests/data/FixtureRunClient.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FixtureRunClient } from "../../src/data/FixtureRunClient.js";
import { FIXTURE_RUNS } from "@ai-director/contract";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FixtureRunClient", () => {
  it("returns a run id from startRun", async () => {
    const client = new FixtureRunClient();
    await expect(client.startRun("a description")).resolves.toMatchObject({
      runId: expect.any(String),
    });
  });

  it("delivers events over time rather than all at once, so streaming bugs cannot hide", async () => {
    const client = new FixtureRunClient({ speedMs: 10 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    client.subscribe(runId, undefined, (e) => seen.push(e.name));
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual(["run.started"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toHaveLength(2);
  });

  it("ends on a terminal event", async () => {
    const client = new FixtureRunClient({ speedMs: 1 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    client.subscribe(runId, undefined, (e) => seen.push(e.name));
    await vi.advanceTimersByTimeAsync(1000);
    expect(["run.completed", "run.failed"]).toContain(seen[seen.length - 1]);
  });

  it("stops delivering after unsubscribe", async () => {
    const client = new FixtureRunClient({ speedMs: 10 });
    const { runId } = await client.startRun("a description");
    const seen: string[] = [];
    const off = client.subscribe(runId, undefined, (e) => seen.push(e.name));
    await vi.advanceTimersByTimeAsync(10);
    off();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(1);
  });

  it("can replay any scenario, including the ones that must never look like success", async () => {
    for (const scenario of ["passed", "improvedStillFailing", "noImprovement", "failed"] as const) {
      const client = new FixtureRunClient({ speedMs: 1, scenario });
      const { runId } = await client.startRun("a description");
      await vi.advanceTimersByTimeAsync(1000);
      const run = await client.getRun(runId);
      expect(run.status).toBe(FIXTURE_RUNS[scenario].status);
    }
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm run test:web -- FixtureRunClient`
Expected: FAIL, module not found.

- [ ] **Step 6: Write `RunClient.ts` and `FixtureRunClient.ts`**

`RunClient.ts` holds only the interface and its types — no implementation, so both clients import it
without importing each other. `FixtureRunClient` walks `FIXTURE_EVENT_LOG` on `setTimeout` at
`speedMs` per event (default 320), tracks subscribers per run id, honours `from` by skipping events
up to and including that id, and returns an unsubscribe that clears the pending timer.

- [ ] **Step 7: Run it and watch it pass**

Run: `npm run test:web -- FixtureRunClient`
Expected: PASS, 5 tests.

- [ ] **Step 8: Write the failing shell test**

`apps/frontend/tests/App.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App.js";
import { FixtureRunClient } from "../src/data/FixtureRunClient.js";

describe("App shell", () => {
  it("opens on the Run screen", () => {
    render(<App client={new FixtureRunClient()} />);
    expect(screen.getByRole("heading", { name: /run/i, level: 1 })).toBeInTheDocument();
  });

  it("moves between the three screens from the navigation", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /architecture/i }));
    expect(screen.getByRole("heading", { name: /architecture/i, level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("heading", { name: /versions/i, level: 1 })).toBeInTheDocument();
  });

  it("marks the current screen for assistive technology, not only visually", async () => {
    const user = userEvent.setup();
    render(<App client={new FixtureRunClient()} />);
    await user.click(screen.getByRole("link", { name: /versions/i }));
    expect(screen.getByRole("link", { name: /versions/i })).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 9: Run it, watch it fail, write `App.tsx` and `main.tsx`, watch it pass**

`App` takes its `RunClient` as a prop so every test injects a fixture client and no test touches the
network. `main.tsx` is the only file that constructs one. Routing is a `useState<Screen>` plus
`history.pushState` — three screens do not need a router dependency, and Task 20 must not have to
unpick one.

The three screens are stubs in this task: a heading and nothing else. They are built in Tasks 13-16.
The shared chrome, however, is real: `AppShell`, `TopBar`, `ScreenTabs`, `RunIdentityStrip`,
`ThemeToggle`, `EmptyState`, `ErrorPanel` and `SkeletonRows` are built here to the signatures in
design doc §5 "Shared", because all three screens need them and none of them owns them.

`useMotionPrefs` wraps `useReducedMotion`. Note the correction the motion spec records from reading
Motion's type declarations: `useReducedMotion()` returns `boolean | null`, not `boolean`. Coalesce
the `null` to `false` and say why in a comment, per motion spec §2.1.

- [ ] **Step 10: Run the whole frontend suite**

Run: `npm run test:web`
Expected: PASS, 8 tests, output pristine.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: frontend workspace, design tokens, run client seam, app shell"
```

---

### Task 13: Run screen — the script page and the coverage gutter

**Files:**
- Create: `apps/frontend/src/domain/derive.ts`, `apps/frontend/src/hooks/useRunStream.ts`, `apps/frontend/src/hooks/useSelection.ts`
- Create: `apps/frontend/src/components/{DescriptionComposer,SpecimenView,SpecimenLine,SpanMark,CoverageGutter,CoverageRule,CheckPanel,CheckGroupHeader,CheckRow,BandMeter,BandMark,QuoteList,UnverifiedQuoteNotice,SectionLabel,LiveAnnouncer}.tsx`
- Modify: `apps/frontend/src/screens/RunScreen.tsx` (replace the Task 12 stub)
- Test: `apps/frontend/tests/domain/derive.test.ts`, `apps/frontend/tests/hooks/useRunStream.test.ts`, `apps/frontend/tests/screens/RunScreen.test.tsx`, `apps/frontend/tests/components/BandMeter.test.tsx`

**Interfaces:**
- Consumes: `RunClient` (Task 12), the motion tokens (Task 12), and from `@ai-director/contract` — `CheckResultView`, `SpanView`, `UnverifiedQuoteView`, `PassView`, `RunView`, `RunEvent`, `CHECK_IDS`, `CHECKS_BY_GROUP`, `CHECK_GROUPS`.
- Produces: `useRunStream(client: RunClient, runId: string | null): { run: RunView | null; status: RunStatus; events: RunEvent[]; error: string | null }`, `useSelection(): { selected: string | null; select: (checkId: string | null) => void; hoveredSpanId: string | null; hoverSpan: (spanId: string | null) => void }`, `splitLines(description: string, spans: SpanView[]): SpecimenLineModel[]`, and the components above.

**Design inputs, read only these sections:**
- `…/2026-09-11-prompt-coach-ui-design.md` §4.1 (Run screen layout and its responsive behaviour), §5 "Run screen" (every component signature you are implementing), §6.1 (empty, loading, streaming and error states), §7 "Focus order", "Keyboard, and the check to fragment link", and "Live announcements while a run streams".
- `…/2026-09-11-prompt-coach-motion-spec.md` §3 (Moment 1, check row revealing), §4 (Moment 2, band meter), §5 (Moment 3, check ↔ fragment selection), §2 (reduced motion), §13.3 (list-key discipline for the SSE stream).

**Do not create `src/domain/types.ts`.** The design doc proposes one; it is superseded. Every type comes from `@ai-director/contract`, and where the design doc's prop names disagree with the contract, the contract wins: `CheckGroup` is `"look" | "safety" | "drawable"` and never `"A" | "B" | "C"`; a span's id is `spanId`; a replacement's texts are `oldText` and `newText`. `src/domain/derive.ts` holds *functions* that compute UI-only values the server does not send (the 1-based line number of a span, the failing count, the mean percent), never type definitions.

- [ ] **Step 1: Write the failing derive test**

`apps/frontend/tests/domain/derive.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { splitLines, failingCount, meanPercent } from "../../src/domain/derive.js";
import { FIXTURE_RUNS } from "@ai-director/contract";

describe("splitLines", () => {
  it("returns one model per line of the description", () => {
    const lines = splitLines("one\ntwo\nthree", []);
    expect(lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(lines.map((l) => l.line)).toEqual([1, 2, 3]);
  });

  it("assigns each span to the line its start offset falls on", () => {
    const description = "alpha\nbravo charlie";
    const spans = [
      { spanId: "s1", checkId: "wardrobe" as const, quote: "bravo", start: 6, end: 11 },
    ];
    const lines = splitLines(description, spans);
    expect(lines[0]?.spans).toEqual([]);
    expect(lines[1]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
  });

  it("splits a span that straddles a newline rather than dropping it", () => {
    const description = "alpha bravo\ncharlie delta";
    const spans = [
      { spanId: "s1", checkId: "wardrobe" as const, quote: "bravo\ncharlie", start: 6, end: 19 },
    ];
    const lines = splitLines(description, spans);
    expect(lines[0]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
    expect(lines[1]?.spans.map((s) => s.spanId)).toEqual(["s1"]);
  });

  it("leaves the text reconstructable, so nothing is lost in rendering", () => {
    const description = FIXTURE_RUNS.improvedStillFailing.passes[0]!.description;
    const spans = FIXTURE_RUNS.improvedStillFailing.passes[0]!.results.flatMap((r) => r.spans);
    const lines = splitLines(description, spans);
    expect(lines.map((l) => l.text).join("\n")).toBe(description);
  });
});

describe("failingCount and meanPercent", () => {
  it("counts checks below band 4", () => {
    const pass = FIXTURE_RUNS.passed.passes[0]!;
    expect(failingCount(pass.results)).toBe(0);
  });

  it("means the nine percentages, not the bands", () => {
    const results = FIXTURE_RUNS.passed.passes[0]!.results;
    const expected = results.reduce((sum, r) => sum + r.percent, 0) / results.length;
    expect(meanPercent(results)).toBeCloseTo(expected, 10);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write `derive.ts`, watch it pass**

Run: `npm run test:web -- derive`

- [ ] **Step 3: Write the failing stream-hook test**

`apps/frontend/tests/hooks/useRunStream.test.ts` renders the hook with `renderHook` and a
`FixtureRunClient` at `speedMs: 1`, then asserts with fake timers: the hook starts at `status: "idle"`
with `run: null`; after subscribing it moves to `"streaming"`; each `evaluator.group.completed` merges
that group's results into `run` *without discarding groups that already arrived* — this is the bug the
whole fixture design exists to catch, so assert that after the second group lands the first group's
results are still present; `run.completed` sets the terminal status from the event's `run`; and
`run.failed` sets `status: "failed"` with the error string rather than throwing.

- [ ] **Step 4: Run it, watch it fail, write the two hooks, watch it pass**

`useRunStream` keeps a reducer over `RunEvent`. Reduce, never replace: a group's results merge into a
`Map` keyed by `checkId` so out-of-order arrival is safe. `useSelection` holds the selected check id
and the hovered span id, and nothing else — it is deliberately tiny because both the gutter and the
text need it and neither owns it.

- [ ] **Step 5: Write the failing band meter test**

`apps/frontend/tests/components/BandMeter.test.tsx` asserts the accessibility contract the design
doc's §7 requires and the spec's colour-blindness measurement depends on: the meter exposes
`role="meter"` with `aria-valuenow` equal to the percent, `aria-valuemin={0}`, `aria-valuemax={100}`;
it renders the printed percentage as text, so the value never depends on colour; and it renders the
band's stroke pattern via `BandMark`, so the value never depends on colour *or* on length alone. Add
one test that a band 4 and a band 3 meter differ in their rendered `data-band` attribute — the
pass boundary must be distinguishable in the DOM, which is what makes it testable at all.

- [ ] **Step 6: Run it, watch it fail, build the components, watch it pass**

Build them in dependency order: `BandMark`, `BandMeter`, `CheckRow`, `CheckGroupHeader`, `CheckPanel`,
then `SpanMark`, `SpecimenLine`, `SpecimenView`, `CoverageRule`, `CoverageGutter`, then
`DescriptionComposer`, `QuoteList`, `UnverifiedQuoteNotice`, `SectionLabel`, `LiveAnnouncer`.

Three rules from the design and motion specs that a reviewer will check:

1. A group header carries a label and a count of its checks. It must never carry an aggregate score.
2. The check reveal uses `AnimatePresence` keyed on the *band value*, per motion spec §3, so an
   unchanged score has an unchanged key and structurally cannot animate. Do not implement this with
   an `if (bandChanged)` conditional; the key is the mechanism.
3. Check ↔ fragment selection is plain CSS on `background-color` and `box-shadow` at 0.12s, with no
   Motion component involved at all (motion spec §5). A shared-`layoutId` indicator is explicitly
   rejected there because a wrapped inline span has several client rects and the indicator smears.

- [ ] **Step 7: Write the failing screen test**

`apps/frontend/tests/screens/RunScreen.test.tsx` asserts, with a `FixtureRunClient`:

```typescript
it("shows all nine checks with their own percentage once a run streams", async () => {
  // renders nine rows, each with a percent from {20,40,60,80,100}
});

it("shows no aggregate score anywhere in a group header", () => {
  // group headers contain no % character
});

it("highlights the quoted fragment when its check is activated from the keyboard", async () => {
  // tab to a check row, press Enter, assert the matching SpanMark gains aria-current
});

it("selects the check when its fragment in the text is activated", async () => {
  // click a SpanMark, assert the check row gains aria-selected
});

it("shows an explicit fragment-not-found notice for an unverified quote", async () => {
  // the fixture carries one; assert visible text, not a silent absence
});

it("makes the description read-only once submitted", async () => {
  // the textarea is replaced by SpecimenView, or carries readOnly
});
```

- [ ] **Step 8: Run it, watch it fail, write `RunScreen.tsx`, watch it pass**

- [ ] **Step 9: Run the whole frontend suite and commit**

```bash
npm run test:web
git add -A
git commit -m "feat: run screen, coverage gutter, check panel, span selection"
```

---

### Task 14: Run screen — passes, the fragment diff, and the verdict

**Files:**
- Create: `apps/frontend/src/components/{PassStepper,PassStep,FragmentDiff,FragmentDiffRow,VerdictBanner,CheckStrip,CueBadge}.tsx`
- Modify: `apps/frontend/src/screens/RunScreen.tsx`, `apps/frontend/src/components/CheckPanel.tsx`
- Test: `apps/frontend/tests/components/{VerdictBanner,FragmentDiff,PassStepper}.test.tsx`

**Interfaces:**
- Consumes: everything from Task 13, plus `ReplacementView`, `PassView`, `TERMINAL_STATUSES`, `isSuccess` from `@ai-director/contract`.
- Produces: the components above. `VerdictBanner` takes `{ status: RunStatus; failingCount: number; passesUsed: number; meanBefore: number; meanAfter: number }`.

**Added after the Task 13 review: lift the run stream to `App`.** Task 13 kept `useRunStream` inside
`RunScreen`, which left `TopBar`'s run-identity strip and `ScreenTabs`' failing-count badge wired to
the Task 12 stub (`run={null} failingCount={0}`). Design doc §6.2 makes that badge part of the
terminal-state contract — on a failing run it carries the failing count with an alarm treatment — so
it cannot stay stubbed.

Move the `useRunStream` call up into `App`, pass the run and its derived counts down to `TopBar`,
`ScreenTabs` and `RunScreen`. Do this here rather than in Task 15 because the Architecture screen
consumes the *same* event stream to drive its graph: with the hook inside each screen, opening both
would open two subscriptions to one run, and in Phase C that means two `EventSource` connections
where the server expects one.

Assert in a test that the failing-count badge reflects a failing run's real count and is absent on a
`passed` run.

**Design inputs, read only these sections:**
- `…ui-design.md` §6.2 — **the binding terminal-state table**. Everything `VerdictBanner` renders comes from that table's row for the status, and nothing outside it.
- `…ui-design.md` §5 "Run screen" for `PassStepper`, `PassStep`, `FragmentDiff`, `FragmentDiffRow`, `CheckStrip`, `CueBadge`.
- `…motion-spec.md` §6 (Moment 4, the fragment diff, including §6.1 on the layout shift), §7 (Moment 5, the pass stepper), §12 (Moment 10, terminal states landing).

This task carries the single most important requirement in the product. The spec, `PRODUCT.md`
principle 3, and the Global Constraints all say the same thing: **the UI must never show a success
state for `improved_still_failing` or `no_improvement`.** Design doc §6.2 turns that into a table of
exact words, tokens and treatments, including a list of words and tokens *forbidden* on each failing
state. Implement the table literally.

- [ ] **Step 1: Write the failing verdict test**

`apps/frontend/tests/components/VerdictBanner.test.tsx`. This is the test that protects the
requirement, so write it before the component and make it strict:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictBanner } from "../../src/components/VerdictBanner.js";

const FORBIDDEN = [/\bcomplete\b/i, /\bsuccess\b/i, /\bdone\b/i, /\bfinished\b/i, /✓/, /✔/];

describe("VerdictBanner", () => {
  it("says PASSED and counts the checks at band 4 or above when the run passed", () => {
    render(<VerdictBanner status="passed" failingCount={0} passesUsed={1} meanBefore={88} meanAfter={88} />);
    expect(screen.getByText("PASSED")).toBeInTheDocument();
    expect(screen.getByText(/of 9 checks at band 4 or above/i)).toBeInTheDocument();
  });

  it.each(["improved_still_failing", "no_improvement"] as const)(
    "never uses a success word or glyph for %s",
    (status) => {
      const { container } = render(
        <VerdictBanner status={status} failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />,
      );
      for (const pattern of FORBIDDEN) {
        expect(container.textContent ?? "").not.toMatch(pattern);
      }
    },
  );

  it("makes the failing count the headline numeral, not the score", () => {
    render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    expect(screen.getByTestId("verdict-numeral")).toHaveTextContent("3");
  });

  it("never renders the word improved without its qualifier on the same line", () => {
    render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    const line = screen.getByTestId("verdict-second-line").textContent ?? "";
    if (/improved|rose/i.test(line)) {
      expect(line).toMatch(/did not pass/i);
    }
  });

  it("says STILL FAILING and NO IMPROVEMENT in the words the design table fixes", () => {
    const { rerender } = render(<VerdictBanner status="improved_still_failing" failingCount={3} passesUsed={3} meanBefore={62} meanAfter={80} />);
    expect(screen.getByText("STILL FAILING")).toBeInTheDocument();
    rerender(<VerdictBanner status="no_improvement" failingCount={5} passesUsed={3} meanBefore={62} meanAfter={62} />);
    expect(screen.getByText("NO IMPROVEMENT")).toBeInTheDocument();
  });

  it("uses no band-4 or band-5 token on either failing state", () => {
    const { container } = render(<VerdictBanner status="no_improvement" failingCount={5} passesUsed={3} meanBefore={62} meanAfter={62} />);
    expect(container.innerHTML).not.toMatch(/--band-4|--band-5|--diff-add/);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write `VerdictBanner`, watch it pass**

- [ ] **Step 3: Write the failing diff test**

`apps/frontend/tests/components/FragmentDiff.test.tsx` asserts: it renders only the fragments that
changed, never the whole description — given a pass with two replacements out of a nine-check result,
exactly two diff rows appear; each row shows `oldText` and `newText` in `<del>` and `<ins>` elements,
so the change is semantic and not only visual; the rationale is shown; and when the pass has no
replacements it renders an explicit "no fragment changed" line rather than an empty box, because
`no_improvement` depends on that being visible (motion spec §12 also suppresses the diff sequence
entirely in that state).

- [ ] **Step 4: Run it, watch it fail, write `FragmentDiff` and `FragmentDiffRow`, watch it pass**

Follow motion spec §6.2's sequence exactly: strike at 0.14s, one unanimated reflow at 0.14s,
replacement at 0.18s. §6.1 explains why the reflow is not animated; do not try to improve on it with
`layout`, which §13.2 lists as a trap for inline spans.

- [ ] **Step 5: Write the failing stepper test**

`apps/frontend/tests/components/PassStepper.test.tsx` asserts: three steps are always visible even
when only one pass has run, with the unreached ones marked as not yet run; the current step has
`aria-current="step"`; steps are reachable with the arrow keys per design §7; and the final step of a
failed run renders the cross-bar terminator the §6.2 table requires rather than a closed frame.

- [ ] **Step 6: Run it, watch it fail, write `PassStepper` and `PassStep`, watch it pass**

- [ ] **Step 7: Wire them into `RunScreen` and assert the whole story**

Add to `apps/frontend/tests/screens/RunScreen.test.tsx`:

```typescript
it.each(["improvedStillFailing", "noImprovement"] as const)(
  "never shows a success state for the %s scenario, end to end",
  async (scenario) => {
    // stream the scenario to completion through FixtureRunClient,
    // then assert the whole document's text contains none of the forbidden words,
    // and that the verdict numeral is the failing count
  },
);
```

- [ ] **Step 8: Run the whole frontend suite and commit**

```bash
npm run test:web
git add -A
git commit -m "feat: pass stepper, fragment diff, and honest terminal verdicts"
```

---

### Task 15: Architecture screen

**Files:**
- Create: `apps/frontend/src/components/{PipelineGraph,GraphNode,GraphEdge,NodeInspector,MetricRow,PayloadViewer,CueLog,StageList}.tsx`
- Modify: `apps/frontend/src/screens/ArchitectureScreen.tsx` (replace the Task 12 stub)
- Test: `apps/frontend/tests/screens/ArchitectureScreen.test.tsx`, `apps/frontend/tests/components/GraphNode.test.tsx`

**Interfaces:**
- Consumes: `useRunStream` (Task 13), and from `@ai-director/contract` — `PipelineNode`, `PipelineEdge`, `NodeState`, `PIPELINE_NODES`, `PIPELINE_EDGES`, `RunEvent`.
- Produces: `nodesFromEvents(events: RunEvent[]): PipelineNode[]` in `src/domain/derive.ts`, and the components above.

**Design inputs, read only these sections:** `…ui-design.md` §4.2, §5 "Architecture screen", §6.3.
`…motion-spec.md` §8 (Moment 6, node states, **including §8.1 which resolves the running state
without a loop**), §9 (Moment 7, edge flow), §10 (Moment 8, the inspector).

This screen is an audit view, not decoration. Its job is that an assessor can click any step and see
the real payload, latency and cost that step actually produced. A node that shows a plausible-looking
number it did not receive would be worse than a node that shows nothing.

- [ ] **Step 1: Write the failing node-derivation test**

`apps/frontend/tests/domain/nodesFromEvents.test.ts` asserts: with no events, the built nodes are
`queued` and the three planned ones are `planned`; `evaluator.group.started` moves `evaluator` to
`running`; three `evaluator.group.completed` events move it to `done` and its `progress` through
1/3, 2/3, 3/3; `run.failed` moves the currently-running node to `failed` and leaves the rest alone;
and **no event of any kind can move a `planned` node off `planned`** — assert this by replaying the
entire `FIXTURE_EVENT_LOG` and checking all three are still planned at the end.

- [ ] **Step 2: Run it, watch it fail, write `nodesFromEvents`, watch it pass**

- [ ] **Step 3: Write the failing node test**

`apps/frontend/tests/components/GraphNode.test.tsx` asserts: a `planned` node renders as a plain
element carrying the visible word "planned" and is not a Motion component — assert there is no
`style` transform applied and that the design doc's dashed treatment class is present; a `running`
node renders its elapsed-seconds counter as text and its progress value; every state renders its
state as a text label, so state never depends on colour alone.

- [ ] **Step 4: Run it, watch it fail, build the components, watch it pass**

Motion spec §8.1 is binding: the running node animates **once** on entry and then holds a static
state. There is no pulse, spinner, shimmer or moving dashed border anywhere in this screen. Elapsed
time is a text node re-rendering, with no Motion component and no transition applied. If you find
yourself adding `repeat: Infinity`, stop and re-read §8.1 — it explains why the reflex is both
forbidden and wrong.

- [ ] **Step 5: Write the failing screen test**

`apps/frontend/tests/screens/ArchitectureScreen.test.tsx` asserts: all nine nodes render; the three
planned ones are labelled planned and are visually distinguishable per §6.3; clicking a node opens
`NodeInspector` with that node's real payload, latency and cost; a node with no cost yet shows an
explicit "not measured" rather than `$0.00`; and the inspector is dismissible with Escape and returns
focus to the node that opened it.

- [ ] **Step 6: Run it, watch it fail, write `ArchitectureScreen.tsx`, watch it pass**

- [ ] **Step 7: Run the whole frontend suite and commit**

```bash
npm run test:web
git add -A
git commit -m "feat: architecture screen as a live audit view of the pipeline"
```

---

### Task 16: Versions screen

**Files:**
- Create: `apps/frontend/src/components/{VersionTable,VersionRow,RevisionChip,DeltaBadge,CheckProfileSparkline,VersionCompare,PromptDiff,CheckDeltaTable,AgreementReadout}.tsx`
- Modify: `apps/frontend/src/screens/VersionsScreen.tsx` (replace the Task 12 stub), `apps/frontend/src/data/{RunClient,FixtureRunClient}.ts` (add the version methods)
- Test: `apps/frontend/tests/screens/VersionsScreen.test.tsx`, `apps/frontend/tests/components/{CheckProfileSparkline,AgreementReadout}.test.tsx`

**Interfaces:**
- Consumes: `VersionRow`, `VersionCompare`, `CheckDelta` from `@ai-director/contract` (Task 11).
- Produces: `RunClient` gains `listVersions(): Promise<VersionRow[]>` and `compareVersions(a: string, b: string): Promise<VersionCompare>`; `FixtureRunClient` implements both; and the components above.

**Design inputs, read only these sections:** `…ui-design.md` §4.3, §5 "Versions screen", §6.4.
`…motion-spec.md` §11 (Moment 9, the sparkline and the compare view).

**Ruling already made, implement it as stated:** `CheckProfileSparkline` draws a **nine-point check
profile in rubric order with the band-4 threshold line across it**, not a time series over versions.
Five versions cannot make an honest time axis, and spec §9 asks this screen to make "v2 beat v1"
legible check by check, which a profile does directly.

**The honesty requirement on this screen.** The gold set is not marked yet, so no agreement number
exists. `PRODUCT.md` says plainly that agreement numbers must not be fabricated in any screen or
mock. Every kappa field in the contract is `number | null`, and `null` renders as an explicit "not
measured yet" — never as `0`, never as a dash that could read as zero, never as a placeholder value.
A delta between a measured and an unmeasured version is `null`, not the measured number.

- [ ] **Step 1: Write the failing agreement-readout test**

`apps/frontend/tests/components/AgreementReadout.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgreementReadout } from "../../src/components/AgreementReadout.js";

describe("AgreementReadout", () => {
  it("says the number is not measured when kappa is null, rather than showing a zero", () => {
    const { container } = render(<AgreementReadout kappa={null} goldSetSize={null} />);
    expect(screen.getByText(/not measured/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b0(\.0+)?\b/);
  });

  it("shows the kappa and the sample size it came from when it is measured", () => {
    render(<AgreementReadout kappa={0.62} goldSetSize={40} />);
    expect(screen.getByText(/0\.62/)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
  });

  it("never shows a kappa without the sample size it was computed from", () => {
    render(<AgreementReadout kappa={0.62} goldSetSize={null} />);
    expect(screen.getByText(/sample size not recorded/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, watch it fail, write `AgreementReadout`, watch it pass**

- [ ] **Step 3: Write the failing sparkline test**

`apps/frontend/tests/components/CheckProfileSparkline.test.tsx` asserts: nine points render in
`CHECK_IDS` order; the band-4 threshold line is drawn; a `null` profile renders an explicit
"not scored yet" state rather than a flat line at zero, which would read as nine failures; and the
component exposes the nine values as accessible text so the profile is not conveyed by shape alone.

- [ ] **Step 4: Run it, watch it fail, write the component, watch it pass**

Motion spec §11.1 is binding: the sparkline **does not draw** when the data was present at first
paint, because data you already had is not a state change. `whileInView` is banned outright.

- [ ] **Step 5: Write the failing screen test**

`apps/frontend/tests/screens/VersionsScreen.test.tsx` asserts: one row per version; every row shows
its required `why` note, and a row whose `why` is empty is a test failure rather than a blank cell;
selecting two versions opens `VersionCompare` with the prompt diff and the per-check delta table; a
delta where either side is unmeasured renders as "not comparable" rather than a number; and the
revision chip colours follow the design doc's revision-paper order.

- [ ] **Step 6: Run it, watch it fail, write `VersionsScreen.tsx` and the fixture methods, watch it pass**

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm test
git add -A
git commit -m "feat: versions screen with check profiles and honest unmeasured agreement"
```

---

# Phase C — Wiring

Phase C makes the screens real. Nothing in Phase B changes except one line in `src/main.tsx` that
swaps `FixtureRunClient` for `HttpRunClient` — if any other frontend file needs editing in this
phase, the Phase B abstraction was wrong and that is a finding, not a fix to paper over.

### Task 17: Presenter and the Fastify run routes

**Files:**
- Create: `apps/backend/src/present/toRunView.ts`, `apps/backend/src/server/app.ts`, `apps/backend/src/server/routes/runs.ts`, `apps/backend/src/server/server.ts`
- Test: `apps/backend/tests/present/toRunView.test.ts`, `apps/backend/tests/server/runs.test.ts`

**Interfaces:**
- Consumes: `Rubric` (Task 2), `Span` and `UnverifiedQuote` (Task 3), `EvaluatedCheck` (Task 6 — the `status: "scored" | "not_evaluated"` union, not a flat `EvaluatorCheckResult`), `Replacement` (Task 4), `RunStore` and `RunManifest` (Task 8), `PassResult` and `runToCompletion` (Task 9), `bandToPercent` and `isPass` (Task 1), and every view type from `@ai-director/contract` (Task 11).

**A `not_evaluated` check must survive presentation.** `CheckResultView` has a required `band` and
`percent`, which a check with no result cannot supply. Extend the contract's `CheckResultView` with a
`status` field mirroring the engine's union rather than inventing a placeholder band — a check that was
never evaluated must render as "not evaluated" in the UI, never as 20%, never as a dash that reads as
zero, and never omitted from the nine. Update Task 11's `CheckResultView` accordingly when you reach
this task, and add a fixture covering it.
- Produces: `toCheckResultView(result: EvaluatorCheckResult, spans: Span[], unverified: UnverifiedQuote[]): CheckResultView`, `toPassView(result: PassResult, replacements: Replacement[]): PassView`, `toRunView(manifest: RunManifest, passes: PassView[], original: string, final: string, cost: StepCost): RunView`, `buildApp(deps: AppDeps): FastifyInstance`, `type AppDeps = { store: RunStore; rubric: Rubric; startRun: StartRun }`.

The presenter is the only place engine types become wire types. It is a pure function with no I/O,
which is why it is tested before any route exists.

- [ ] **Step 1: Install Fastify**

```bash
npm install fastify @fastify/cors --workspace @ai-director/backend
npm install -D supertest @types/supertest --workspace @ai-director/backend
```

Add to the root `package.json` scripts:

```json
"dev:server": "tsx watch apps/backend/src/server/server.ts"
```

- [ ] **Step 2: Write the failing presenter test**

`apps/backend/tests/present/toRunView.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toCheckResultView } from "../../src/present/toRunView.js";
import type { Span, UnverifiedQuote } from "../../src/enforce/verifySpans.js";

const description = "A confident young man in a Nike hoodie.";

describe("toCheckResultView", () => {
  it("derives percent and passed from the band, never from the model", () => {
    const view = toCheckResultView(
      { checkId: "drawable_only", band: 2, reason: "Mood words.", quotes: ["confident"] },
      [{ spanId: "drawable_only-0", checkId: "drawable_only", quote: "confident", start: 2, end: 11 }],
      [],
    );
    expect(view.percent).toBe(40);
    expect(view.passed).toBe(false);
    expect(view.group).toBe("drawable");
  });

  it("marks band 4 as passed at 80 percent", () => {
    const view = toCheckResultView(
      { checkId: "wardrobe", band: 4, reason: "Head to toe.", quotes: [] },
      [],
      [],
    );
    expect(view.percent).toBe(80);
    expect(view.passed).toBe(true);
  });

  it("carries unverified quotes through so the UI can show 'fragment not found'", () => {
    const unverified: UnverifiedQuote[] = [
      { checkId: "no_cross_slot", quote: "35mm lens", reason: "not_found" },
    ];
    const view = toCheckResultView(
      { checkId: "no_cross_slot", band: 1, reason: "Camera words.", quotes: [] },
      [],
      unverified,
    );
    expect(view.unverified).toEqual(unverified);
    expect(view.spans).toEqual([]);
  });

  it("only attaches spans belonging to its own check", () => {
    const spans: Span[] = [
      { spanId: "wardrobe-0", checkId: "wardrobe", quote: "Nike hoodie", start: 25, end: 36 },
      { spanId: "no_brand_name-0", checkId: "no_brand_name", quote: "Nike", start: 25, end: 29 },
    ];
    const view = toCheckResultView(
      { checkId: "wardrobe", band: 2, reason: "One garment.", quotes: ["Nike hoodie"] },
      spans,
      [],
    );
    expect(view.spans.map((s) => s.spanId)).toEqual(["wardrobe-0"]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/present/toRunView.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the presenter**

`apps/backend/src/present/toRunView.ts`:

```typescript
import { groupOf, type CheckId, type CheckResultView, type PassView, type ReplacementView, type RunView, type StepCost, type UnverifiedQuoteView } from "@ai-director/contract";
import type { EvaluatorCheckResult } from "../agents/evaluator/schema.js";
import type { Span, UnverifiedQuote } from "../enforce/verifySpans.js";
import type { Replacement } from "../enforce/splice.js";
import type { PassResult } from "../orchestrate/runPass.js";
import type { RunManifest } from "../store/RunStore.js";
import { bandToPercent, isPass, type Band } from "../enforce/score.js";

export function toCheckResultView(
  result: EvaluatorCheckResult,
  spans: Span[],
  unverified: UnverifiedQuote[],
): CheckResultView {
  const checkId = result.checkId as CheckId;
  const band = result.band as Band;
  return {
    checkId,
    group: groupOf(checkId),
    band,
    percent: bandToPercent(band) as CheckResultView["percent"],
    passed: isPass(band),
    reason: result.reason,
    spans: spans.filter((s) => s.checkId === checkId) as CheckResultView["spans"],
    unverified: unverified.filter((u) => u.checkId === checkId) as UnverifiedQuoteView[],
  };
}
```

Then write `toPassView` and `toRunView` in the same file. `toPassView` pairs each `Replacement` with
the `Span` it replaced so the view carries `oldText` (the span's quote) alongside `newText`; a
replacement whose `spanId` has no matching span is a bug and must throw, not be silently dropped.
`toRunView` assembles the manifest fields, the passes, the original and final descriptions and the
summed cost.

- [ ] **Step 5: Run the presenter test and watch it pass**

Run: `npx vitest run apps/backend/tests/present/toRunView.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the failing route test**

`apps/backend/tests/server/runs.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { FIXTURE_RUNS } from "@ai-director/contract";
import { loadRubric } from "../../src/rubric/load.js";

function stubStore() {
  const runs = new Map<string, unknown>();
  return {
    runs,
    createRun: async (m: any) => void runs.set(m.runId, m),
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id: string) => {
      const found = runs.get(id);
      if (!found) throw new Error(`run ${id} not found`);
      return found as any;
    },
    listRuns: async () => [...runs.values()] as any,
  };
}

describe("POST /runs", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = buildApp({
      store: stubStore(),
      rubric: await loadRubric("v1"),
      startRun: async () => FIXTURE_RUNS.passed,
    });
  });

  it("accepts a description and returns a run id immediately", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "Male, Latino, around 30, lean and tall." },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ runId: expect.any(String), status: "running" });
  });

  it("rejects an empty description with 400 rather than starting a run", async () => {
    const res = await app.inject({ method: "POST", url: "/runs", payload: { description: "   " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/description/i);
  });

  it("rejects a description over the length cap with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { description: "x".repeat(20_001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for a run that does not exist rather than an empty body", async () => {
    const res = await app.inject({ method: "GET", url: "/runs/nope" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/server/runs.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 8: Write the app and routes**

`apps/backend/src/server/app.ts` builds a Fastify instance, registers `@fastify/cors` for
`http://localhost:5173`, registers the run routes, and sets a JSON error handler that never leaks a
stack trace to the client. `src/server/routes/runs.ts` implements:

- `POST /runs` — validates `description` with zod (non-empty after trim, at most 20000 characters),
  mints a `runId` with `crypto.randomUUID()`, calls `deps.startRun` without awaiting it, and answers
  `202` with `{ runId, status: "running" }`. It must not block on the agents.
- `GET /runs` — the manifest list, newest first.
- `GET /runs/:id` — the full `RunView`, or `404` with `{ error }`.

`src/server/server.ts` is the entry point: it loads `.env`, builds the store and rubric, and listens
on `process.env.PORT ?? 8787`.

- [ ] **Step 9: Run the route test and watch it pass**

Run: `npx vitest run apps/backend/tests/server/runs.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: presenter and fastify run routes"
```

---

### Task 18: The event stream

**Files:**
- Create: `apps/backend/src/orchestrate/events.ts`, `apps/backend/src/server/sse.ts`
- Modify: `apps/backend/src/orchestrate/runToCompletion.ts` (add the optional emit hook), `apps/backend/src/server/routes/runs.ts` (add the events route)
- Test: `apps/backend/tests/orchestrate/events.test.ts`, `apps/backend/tests/server/sse.test.ts`

**Interfaces:**
- Consumes: `RunEvent`, `eventId`, `parseEventId` from `@ai-director/contract`; `runToCompletion` from Task 9.
- Produces: `type EventSink = (event: RunEvent) => void`, `class RunEventBus` with `publish(runId: string, event: RunEvent): void`, `subscribe(runId: string, from: string | undefined, sink: EventSink): () => void`, and `history(runId: string): RunEvent[]`; `formatSse(event: RunEvent): string`.

SSE rather than WebSocket because traffic is server to client only and `EventSource` reconnects with
`Last-Event-ID`, which a three-pass loop needs (spec §6).

- [ ] **Step 1: Write the failing bus test**

`apps/backend/tests/orchestrate/events.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { RunEventBus } from "../../src/orchestrate/events.js";
import { eventId, type RunEvent } from "@ai-director/contract";

function ev(pass: number, step: number, name: RunEvent["name"] = "pass.started"): RunEvent {
  return { id: eventId(pass, step), name, at: "2026-09-11T10:00:00.000Z", pass } as RunEvent;
}

describe("RunEventBus", () => {
  it("delivers events published after a subscription", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    expect(seen).toEqual(["1-0", "1-1"]);
  });

  it("replays history to a late subscriber, so a slow browser misses nothing", () => {
    const bus = new RunEventBus();
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    expect(seen).toEqual(["1-0", "1-1"]);
  });

  it("resumes after Last-Event-ID without redelivering what was already seen", () => {
    const bus = new RunEventBus();
    bus.publish("r1", ev(1, 0));
    bus.publish("r1", ev(1, 1));
    bus.publish("r1", ev(2, 0));
    const seen: string[] = [];
    bus.subscribe("r1", "1-1", (e) => seen.push(e.id));
    expect(seen).toEqual(["2-0"]);
  });

  it("keeps runs apart", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    bus.publish("r2", ev(1, 0));
    expect(seen).toEqual([]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    const off = bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    off();
    bus.publish("r1", ev(1, 0));
    expect(seen).toEqual([]);
  });

  it("survives a throwing subscriber without losing the other subscribers", () => {
    const bus = new RunEventBus();
    const seen: string[] = [];
    bus.subscribe("r1", undefined, () => { throw new Error("boom"); });
    bus.subscribe("r1", undefined, (e) => seen.push(e.id));
    expect(() => bus.publish("r1", ev(1, 0))).not.toThrow();
    expect(seen).toEqual(["1-0"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/orchestrate/events.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the bus**

`apps/backend/src/orchestrate/events.ts`. Keep per-run history in a `Map<string, RunEvent[]>` and
subscribers in a `Map<string, Set<EventSink>>`. `subscribe` replays history (filtered by
`parseEventId` when `from` is given, delivering only events ordered after it) and then registers the
sink. `publish` appends to history and calls every sink inside a `try/catch` so one broken client
cannot stall a run. Retain history for the life of the process; v1 is single-user and a run is at
most a few dozen events.

- [ ] **Step 4: Run the bus test and watch it pass**

Run: `npx vitest run apps/backend/tests/orchestrate/events.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Emit events from the orchestrator**

Add an optional `emit?: EventSink` to `runToCompletion`'s deps. Emit, in wall-clock order:
`run.started` once; then per pass `pass.started`, an `evaluator.group.started` as each group call is
issued and an `evaluator.group.completed` as each resolves — these are concurrent, so emit on
settle, not in array order — then `repairer.started` and `repairer.completed` when there is anything
to repair, then `pass.completed`. Close with `run.completed` carrying the full `RunView`, or
`run.failed` carrying the error message. Step numbers increment within a pass, starting at 0.

When `emit` is absent the orchestrator behaves exactly as it did in Task 9, so the CLI is unaffected.
Add one test asserting that a run with no `emit` produces identical output to Task 9's existing test.

- [ ] **Step 6: Write the failing SSE test**

`apps/backend/tests/server/sse.test.ts` asserts, against `formatSse`:

```typescript
import { describe, expect, it } from "vitest";
import { formatSse } from "../../src/server/sse.js";

describe("formatSse", () => {
  it("writes id, event and data lines ending in a blank line", () => {
    const out = formatSse({
      id: "1-0", name: "pass.started", at: "2026-09-11T10:00:00.000Z", pass: 1, description: "x",
    } as never);
    expect(out).toBe(
      'id: 1-0\nevent: pass.started\ndata: {"id":"1-0","name":"pass.started","at":"2026-09-11T10:00:00.000Z","pass":1,"description":"x"}\n\n',
    );
  });

  it("never emits a raw newline inside the data line, which would split the frame", () => {
    const out = formatSse({
      id: "1-1", name: "run.failed", at: "2026-09-11T10:00:00.000Z", error: "line one\nline two",
    } as never);
    const dataLines = out.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines).toHaveLength(1);
    expect(out).toContain("line one\\nline two");
  });
});
```

- [ ] **Step 7: Run it and watch it fail, then write `sse.ts` and the route**

`formatSse` is `id: <id>\nevent: <name>\ndata: <JSON.stringify(event)>\n\n`. `JSON.stringify` already
escapes newlines, which is what makes the second test pass; do not hand-roll the serialisation.

`GET /runs/:id/events` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`Connection: keep-alive` and `X-Accel-Buffering: no`, reads `Last-Event-ID` from the request header,
subscribes to the bus, writes each event with `formatSse`, and unsubscribes on `request.raw.on("close")`.
Send a `: keepalive\n\n` comment every 15 seconds — a comment frame is not an event and does not
violate the no-ambient-motion rule, which governs the UI, not the transport.

- [ ] **Step 8: Run the full backend suite**

Run: `npx vitest run apps/backend`
Expected: PASS, everything, output pristine.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: run event bus and server-sent event stream"
```

---

### Task 19: Version store and version routes

**Files:**
- Create: `apps/backend/src/store/VersionStore.ts`, `apps/backend/src/store/FileVersionStore.ts`, `apps/backend/src/server/routes/versions.ts`, `data/versions/notes.json`
- Modify: `apps/backend/src/server/app.ts` (register the route)
- Test: `apps/backend/tests/store/FileVersionStore.test.ts`, `apps/backend/tests/server/versions.test.ts`

**Interfaces:**
- Consumes: `VersionRow` and `VersionCompare` from `@ai-director/contract` as defined in Task 16's screen needs.
- Produces: `interface VersionStore { list(): Promise<VersionRow[]>; get(id: string): Promise<VersionRow>; compare(a: string, b: string): Promise<VersionCompare> }`, `class FileVersionStore implements VersionStore` with constructor `(root: string)`.

The Versions screen is the visible feedback cycle of the research, so its data must come from files
that are append-only on disk rather than from anything computed on the fly.

- [ ] **Step 1: Write `data/versions/notes.json`**

```json
{
  "versions": [
    {
      "id": "rubric-v1",
      "kind": "rubric",
      "version": "v1",
      "date": "2026-09-10",
      "why": "First rubric. Nine checks, five bands each, sourced to Higgsfield's published character pattern and to my own measured Runway refusals.",
      "kappa": null,
      "perCheckKappa": null
    }
  ]
}
```

`kappa` stays `null` until Task 23 computes one. A number here that no study produced is fabrication;
the UI renders `null` as "not measured yet".

- [ ] **Step 2: Write the failing store test**

`apps/backend/tests/store/FileVersionStore.test.ts` asserts: `list` returns rows newest first; a row
with no `why` throws on load, because `PRODUCT.md` makes the note required; `get` on an unknown id
rejects with `/version .* not found/`; `compare` of two versions returns per-check deltas and a
`null` delta for any check whose kappa is unmeasured in either version, never `0`.

Use a temp directory per test via `mkdtemp(join(tmpdir(), "versions-"))` and clean up in `afterEach`.

- [ ] **Step 3: Run it, watch it fail, write the store, watch it pass**

- [ ] **Step 4: Write the failing route test**

`apps/backend/tests/server/versions.test.ts` asserts `GET /versions` returns the rows, and
`GET /versions/compare?a=rubric-v1&b=rubric-v2` returns `400` when either id is missing and `404`
when either id is unknown.

- [ ] **Step 5: Run it, watch it fail, write the routes, watch it pass**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: version store and version routes"
```

---

### Task 20: HttpRunClient and the live swap

**Files:**
- Create: `apps/frontend/src/data/HttpRunClient.ts`
- Modify: `apps/frontend/src/main.tsx` (one line), `apps/frontend/vite.config.ts` (dev proxy)
- Test: `apps/frontend/tests/data/HttpRunClient.test.ts`

**Interfaces:**
- Consumes: the `RunClient` interface from Task 12, every type from `@ai-director/contract`.
- Produces: `class HttpRunClient implements RunClient` with constructor `(baseUrl: string)`.

This is the task that proves Phase B's abstraction. If making the screens live requires editing any
frontend file other than `main.tsx` and the Vite config, stop and report it: the `RunClient`
interface was drawn in the wrong place and that is worth knowing before the UI grows.

- [ ] **Step 1: Write the failing client test**

`apps/frontend/tests/data/HttpRunClient.test.ts`, with `fetch` stubbed via `vi.stubGlobal` and
`EventSource` stubbed by a small fake. Assert: `startRun` POSTs to `/runs` and returns the `runId`;
a non-2xx response rejects with the server's `error` string rather than a generic message;
`subscribe` opens `EventSource` at `/runs/:id/events`, parses each `event`/`data` frame into a typed
`RunEvent`, and passes it to the sink; an unparseable frame is reported through the client's error
channel instead of throwing into the stream; calling the returned unsubscribe closes the source.

- [ ] **Step 2: Run it, watch it fail, write `HttpRunClient`, watch it pass**

`EventSource` reconnects on its own and sends `Last-Event-ID`; do not hand-roll a retry loop. Attach
one `addEventListener` per name in `EVENT_NAMES` rather than relying on the default `message` handler,
because the server sets an `event:` line on every frame.

- [ ] **Step 3: Add the dev proxy**

In `apps/frontend/vite.config.ts`, proxy `/runs` and `/versions` to `http://localhost:8787`, so the
browser sees one origin and CORS never enters the picture in development.

- [ ] **Step 4: Swap the client**

In `src/main.tsx`, replace the `FixtureRunClient` construction with `new HttpRunClient("")`. Keep the
fixture client exported and still used by the frontend tests: it is the reason the UI suite needs no
network.

- [ ] **Step 5: Verify end to end by hand**

Add to the root `package.json`:

```json
"dev": "npm run dev:server & npm run dev:web",
"dev:web": "vite --config apps/frontend/vite.config.ts"
```

Run `npm run dev`, open `http://localhost:5173`, paste a weak description, and confirm: scores arrive
group by group rather than all at once, the quoted fragments highlight in the text, the pass stepper
fills as passes complete, and the Architecture graph's nodes move through running to done. Record
what you saw in your report. If the run ends in `improved_still_failing`, confirm the screen does not
read as success — that is the spec requirement most likely to break in integration.

- [ ] **Step 6: Run both suites**

Run: `npm test`
Expected: PASS, backend, contract and frontend, output pristine.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: http run client, dev proxy, screens live on real runs"
```

---

# Phase D — Evidence

Phase D is the part the assessors read. Nothing here is optional: the tool without the agreement
study is a demo, and the agreement study without the pre-registered failure condition is a demo with
statistics on it.

### Task 21: Live smoke test against the real API

**Carried here from Task 20's review: observe a real failing run end to end.** Task 20's live
verification passed on its first try, so the product's most safety-critical rule — that
`improved_still_failing` and `no_improvement` must never read as success — has only ever been
exercised against fixtures. The event shapes are now identical and `VerdictBanner` keys off a
transport-agnostic `status`, so fixture coverage is reasonable interim evidence, but it is not
observation.

Add a live test, gated on `RUN_LIVE_API=1` like the rest of this task, that runs a description
engineered to still fail after three passes — one carrying several unrepairable problems at once, for
instance a named public figure, a brand name, and pure mood words with nothing drawable. Assert the
run reaches a failing terminal state, and record in the report what the screen actually showed: the
verdict word, the headline numeral, and whether any success language or tick glyph appeared anywhere.
That is the one claim in this product that should rest on having watched it, not on having mocked it.

**Carried here from Task 6's review, which could not verify it from a diff.** Task 6 passes the
non-beta `zodOutputFormat()` helper to `client.beta.messages.parse`. The implementer's justification is
a structural-typing argument confirmed only by `tsc`; no unit test can check it, because unit tests are
forbidden from touching the network. This live test is the first and only place that combination is
exercised against the real API. Assert explicitly that `parsed_output` comes back non-null and
correctly shaped from a real call — if the helper and the beta namespace are not runtime-compatible,
this is where it surfaces, and it is a Task 6 defect to route back, not a test to loosen.

**Files:**
- Create: `apps/backend/tests/live/evaluator.live.test.ts`, `data/samples/weak-description.txt`, `data/samples/strong-description.txt`

**Interfaces:**
- Consumes: Tasks 2, 6.
- Produces: nothing new; this is the first evidence that the prompt works on the real model.

- [ ] **Step 1: Write the two sample descriptions**

`data/samples/weak-description.txt`:

```
A striking woman in her prime, beautiful and confident, with a very cinematic
presence. She looks a bit like a famous actress. Wearing casual clothes and
Nike sneakers. Shot with dramatic lighting.
```

`data/samples/strong-description.txt`:

```
A lean woman, late 20s, 170cm, with a square jaw, hazel eyes and dense
freckling across both cheeks. Dark brown hair cut to the jaw, wavy, centre
parting. Two small moles below the left eye and a thin scar through the right
eyebrow. Charcoal cotton hoodie with the zip half open over a white tee,
light-wash straight jeans, white low-top canvas sneakers, one thin gold hoop in
the left ear.
```

- [ ] **Step 2: Write the live test, skipped by default**

`apps/backend/tests/live/evaluator.live.test.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { evaluateAllGroups } from "../../src/agents/evaluator/run.js";
import { createAnthropicTransport } from "../../src/api/client.js";
import { isPass } from "../../src/enforce/score.js";
import { loadRubric } from "../../src/rubric/load.js";

const live = process.env.RUN_LIVE_API === "1";

describe.skipIf(!live)("evaluator against the real API", () => {
  it("fails the weak description on the checks it should fail", async () => {
    const rubric = await loadRubric("v1");
    const description = (await readFile("data/samples/weak-description.txt", "utf8")).trim();
    const results = await evaluateAllGroups(
      { transport: createAnthropicTransport() },
      { rubric, description },
    );
    const failing = results.filter((r) => !isPass(r.band)).map((r) => r.checkId);
    expect(failing).toContain("drawable_only");
    expect(failing).toContain("no_real_person");
    expect(failing).toContain("no_brand_name");
    expect(failing).toContain("no_cross_slot");
    for (const result of results.filter((r) => !isPass(r.band))) {
      expect(result.quotes.length).toBeGreaterThan(0);
      for (const quote of result.quotes) expect(description).toContain(quote);
    }
  }, 120_000);

  it("passes the strong description on the look checks", async () => {
    const rubric = await loadRubric("v1");
    const description = (await readFile("data/samples/strong-description.txt", "utf8")).trim();
    const results = await evaluateAllGroups(
      { transport: createAnthropicTransport() },
      { rubric, description },
    );
    const look = ["age_build", "face_skin", "hair_spec", "wardrobe", "anchor_marker"];
    for (const id of look) {
      expect(isPass(results.find((r) => r.checkId === id)!.band)).toBe(true);
    }
  }, 120_000);
});
```

- [ ] **Step 3: Run it live once, on purpose**

Run: `RUN_LIVE_API=1 npx vitest run apps/backend/tests/live/evaluator.live.test.ts`
Expected: PASS. Cost is roughly $0.12 for the two runs. If a quote comes back paraphrased, tighten rule 2 in the evaluator prompt and re-run; record what changed as the first entry in the version notes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: live smoke test for the evaluator on weak and strong samples"
```

---

### Task 22: Agreement study with Cohen's kappa

**Files:**
- Create: `apps/backend/src/agreement/kappa.ts`, `apps/backend/src/agreement/report.ts`, `apps/backend/src/cli/agree.ts`, `data/agreement/gold-set.json`
- Test: `apps/backend/tests/agreement/kappa.test.ts`, `apps/backend/tests/agreement/report.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6.
- Produces: `cohensKappa(pairs: Array<{ human: boolean; agent: boolean }>): { kappa: number; observed: number; expected: number; n: number; table: { bothPass: number; bothFail: number; humanPassAgentFail: number; humanFailAgentPass: number } }`, `type GoldItem = { id: string; description: string; marks: Record<string, boolean> }`, `buildAgreementReport(items: GoldItem[], agentMarks: Record<string, Record<string, boolean>>, checkIds: string[]): AgreementReport`.

- [ ] **Step 1: Write the failing kappa test**

`apps/backend/tests/agreement/kappa.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { cohensKappa } from "../../src/agreement/kappa.js";

describe("cohensKappa", () => {
  it("is 1 for perfect agreement", () => {
    const pairs = [
      { human: true, agent: true },
      { human: false, agent: false },
      { human: true, agent: true },
      { human: false, agent: false },
    ];
    expect(cohensKappa(pairs).kappa).toBeCloseTo(1, 10);
  });

  it("is 0 when agreement is only what chance predicts", () => {
    const pairs = [
      { human: true, agent: true },
      { human: true, agent: false },
      { human: false, agent: true },
      { human: false, agent: false },
    ];
    expect(cohensKappa(pairs).kappa).toBeCloseTo(0, 10);
  });

  it("is negative when agreement is worse than chance", () => {
    const pairs = [
      { human: true, agent: false },
      { human: true, agent: false },
      { human: false, agent: true },
      { human: false, agent: true },
    ];
    expect(cohensKappa(pairs).kappa).toBeLessThan(0);
  });

  it("reports the confusion table and n", () => {
    const out = cohensKappa([
      { human: true, agent: true },
      { human: true, agent: false },
      { human: false, agent: false },
    ]);
    expect(out.n).toBe(3);
    expect(out.table).toEqual({
      bothPass: 1,
      bothFail: 1,
      humanPassAgentFail: 1,
      humanFailAgentPass: 0,
    });
  });

  it("throws on an empty sample instead of returning NaN", () => {
    expect(() => cohensKappa([])).toThrow(/no pairs/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/agreement/kappa.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write kappa**

`apps/backend/src/agreement/kappa.ts`:

```typescript
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
```

- [ ] **Step 4: Run the kappa tests**

Run: `npx vitest run apps/backend/tests/agreement/kappa.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing report test**

`apps/backend/tests/agreement/report.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildAgreementReport } from "../../src/agreement/report.js";

const items = [
  { id: "d1", description: "x", marks: { wardrobe: true, drawable_only: false } },
  { id: "d2", description: "y", marks: { wardrobe: false, drawable_only: false } },
];

describe("buildAgreementReport", () => {
  it("reports kappa per check and overall", () => {
    const report = buildAgreementReport(
      items,
      {
        d1: { wardrobe: true, drawable_only: false },
        d2: { wardrobe: false, drawable_only: false },
      },
      ["wardrobe", "drawable_only"],
    );
    expect(report.perCheck.wardrobe!.kappa).toBeCloseTo(1, 10);
    expect(report.overall.n).toBe(4);
  });

  it("lists every disagreement with the item id and check", () => {
    const report = buildAgreementReport(
      items,
      {
        d1: { wardrobe: false, drawable_only: false },
        d2: { wardrobe: false, drawable_only: false },
      },
      ["wardrobe", "drawable_only"],
    );
    expect(report.disagreements).toEqual([
      { itemId: "d1", checkId: "wardrobe", human: true, agent: false },
    ]);
  });

  it("throws when an item was never scored by the agent", () => {
    expect(() => buildAgreementReport(items, { d1: { wardrobe: true } }, ["wardrobe"])).toThrow(
      /no agent marks for d2/,
    );
  });
});
```

- [ ] **Step 6: Write the report builder**

`apps/backend/src/agreement/report.ts`:

```typescript
import { cohensKappa, type KappaResult } from "./kappa.js";

export type GoldItem = { id: string; description: string; marks: Record<string, boolean> };

export type AgreementReport = {
  rubricVersion: string;
  perCheck: Record<string, KappaResult>;
  overall: KappaResult;
  disagreements: Array<{ itemId: string; checkId: string; human: boolean; agent: boolean }>;
};

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
```

- [ ] **Step 7: Run the report tests**

Run: `npx vitest run apps/backend/tests/agreement/report.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write the gold-set file and the agreement CLI**

`data/agreement/gold-set.json` starts as a frozen skeleton. Fill it with 30 to 50 items before running the study: descriptions I wrote properly, descriptions broken deliberately per check, and descriptions lifted from published examples. `marks` is my own hand judgement, pass or fail per check, recorded before any agent output is looked at.

```json
{
  "frozenOn": "2026-09-10",
  "items": [
    {
      "id": "d001",
      "description": "A lean woman, late 20s, 170cm, square jaw, hazel eyes, dense freckling across both cheeks. Dark brown hair cut to the jaw, wavy, centre parting. Charcoal hoodie, zip half open, white tee, light-wash straight jeans, white low-top canvas sneakers, one thin gold hoop in the left ear.",
      "marks": {
        "age_build": true,
        "face_skin": true,
        "hair_spec": true,
        "wardrobe": true,
        "anchor_marker": true,
        "no_real_person": true,
        "no_brand_name": true,
        "drawable_only": true,
        "no_cross_slot": true
      }
    }
  ]
}
```

`apps/backend/src/cli/agree.ts`:

```typescript
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { evaluateAllGroups } from "../agents/evaluator/run.js";
import { createAnthropicTransport } from "../api/client.js";
import { isPass } from "../enforce/score.js";
import { loadRubric } from "../rubric/load.js";
import { buildAgreementReport, type GoldItem } from "../agreement/report.js";

export async function main(): Promise<number> {
  const rubric = await loadRubric("v1");
  const gold = JSON.parse(await readFile("data/agreement/gold-set.json", "utf8")) as {
    items: GoldItem[];
  };
  const transport = createAnthropicTransport();

  const agentMarks: Record<string, Record<string, boolean>> = {};
  for (const item of gold.items) {
    const results = await evaluateAllGroups({ transport }, { rubric, description: item.description });
    agentMarks[item.id] = Object.fromEntries(
      results.map((result) => [result.checkId, isPass(result.band)]),
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
  for (const [checkId, result] of Object.entries(report.perCheck)) {
    console.log(`  ${checkId}: kappa ${result.kappa.toFixed(3)}, observed ${(result.observed * 100).toFixed(0)}%`);
  }
  console.log(`\ndisagreements: ${report.disagreements.length}`);
  for (const d of report.disagreements) {
    console.log(`  ${d.itemId} ${d.checkId}: human ${d.human ? "pass" : "fail"}, agent ${d.agent ? "pass" : "fail"}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
```

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, all unit tests. Live tests stay skipped without `RUN_LIVE_API=1`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: agreement study with per-check Cohen's kappa and disagreement list"
```

---

### Task 23: Cross-provider bias check

**Files:**
- Create: `apps/backend/src/api/openaiTransport.ts`, `apps/backend/src/cli/bias.ts`
- Test: `apps/backend/tests/api/openaiTransport.test.ts`, `apps/backend/tests/cli/bias.test.ts`

**Interfaces:**
- Consumes: `ParseTransport` (Task 6), `evaluateAllGroups` (Task 6), `loadRubric` (Task 2), `cohensKappa` (Task 22).
- Produces: `createOpenAiTransport(model?: string): ParseTransport`, `compareProviders(deps: { a: ParseTransport; b: ParseTransport }, args: { rubric: Rubric; descriptions: string[] }): Promise<ProviderComparison>`, `type ProviderComparison = { perCheck: Record<string, { agree: number; disagree: number; kappa: number }>; overall: number; n: number }`.

**Why this task exists.** Spec §4 records the problem in its own words: the Evaluator and the Repairer
are the same model family, and the LLM-judge literature associates that with self-preference. The
spec names two mitigations — the frozen human set, and making the Evaluator model a config value so
the same runs can be repeated on a different model. This task builds the second one. Running the same
descriptions through a different *provider*, not merely a different Claude, is the stronger control,
because a sibling model shares the training lineage that self-preference is suspected to ride on.

This does not change which model the product uses. `claude-opus-5` remains the Evaluator in every
other task and in the Global Constraints. The OpenAI transport exists to be run as a check and
reported, never to serve a user-facing run.

- [ ] **Step 1: Install the SDK**

```bash
npm install openai --workspace @ai-director/backend
```

- [ ] **Step 2: Write the failing transport test**

`apps/backend/tests/api/openaiTransport.test.ts`. No network: inject a fake OpenAI client. Assert
that `createOpenAiTransport` returns something matching the `ParseTransport` signature exactly, that
it passes the system and user strings through unchanged, that a refusal or a null parse surfaces as
`{ parsed_output: null }` rather than throwing, and that the same `EvaluatorGroupOutput` shape comes
back as from the Anthropic transport. The point of the test is that the two transports are
substitutable; if the shapes differ, the comparison in the next step compares nothing.

```typescript
import { describe, expect, it } from "vitest";
import { createOpenAiTransport } from "../../src/api/openaiTransport.js";

describe("createOpenAiTransport", () => {
  it("returns the same parsed shape as the anthropic transport", async () => {
    const fake = {
      responses: {
        parse: async () => ({
          output_parsed: { results: [{ checkId: "wardrobe", band: 4, reason: "ok", quotes: [] }] },
        }),
      },
    };
    const transport = createOpenAiTransport("gpt-5", fake as never);
    const out = await transport({ system: "s", user: "u", schema: {} });
    expect(out.parsed_output).toEqual({
      results: [{ checkId: "wardrobe", band: 4, reason: "ok", quotes: [] }],
    });
  });

  it("returns parsed_output null on a refusal instead of throwing", async () => {
    const fake = {
      responses: { parse: async () => ({ output_parsed: null, refusal: "no" }) },
    };
    const transport = createOpenAiTransport("gpt-5", fake as never);
    await expect(transport({ system: "s", user: "u", schema: {} })).resolves.toEqual({
      parsed_output: null,
    });
  });
});
```

- [ ] **Step 3: Run it, watch it fail, write the transport, watch it pass**

Take the client as an optional second constructor argument so tests inject a fake and production
constructs a real one from `OPENAI_API_KEY`. Read the key at call time, not at module load, so
importing the module without a key never throws.

- [ ] **Step 4: Write the failing comparison test**

`apps/backend/tests/cli/bias.test.ts`, both transports faked. Assert: `compareProviders` scores each
description through both transports and reports per-check agreement on the pass/fail decision, not on
the raw band, because the band is ordinal and the decision is what the product acts on; `n` counts
description-check pairs; two transports that agree on everything give `overall: 1`; a transport that
returns `parsed_output: null` for one description excludes that description from the comparison and
reports the exclusion count rather than counting it as agreement.

- [ ] **Step 5: Run it, watch it fail, write `compareProviders` and the CLI, watch it pass**

`npm run bias -- <file-of-descriptions>` writes
`data/agreement/bias-<date>.json` and prints the per-check table. Gate any real call behind
`RUN_LIVE_API=1` exactly as Task 21 does.

- [ ] **Step 6: Record the finding, whatever it is**

Append a dated entry to `docs/decision-log.md` (created in Task 24; if that task has not run yet,
create the file with just this entry and Task 24 will append to it) stating: the models compared, the number
of descriptions, the overall and per-check agreement, and one sentence on what it means for the
self-preference risk. If the two providers disagree substantially, that is a result to report, not a
bug to fix by tuning a prompt until they agree — tuning to agreement would destroy the control.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: cross-provider bias check for the evaluator"
```

---

### Task 24: Pre-registered failure condition and version notes

**Files:**
- Create: `docs/decision-log.md`, `data/versions/notes.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the written record the assessment needs, before any result exists to be tempted by.

**Note on `data/versions/notes.json`:** Task 19 already created this file with the `rubric-v1` row.
Do not overwrite it. This task's job is to fill in the `kappa` and `perCheckKappa` fields with the
numbers Task 22 actually produced, and to write the decision log. If Task 22 reported no number
because the gold set is still unmarked, leave both fields `null` and say so in the log.

**Also record, from the Task 15 review:** the Architecture screen reports no latency for the
`verify`, `splice` and `gate` nodes, because those three steps emit no events of their own and a
bracketed interval cannot honestly attribute duration to them. The review proved this is not
theoretical — between `evaluator.group.completed` and `repairer.started` the orchestrator may run a
full `retryVerbatim` model call, so a derived Verify latency would silently absorb an entire
evaluator re-ask. Log the decision and its rationale, and record adding real wire events for those
steps as a v2 improvement: it is the proper fix, and it was deliberately not taken in v1 because
spec §6 enumerates exactly nine event names that the contract and its tests encode.

- [ ] **Step 1: Write the decision log with the failure condition**

`docs/decision-log.md`:

```markdown
# Decision log

## 2026-09-10 - Pre-registered failure condition for the character rubric

Written before the first agreement run, so it cannot be adjusted to fit the result.

The approach counts as failed if any of these hold:

1. Overall Cohen's kappa against the frozen gold set is below 0.40 for rubric v1 and does not
   reach 0.60 by v3.
2. Repaired descriptions score higher on the rubric while a later render comparison shows no
   reduction in identity drift or refusal rate.
3. More than a quarter of sub-threshold checks return quotes that cannot be verified verbatim,
   because then the defect list is not usable evidence.

If any of these holds, it gets reported as a null result rather than reframed.

## 2026-09-10 - Rubric narrowed from twelve stage items to nine character checks

The published twelve-item rubric scores a stage prompt. v1 of this agent scores only the character
description, so nine checks in three groups. Three components Higgsfield names that the twelve miss
(acting layer, skin-texture detail, negative constraints) are recorded for the stage rubric later.
```

`data/versions/notes.json`:

```json
{
  "versions": [
    {
      "id": "rubric-v1",
      "date": "2026-09-10",
      "why": "First rubric. Nine checks, five bands each, sourced to Higgsfield's published character pattern and to my own measured Runway refusals.",
      "kappa": null
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "docs: pre-register the failure condition and rubric v1 notes"
```

---

