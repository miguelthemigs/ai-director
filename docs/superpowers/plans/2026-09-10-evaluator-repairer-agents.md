# Character Description Evaluator and Repairer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score a character description against a versioned nine-check rubric, repair only the fragments that failed, and report agreement with human marks, all from the command line with no render credits spent.

**Architecture:** Two Claude API agents behind pure-function boundaries. The Evaluator makes three concurrent calls (one per check group) and returns a band plus verbatim quotes per check. Code, not the model, verifies every quote exists in the input, computes its offsets, splices the Repairer's replacements back in, and asserts the untouched text is byte-identical. Runs and rubric versions are append-only JSON files behind a store interface so Supabase can land later without touching the layers above.

**Tech Stack:** Node 22, TypeScript (ESM), `@anthropic-ai/sdk`, `zod`, `vitest`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`

## Global Constraints

- Model for both agents: `claude-opus-5`. Never a date-suffixed variant.
- Request shape for both agents: `thinking: { type: "adaptive" }`, `output_config: { effort: "high", format: zodOutputFormat(Schema) }`, `max_tokens: 16000`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- Never send `budget_tokens` and never prefill an assistant turn: both are removed on this model and return 400.
- `client.messages.parse()` returns `parsed_output` that is `null` on parse failure. Always guard, never assert with `!`.
- Rubric and prompt files are append-only. `rubric/v1.json` is immutable once any run references it; changes ship as `v2.json`.
- Pass threshold is band 4. Band to percent mapping is exactly `{1:20, 2:40, 3:60, 4:80, 5:100}`.
- Maximum three passes per run. Terminal state is exactly one of `passed`, `improved_still_failing`, `no_improvement`.
- The Repairer never receives the full description, only failing fragments.
- ESM only: `__dirname` is undefined. Derive paths with `path.dirname(fileURLToPath(import.meta.url))` or use cwd-relative paths.
- No network calls in unit tests. Live API calls happen only in the smoke test in Task 11, which is skipped unless `RUN_LIVE_API=1`.

---

## File Structure

```
package.json                                  # workspace root, scripts
tsconfig.json                                 # strict ESM config
vitest.config.ts
apps/backend/src/
  rubric/v1.json                              # the nine checks, five bands each, sources
  rubric/load.ts                              # read + validate a rubric version
  rubric/types.ts                             # zod schemas for the rubric file
  agents/evaluator/schema.ts                  # output schema per group call
  agents/evaluator/prompt.ts                  # system prompt builder from rubric
  agents/evaluator/run.ts                     # one group call, injectable transport
  agents/repairer/schema.ts
  agents/repairer/prompt.ts
  agents/repairer/run.ts
  enforce/verifySpans.ts                      # verbatim match + offsets
  enforce/splice.ts                           # apply replacements, assert untouched
  enforce/score.ts                            # band -> percent, pass/fail, terminal state
  orchestrate/runPass.ts                      # one evaluate -> repair cycle
  orchestrate/runToCompletion.ts              # up to three passes, terminal state
  store/RunStore.ts                           # interface
  store/FileRunStore.ts                       # JSON files under data/runs
  agreement/kappa.ts                          # Cohen's kappa
  agreement/report.ts                         # gold set vs agent marks
  cli/score.ts                                # score one description
  cli/agree.ts                                # run the agreement study
  api/client.ts                               # Anthropic client + shared request options
apps/backend/tests/                           # mirrors src/
data/runs/<runId>/…                           # created at runtime
data/agreement/gold-set.json                  # hand-marked, frozen
```

---

### Task 1: Repository, TypeScript, and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `apps/backend/src/enforce/score.ts`
- Test: `apps/backend/tests/enforce/score.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `bandToPercent(band: 1|2|3|4|5): number`, `PASS_BAND = 4`, `isPass(band: number): boolean`.

- [ ] **Step 1: Initialise the repository**

```bash
cd "/Users/migroale/Desktop/Fontys Projects/AI Cinema"
git init
npm init -y
npm install @anthropic-ai/sdk zod
npm install -D typescript vitest tsx @types/node
```

- [ ] **Step 2: Write the configuration files**

`tsconfig.json`:

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
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["apps/**/*.ts"]
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["apps/**/tests/**/*.test.ts"], environment: "node" },
});
```

Add to `package.json`: `"type": "module"` and

```json
"scripts": {
  "test": "vitest run",
  "score": "tsx apps/backend/src/cli/score.ts",
  "agree": "tsx apps/backend/src/cli/agree.ts"
}
```

`.gitignore`:

```
node_modules
dist
.env
data/runs
```

`.env.example`:

```
ANTHROPIC_API_KEY=
RUN_LIVE_API=0
```

- [ ] **Step 3: Write the failing test**

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

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run apps/backend/tests/enforce/score.test.ts`
Expected: FAIL, cannot find module `../../src/enforce/score.js`.

- [ ] **Step 5: Write the implementation**

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

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run apps/backend/tests/enforce/score.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: init typescript workspace with band scoring"
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

### Task 4: Splice with byte-identity assertion

**Files:**
- Create: `apps/backend/src/enforce/splice.ts`
- Test: `apps/backend/tests/enforce/splice.test.ts`

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
- Produces: `RepairerOutputSchema`, `buildRepairerSystemPrompt(checks: RubricCheck[]): string`, `repairSpans(deps: { transport: ParseTransport }, args: { spans: Span[]; checks: RubricCheck[]; reasons: Record<string, string> }): Promise<Replacement[]>`.

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
- Produces: `type PassResult = { pass: number; description: string; results: EvaluatorCheckResult[]; failing: string[]; unverified: UnverifiedQuote[]; repairedDescription?: string }`, `runPass(deps, args): Promise<PassResult>`, `runToCompletion(deps, args: { rubric: Rubric; description: string; runId: string; maxPasses?: number }): Promise<{ status: RunStatus; passes: PassResult[]; finalDescription: string }>`.

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

### Task 11: Live smoke test against the real API

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

### Task 12: Agreement study with Cohen's kappa

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

### Task 13: Pre-registered failure condition and version notes

**Files:**
- Create: `docs/decision-log.md`, `data/versions/notes.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the written record the assessment needs, before any result exists to be tempted by.

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

## Plans that follow this one

- Plan 2, backend and event stream: Fastify routes `POST /runs` and `GET /runs/:id/events`, the SSE event names in the spec, and the version store read path.
- Plan 3, frontend: Run, Architecture and Versions screens, built after invoking the `impeccable`, `ui-ux-pro-max` and `motion` skills, with motion tied to real state changes only.

Both depend on this plan's store interfaces and event payload shapes, which is why they come second: the graded evidence exists at the end of Task 12 with no interface built.
