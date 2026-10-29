# Architecture Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One brief, three wirings of the same three agents (sequential recipe, coordinator, swarm), each producing a checked shot list and a text prompt, with the same run files so they can be compared.

**Architecture:** A shared toolbox CLI (`npm run -s lab -- …`) owns every rule in code: saving with validation, checks, routing, retry caps, assembly, metrics. The sequential recipe is TypeScript calling that toolbox in a fixed order; the coordinator and the swarm are Claude Code agents (generated from the same prompt files) calling the same toolbox through Bash, steered by a `/direct` skill.

**Tech Stack:** TypeScript (ESM, `tsx`), zod 4, vitest, `@anthropic-ai/sdk` through the existing `ParseTransport`, Claude Code subagents and agent teams, headless Chrome for the explainer PDF.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-architectures-lab-design.md`

## Global Constraints

- **No paid call anywhere in this plan.** No test, step or verification calls a model, the network, or a generation API. The owner runs the live runs. Tests use fake transports and saved HTML.
- Specialists run on `claude-sonnet-5-5`; the coordinator and swarm leads on `claude-opus-5-5`; all at effort `high`. The rest of the repo keeps `claude-opus-5`; `DEFAULT_MODEL` is unchanged.
- Never a date-suffixed model id.
- Prompt and assembler-template files are append-only: v1 files are not edited (not even to add `export`); v2 is a new file.
- Checks are code. No model checks a model.
- `MAX_RETRIES_PER_OWNER` = 2 (from the contract). Three refused saves in a row for the same step ends the run `failed`.
- Terminal states: `done`, `stopped`, `failed`; `lab report` shows a still-`running` run as `abandoned`. Only `done` is a success, in every message any command or skill prints.
- The Director app (`orchestrate/director/*`, routes, frontend) keeps its behaviour; the existing 651 tests stay green.
- Lab types live in `apps/backend/src/lab/types.ts`; `FilledBrief`, `Plan`, `Camera`, `CheckOutcome` come from `@ai-director/contract` and are never redefined.
- Run folders: `data/lab-runs/<YYYYMMDD-HHMMSS>-<arch>/`. Media stays local. Never commit a key.
- Commit on the current branch `ai-director`; never create a branch.

## Review Focus

1. **A brief with only a brand name and no URL** ("an ad for Apple"): no scrape, the Interrogator must ask for the website with a suggestion, and `lab scrape` after the answer must work. Test in Task 2 (`scrape` absent) and Task 6 (`questions` with a `website` topic accepted when `scrape.json` has no text).
2. **A site that returns almost nothing** (a JavaScript-rendered page, a 403, a timeout): the run goes on with the error recorded, never crashes. Tests in Task 2.
3. **An agent that ignores a `redo`/`stop` route and calls `lab assemble` anyway**: refused, run unchanged. Test in Task 7.
4. **The Director revises the plan after cameras exist** (swarm): old cameras become stale, `check shots` and `assemble` refuse them. Test in Task 7.
5. **JSON pasted with a code fence or prose around it** (common from Claude Code agents through stdin): refused with a clear reason, counted as a refused save, never half-parsed. Test in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/src/lab/types.ts` | Lab-only types: `LabArch`, `LabRun`, `LabQuestion(s)`, `LabAnswers`, `LabBrief`, `CameraSet`, `TraceLine`, `LabMetrics` |
| `apps/backend/src/lab/runStore.ts` | The run folder: create, read/write `run.json`, attempt files, `trace.jsonl`, `calls.jsonl` |
| `apps/backend/src/lab/scrape.ts` | One-page scraper: `extractPage` (pure) and `scrapeUrl` (fetch injected) |
| `apps/backend/src/agents/interrogator/prompt-v2.ts` | Interrogator v2: *ask* and *fill* prompts |
| `apps/backend/src/agents/interrogator/runV2.ts` | `askQuestions`, `fillBrief` |
| `apps/backend/src/agents/director/prompt-v2.ts` | Director v2 (text-only product), request and patch request from `LabBrief` |
| `apps/backend/src/agents/cinematographer/prompt-v2.ts` | Cinematographer v2 (no "picture" wording) |
| `apps/backend/src/orchestrate/director/assemblePrompt/v2.ts` | Text-only template strings |
| `apps/backend/src/lab/assemble.ts` | `assembleTextPrompt` + `renderShotList` |
| `apps/backend/src/lab/commands.ts` | `labNew`, `labScrape`, `labAvatars`, `labShow`, `labSave`, `labCheck`, `labAssemble`, `labStop`, `labLog` |
| `apps/backend/src/lab/metrics.ts` | `labReport`, `labCompare`, `labRate` |
| `apps/backend/src/lab/collect.ts` | `labCollect`: Claude Code transcripts → redacted `transcript.jsonl` |
| `apps/backend/src/lab/sequential.ts` | The recipe: `sequentialAsk`, `sequentialFinish` |
| `apps/backend/src/lab/agentFiles.ts` | `renderAgentFiles` → `.claude/agents/lab-*.md` |
| `apps/backend/src/cli/lab.ts` | The CLI: argument parsing, JSON to stdout |
| `.claude/agents/lab-{interrogator,director,cinematographer}.md` | Generated |
| `.claude/skills/direct/SKILL.md` | `/direct` |
| `docs/decision-log.md` | Two entries (models, lab) |
| `docs/agent-architectures-implementation.html` / `.pdf` | The simple implementation explainer with code snippets |

Tests mirror under `apps/backend/tests/lab/` and `apps/backend/tests/agents/*/`.

---

### Task 1: Lab types and the run store

**Files:**
- Create: `apps/backend/src/lab/types.ts`, `apps/backend/src/lab/runStore.ts`
- Test: `apps/backend/tests/lab/runStore.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export const LAB_ARCHS = ["sequential", "coordinator", "swarm"] as const;
  export type LabArch = (typeof LAB_ARCHS)[number];
  export type LabStatus = "running" | "done" | "stopped" | "failed";
  export type LabStep = "questions" | "answers" | "brief" | "plan" | "cameras";
  export const QUESTION_TOPICS = ["website", "product", "location", "avatar", "length", "mustNotAppear", "other"] as const;
  export type LabQuestion = { id: string; topic: (typeof QUESTION_TOPICS)[number]; question: string; ifYouDecide: string };
  export type LabAnswers = { answers: Array<{ id: string; answer: string }> };   // "you decide" is a valid answer
  export type LabBrief = FilledBrief & { product: string; seconds: number; mustNotAppear: string[];
    avatar: { avatarId: string; description: string } | null };
  export type CameraSet = { forPlan: number; cameras: Camera[] };
  export type CheckRecord = { attempt: number; forPlan: number; passed: boolean; outcomes: CheckOutcome[] };
  export type LabRun = { id: string; arch: LabArch; brief: string; url: string | null; startedAt: string;
    finishedAt: string | null; status: LabStatus; reason: string | null;
    attempts: { plan: number; cameras: number };
    refusedInARow: Record<LabStep, number>; refusedTotal: Record<LabStep, number>;
    lastChecks: { plan: CheckRecord | null; shots: CheckRecord | null };
    pendingReshoot: { forCameras: number; shots: number[] } | null;
    rating: { score: number; note: string } | null };
  export type TraceLine = { at: string; actor: string; kind: "new" | "scrape" | "save" | "refused" | "check"
    | "assemble" | "stop" | "fail" | "message" | "step"; text: string; to?: string };
  ```
- Produces (runStore.ts), all paths under a `root` (default `data/lab-runs`) so tests use a temp dir:
  - `createRun(root, args: { arch: LabArch; brief: string; url: string | null; now?: Date }): Promise<LabRun>`: id `YYYYMMDD-HHMMSS-<arch>` (UTC), writes `run.json`; a second run in the same second gets `-2`, `-3` suffix before `-<arch>`
  - `readRun(root, id): Promise<LabRun>` (throws `LabError` "no run <id>")
  - `writeRun(root, run): Promise<void>` (atomic: write tmp, rename)
  - `readJson<T>(root, id, file): Promise<T | null>`, `writeJson(root, id, file, value): Promise<void>`
  - `appendTrace(root, id, line: Omit<TraceLine, "at">, now?: Date): Promise<void>`, `readTrace(root, id): Promise<TraceLine[]>`
  - `appendCalls(root, id, calls: CallLog[]): Promise<void>`, `readCalls(root, id): Promise<CallLog[]>`
  - `export class LabError extends Error` (name `"LabError"`): every refusal the CLI prints as `{ ok: false, error }`

- [ ] **Step 1: Write failing tests** in `runStore.test.ts`: `createRun` writes `run.json` with `status: "running"`, attempts `{plan:0,cameras:0}`, all counters 0, id matching `/^\d{8}-\d{6}-sequential$/`; two runs created with the same `now` get distinct ids; `appendTrace` twice then `readTrace` returns both lines in order with `at` set; `readRun` of a missing id rejects with `LabError`.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/runStore.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `runStore.ts` as above (`node:fs/promises`, JSON pretty-printed with 2 spaces and a trailing newline, like the other stores).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add apps/backend/src/lab apps/backend/tests/lab && git commit -m "feat(lab): run folder store and lab types"`

---

### Task 2: The scraper

**Files:**
- Create: `apps/backend/src/lab/scrape.ts`, `apps/backend/tests/lab/fixtures/product-page.html` (hand-written, ~60 lines: title, meta description, og tags, nav, h1, h2s, paragraphs, a `<script>`, a footer)
- Test: `apps/backend/tests/lab/scrape.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ScrapeResult = { url: string; finalUrl: string | null; ok: boolean; error: string | null;
    title: string | null; description: string | null; ogTitle: string | null; ogDescription: string | null;
    headings: string[]; text: string; fetchedAt: string };
  export const SCRAPE_TEXT_CAP = 6000;
  export function extractPage(html: string): Omit<ScrapeResult, "url" | "finalUrl" | "ok" | "error" | "fetchedAt">;
  export async function scrapeUrl(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): Promise<ScrapeResult>;
  ```
  No HTML parser dependency: regex extraction of `<title>`, `<meta name="description">`, `<meta property="og:*">`, `<h1>`–`<h3>`; body text after removing `script`, `style`, `noscript`, `nav`, `footer`, `svg` blocks and all tags, decoding `&amp; &lt; &gt; &quot; &#39; &nbsp;`, collapsing whitespace, capped at `SCRAPE_TEXT_CAP`. `scrapeUrl` never throws: a bad URL, non-2xx status (`"HTTP 403"`), timeout (`AbortSignal.timeout`) or fetch error returns `ok: false` with the error and empty fields. User agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36`.

- [ ] **Step 1: Write failing tests:**
  - `extractPage(fixture)`: title, description, og fields, headings `["<h1 text>", ...]` in document order; `text` contains a paragraph sentence and does **not** contain the script's code, the nav links or the footer text; `&amp;` decoded.
  - `text.length <= SCRAPE_TEXT_CAP` on a fixture repeated 50 times.
  - `scrapeUrl` with a fake fetch returning the fixture (status 200, `url` set): `ok: true`, `finalUrl` is the response url.
  - fake fetch returning status 403: `ok: false`, `error: "HTTP 403"`, `text: ""`.
  - fake fetch that rejects: `ok: false`, error message kept.
  - `scrapeUrl("not a url")`: `ok: false`, no fetch call made.
  - an empty-body page (`<html><body><div id="root"></div><script>…</script></body></html>`): `ok: true`, `text: ""` (the JS-rendered case is recorded, not worked around).
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/scrape.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `scrape.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): one-page scraper`

---

### Task 3: Interrogator v2 (ask, then fill)

**Files:**
- Create: `apps/backend/src/agents/interrogator/prompt-v2.ts`, `apps/backend/src/agents/interrogator/runV2.ts`
- Modify: `apps/backend/src/agents/interrogator/schema.ts` (append two schemas; schemas are not prompt files)
- Test: `apps/backend/tests/agents/interrogator/runV2.test.ts`

**Interfaces:**
- Consumes: `ParseTransport` (`api/client.ts`), `ScrapeResult` (Task 2), `LabQuestion`, `LabAnswers`, `LabBrief` (Task 1), `isValidVideoSeconds` (contract).
- Produces:
  ```ts
  // schema.ts
  export const InterrogatorQuestionsSchema = z.object({ questions: z.array(z.object({
    id: z.string(), topic: z.enum(QUESTION_TOPICS), question: z.string(), ifYouDecide: z.string() })) });
  export const InterrogatorFillSchema = z.object({ productKind: z.string(), product: z.string(), audience: z.string(),
    tone: z.string(), setting: z.string(), character: z.string(), seconds: z.number().int(),
    mustNotAppear: z.array(z.string()), avatarId: z.string().nullable() });
  // prompt-v2.ts
  export const INTERROGATOR_PROMPT_VERSION_V2 = "v2";
  export function buildInterrogatorAskSystemPrompt(): string;
  export function buildInterrogatorFillSystemPrompt(): string;
  export type AvatarChoice = { avatarId: string; description: string };
  export function renderAskRequest(args: { brief: string; scrape: ScrapeResult | null; avatars: AvatarChoice[] }): string;
  export function renderFillRequest(args: { brief: string; scrape: ScrapeResult | null; avatars: AvatarChoice[];
    questions: LabQuestion[]; answers: LabAnswers }): string;
  // runV2.ts
  export const MAX_QUESTIONS = 6;
  export function validateQuestions(raw: unknown): LabQuestion[];            // throws LabError with the reason
  export function validateFill(raw: unknown, args: { brief: string; avatars: AvatarChoice[] }): LabBrief;
  export async function askQuestions(deps: { transport: ParseTransport }, args: Parameters<typeof renderAskRequest>[0]): Promise<LabQuestion[]>;
  export async function fillBrief(deps: { transport: ParseTransport }, args: Parameters<typeof renderFillRequest>[0]): Promise<LabBrief>;
  ```
- Prompt content, fixed by the spec (section 2 step 3, 4.3): *ask* lists only what the brief and scrape leave open, at most `MAX_QUESTIONS`, each topic at most once, each with `ifYouDecide` naming the concrete choice it will make; asks `website` only when the scrape is missing or empty and suggests a URL in `ifYouDecide`; asks `avatar` listing the saved avatars by id plus "a new person"; never asks about craft (tone, audience, shots). *fill* decides everything left (as v1's "You decide. Never ask…"), uses the owner's answers verbatim where given, treats "you decide" as the matching `ifYouDecide`; `product` says what the product is and what a camera sees (shape, materials, colours) from the scrape, no brand name, logo, lettering or label text; `seconds` 4–30; `avatarId` is a listed id or null. Keep v1's three rules (no brands/logos/slogans in any field; things a camera can show; English).
- `validateQuestions`: schema parse; ids unique and non-blank; `question` and `ifYouDecide` non-blank; length ≤ `MAX_QUESTIONS`; no topic twice except `other`. Zero questions is valid (a detailed brief).
- `validateFill`: schema parse; the five v1 decided fields and `product` non-blank; `isValidVideoSeconds(seconds)` else `LabError("seconds must be 4-30")`; `avatarId` either null or one of `avatars` (then `avatar` = that id + its stored description, byte-identical), else `LabError("unknown avatar <id>")`; `suggestedSeconds` = `seconds`; `brief` = the caller's brief, never the model's.

- [ ] **Step 1: Write failing tests** (fake transport returns canned `parsed_output`; assert on the `system`/`user` it received):
  - `askQuestions` sends `buildInterrogatorAskSystemPrompt()` and a user message containing the brief, the scrape title and each avatar id; returns validated questions.
  - `validateQuestions` refuses: duplicate id; 7 questions; `topic: "length"` twice; blank `ifYouDecide`. Accepts `[]`.
  - `renderAskRequest` with `scrape: null` contains `"No website was given."`; with `ok: false` contains the error.
  - `fillBrief` returns a `LabBrief` with `brief` equal to the caller's text even when the model's output differs.
  - `validateFill` refuses `seconds: 45`, `product: " "`, `avatarId: "nope"`; with a listed avatar sets `avatar.description` byte-identical to the stored one.
  - The ask system prompt contains `"you decide"` and the literal `"6"`; the fill prompt contains v1's rule `"No brand names, logos, slogans or trademarks"`.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/agents/interrogator/runV2.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** again, then `npx vitest run apps/backend/tests/agents/interrogator` (v1 still passes). Expected: PASS.
- [ ] **Step 5: Commit** `feat(interrogator): v2 asks what is missing, then fills the brief`

---

### Task 4: Director v2 and Cinematographer v2 prompts

**Files:**
- Create: `apps/backend/src/agents/director/prompt-v2.ts`, `apps/backend/src/agents/cinematographer/prompt-v2.ts`
- Modify: `apps/backend/src/agents/director/run.ts` (export `askForPlan`, `assertPlanShape`, `lowerCaseHandles`, and `assetChanges` under the name `planAssetChanges`; no behaviour change), `apps/backend/src/agents/cinematographer/run.ts` (optional last parameter, below)
- Test: `apps/backend/tests/agents/director/promptV2.test.ts`, `apps/backend/tests/agents/cinematographer/promptV2.test.ts`

**Interfaces:**
- Consumes: v1 exports `buildDirectorSystemPrompt`, `buildDirectorPatchSystemPrompt`, `DIRECTOR_V1_CHECK_LABELS` (director prompt-v1); `buildCinematographerSystemPrompt`, `buildCinematographerReshootSystemPrompt`, `renderShootRequest`, `renderReshootRequest` (cinematographer prompt-v1); `LabBrief` (Task 1).
- Produces:
  ```ts
  // director/prompt-v2.ts
  export const DIRECTOR_PROMPT_VERSION_V2 = "v2";
  export function buildDirectorSystemPromptV2(): string;
  export function buildDirectorPatchSystemPromptV2(): string;
  export function renderLabDirectorRequest(brief: LabBrief): string;
  export function renderLabDirectorPatchRequest(args: { brief: LabBrief; plan: Plan; failures: CheckOutcome[] }): string;
  // cinematographer/prompt-v2.ts
  export const CINEMATOGRAPHER_PROMPT_VERSION_V2 = "v2";
  export const CINEMATOGRAPHER_PROMPTS_V2: CinematographerPrompts;
  // cinematographer/run.ts (added)
  export type CinematographerPrompts = { system: string; reshootSystem: string;
    renderShoot: typeof renderShootRequest; renderReshoot: typeof renderReshootRequest };
  shootAll(deps, args, prompts: CinematographerPrompts = V1)   // V1 = the current imports, so existing callers are unchanged
  reshoot(deps, args, prompts: CinematographerPrompts = V1)
  ```
- **How v2 is built (the spec's text changes, nothing else):** v2 derives from v1's output by exact line replacement and throws at module load if a v1 line it replaces is not found, so a v1 change can never silently drift v2.
  - Director system prompt: replace the line starting `"- The product's description says what kind of thing it is"` with
    `"- The product's description says what kind of thing it is and what a camera sees of it: its shape, materials and colours, from the website text in the request. Never a brand name, logo, lettering or label text: the ad shows no brand, and words on a label are how a label gets rewritten."`;
    replace `" It is painted as a picture with nobody in the frame."` with `""` inside the location line.
  - Director patch system prompt: `buildDirectorPatchSystemPrompt().replace(buildDirectorSystemPrompt(), buildDirectorSystemPromptV2())`.
  - `renderLabDirectorRequest`: v1's layout with these lines: `The owner's brief: …`; `- Product kind: …`; `- The product, as the website and the owner describe it: …`; audience, tone, setting, character; the length line from `seconds` (same wording as v1, tolerance `LENGTH_TOLERANCE_SECONDS`); the ruled-out line (v1 wording); the cast line (v1 wording: avatar if `brief.avatar` else new person).
  - `renderLabDirectorPatchRequest`: the request, the plan JSON, failures rendered as v1 does (`- <DIRECTOR_V1_CHECK_LABELS[id]> — failed: <detail>. Shots: …`), `"Return the whole plan with these failures fixed."`.
  - Cinematographer: system prompt with `" You have not seen the location picture; it is painted from that description."` replaced by `""`; reshoot system = `buildCinematographerReshootSystemPrompt().replace(buildCinematographerSystemPrompt(), <v2 system>)`; `renderShoot`/`renderReshoot` = v1's output with `"Location, the picture is painted from this"` replaced by `"Location"`.

- [ ] **Step 1: Write failing tests:** v2 Director prompt contains the new product line and not `"the owner's photo carries the look"` nor `"painted as a picture"`; every other line equals v1's (compare line arrays minus the two changed); the patch prompt ends with v1's `"## Fixing a plan"` section; `renderLabDirectorRequest` contains the product text, `"chose 15 seconds"`, the avatar cast sentence when `avatar` is set; Cinematographer v2 texts contain no `"picture"`; `shootAll(fake, args, CINEMATOGRAPHER_PROMPTS_V2)` sends the v2 system prompt; `shootAll(fake, args)` still sends v1's.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/agents`. Expected: new tests FAIL, old ones PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/backend/tests/agents apps/backend/tests/orchestrate` and `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(director,cinematographer): v2 prompts for a text-only product`

---

### Task 5: Text-only assembler

**Files:**
- Create: `apps/backend/src/orchestrate/director/assemblePrompt/v2.ts`, `apps/backend/src/lab/assemble.ts`
- Test: `apps/backend/tests/lab/assemble.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Camera`, `SEEDANCE_PROMPT_CHAR_CAP` (contract); v1 template exports; `AssemblyInvariantError` (`orchestrate/director/assemble.ts`).
- Produces:
  ```ts
  // assemblePrompt/v2.ts — re-exports v1's CLOSING_LINE, PART_SEPARATOR, LINE_SEPARATOR, heroLine, sceneLine, shotLine; adds:
  export const ASSEMBLE_PROMPT_VERSION_V2 = "v2";
  export const productLine = (handle: string, description: string) => `Product (${handle}): ${withoutFinalPeriod(description)}.`;
  export const locationLine = (handle: string, description: string) => `Location (${handle}): ${withoutFinalPeriod(description)}.`;
  // lab/assemble.ts
  export function assembleTextPrompt(args: { plan: Plan; cameras: Camera[]; characterText: string }): { text: string; sha256: string };
  export function renderShotList(args: { plan: Plan; cameras: Camera[]; characterText: string; brief: LabBrief }): string;
  ```
- Order of parts (joined by `PART_SEPARATOR`): product line + `LINE_SEPARATOR` + location line; style line; hero line; scene line; shot lines; closing line. Invariants (throw `AssemblyInvariantError`): exactly one product, location and character asset; every shot has a camera; the style line, `characterText`, and both asset descriptions (minus a final period) appear verbatim; each `Shot n:` exactly once; length ≤ `SEEDANCE_PROMPT_CHAR_CAP`.
- `renderShotList` is markdown: `# Shot list`, the brief line, length in seconds (`plannedSeconds`), product/location/character, then a table `| # | What happens | Camera | Light | Sound |`.

- [ ] **Step 1: Write failing tests** using `boardPlan()`/`boardCameras()` from `tests/orchestrate/director/planFixture.ts`: text starts with `"Product (@product): the product bottle, front label to camera."`; contains `"HERO (@maya): <characterText>"` byte-identical; `Shot 1:` … `Shot 4:` once each; ends with `CLOSING_LINE`; a camera missing for shot 3 throws `AssemblyInvariantError`; a plan with two locations throws; `renderShotList` has 4 table rows and `15 s`.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/assemble.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): text-only assembler and readable shot list`

---

### Task 6: `lab new`, `scrape`, `avatars`, `show`, `log`, `save`

**Files:**
- Create: `apps/backend/src/lab/commands.ts`
- Test: `apps/backend/tests/lab/save.test.ts`, `apps/backend/tests/lab/commands.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `DirectorPlanSchema`, `askForPlan`-free helpers `assertPlanShape`, `planAssetChanges` (Task 4); `CinematographerOutputSchema`; `FileAvatarStore` (`store/AvatarStore.ts`) for avatars with a non-empty `description`.
- Produces (every command takes a `LabEnv = { root: string; avatarsDir: string; now?: () => Date; fetchImpl?: typeof fetch }` first and returns a JSON-able result; refusals throw `LabError`):
  ```ts
  export async function labNew(env, args: { arch: LabArch; brief: string; url: string | null }): Promise<{ runId: string; scrape: ScrapeResult | null }>;
  export async function labScrape(env, runId: string, url: string): Promise<ScrapeResult>;
  export async function labAvatars(env): Promise<AvatarChoice[]>;
  export async function labShow(env, runId: string, file?: string): Promise<unknown>;  // no file: { run, brief, questions, answers, latestPlan, latestCameras, lastChecks }
  export async function labLog(env, runId: string, args: { from: string; to: string; text: string }): Promise<{ ok: true }>;
  export async function labSave(env, runId: string, step: LabStep, json: string, by: string): Promise<{ ok: true; file: string; attempt?: number }>;
  export function parseAgentJson(text: string): unknown;   // JSON.parse of the trimmed text; anything else (a fence, prose) → LabError("not a single JSON value: …")
  ```
- `labSave` rules (spec section 2, in this order):
  1. Run must be `running`, else `LabError("run is <status>")`.
  2. Parse with `parseAgentJson`, validate per step: `questions` → `validateQuestions`; `answers` → schema `{answers:[{id,answer}]}` with every question id answered exactly once; `brief` → `validateFill` (needs `questions` and `answers` saved); `plan` → `DirectorPlanSchema.parse` + `lowerCaseHandles` (exported in Task 4) + `assertPlanShape`, and for attempt ≥ 2 `planAssetChanges(previous, next)` must be empty; `cameras` → `CinematographerOutputSchema.parse` + positive finite `lensMm`, needs a plan; if `pendingReshoot` is set for the latest camera set and the plan has not changed since, every camera outside `pendingReshoot.shots` must be deep-equal to the previous set's, and the listed shots must have exactly one camera each.
  3. `questions`, `answers`, `brief` are refused once a plan exists (`"the brief is fixed once a plan exists"`).
  4. Retry cap: saving plan attempt `n` with `n - 1 > MAX_RETRIES_PER_OWNER` (same for cameras) ends the run `stopped` with reason `"director out of retries"` / `"cinematographer out of retries"` and throws `LabError` with that reason.
  5. On a refusal: `refusedInARow[step]++`, `refusedTotal[step]++`, trace `kind: "refused"`; the third in a row sets the run `failed` (reason `"3 invalid <step> saves in a row"`). On success: `refusedInARow[step] = 0`.
  6. Writes `questions.json`, `answers.json`, `brief.json`, `plan.<n>.json`, `cameras.<n>.json` (a `CameraSet` with `forPlan` = latest plan attempt); a new plan clears `lastChecks.shots` and `pendingReshoot`; trace `kind: "save"` with `actor: by`.

- [ ] **Step 1: Write failing tests** in `save.test.ts` (temp root, `boardPlan()` fixtures):
  - `parseAgentJson` refuses "```json\n{…}\n```" and "Here is the plan: {…}"; accepts `"  {…}\n"`.
  - plan 1 saves as `plan.1.json`, attempts.plan = 1.
  - plan 2 that renames `@kitchen` → refused, `refusedInARow.plan = 1`, no `plan.2.json`.
  - three refused plan saves in a row → run `failed`, a fourth save → `LabError("run is failed")`.
  - plans 2 and 3 accepted, plan 4 → run `stopped`, reason `"director out of retries"`.
  - cameras before any plan → refused; cameras saved get `forPlan: 1`.
  - with `pendingReshoot = {forCameras:1, shots:[2]}`: a set changing shot 1's light → refused; a set changing only shot 2 → accepted.
  - a new plan after cameras exist clears `lastChecks.shots` and `pendingReshoot`.
  - `answers` missing a question id → refused; `brief` after a plan exists → refused.
  - Review Focus 1: `questions` with a `website` topic saves fine when `scrape.json` is absent.
- [ ] **Step 2: Write failing tests** in `commands.test.ts`: `labNew` with a url and a fake fetch writes `scrape.json` and a `"new"` and a `"scrape"` trace line; without a url, `scrape` is null and no fetch is called; `labAvatars` lists the avatar from a temp avatars dir with its description; `labShow(runId)` returns `latestPlan: null` before any plan; `labLog` appends `{ kind: "message", actor: from, to, text }`.
- [ ] **Step 3: Run** `npx vitest run apps/backend/tests/lab`. Expected: new tests FAIL.
- [ ] **Step 4: Implement** `commands.ts` (the six commands above).
- [ ] **Step 5: Run** again. Expected: PASS.
- [ ] **Step 6: Commit** `feat(lab): run, scrape, avatars, show, log and validated save`

---

### Task 7: `lab check`, `assemble`, `stop`

**Files:**
- Modify: `apps/backend/src/lab/commands.ts`
- Test: `apps/backend/tests/lab/check.test.ts`

**Interfaces:**
- Consumes: `runPlanChecks`, `runPromptChecks` (`orchestrate/director/checks.ts`), `route` (`router.ts`), `assembleTextPrompt`, `renderShotList` (Task 5).
- Produces:
  ```ts
  export async function labCheck(env, runId: string, which: "plan" | "shots", by: string):
    Promise<{ passed: boolean; outcomes: CheckOutcome[]; route: Route }>;
  export async function labAssemble(env, runId: string, by: string): Promise<{ status: "done"; promptFile: string; shotListFile: string; chars: number }>;
  export async function labStop(env, runId: string, reason: string, by: string): Promise<{ status: "stopped" }>;
  ```
- `labCheck plan`: latest plan, `runPlanChecks(plan, brief.seconds, brief.mustNotAppear)`. `labCheck shots`: latest camera set must have `forPlan` = latest plan attempt (else `LabError("cameras are stale: made for plan <k>, latest is <n>")`), `runPromptChecks`. Retries passed to `route` = `{ director: attempts.plan - 1, cinematographer: max(0, attempts.cameras - 1) }`, only the failing outcomes of this `which`. Records `lastChecks[which] = { attempt, forPlan, passed, outcomes }`; on `redo` for the cinematographer sets `pendingReshoot = { forCameras: attempts.cameras, shots }`; on `stop` sets the run `stopped` with the route's reason. Writes `checks.<which>.<attempt>.json`; trace `kind: "check"`, text like `"plan checks: 4 of 5 passed → redo director (length_fits)"`.
- `labAssemble`: refuses unless `lastChecks.plan.passed` for the latest plan attempt AND `lastChecks.shots.passed` for the latest camera attempt AND that camera set's `forPlan` is the latest plan attempt AND run is `running`. Character text = `brief.avatar?.description` ?? the plan's character asset description. Writes `prompt.txt`, `shotlist.md`; run `done`, `finishedAt` set; trace `kind: "assemble"`.
- `labStop`: run `running` → `stopped`, reason, trace `kind: "stop"`.

- [ ] **Step 1: Write failing tests:**
  - a passing plan → `{ passed: true, route: { kind: "pass" } }`, `lastChecks.plan.passed`.
  - a 2-shot plan for 15 s → `length_fits` fails, `route.kind === "redo"`, owner `director`.
  - attempt 3 still failing → `route.kind === "stop"`, run `stopped`.
  - cameras with a light lacking direction on shot 2 → redo cinematographer, `pendingReshoot.shots = [2]`.
  - Review Focus 4: plan 2 saved after cameras for plan 1 → `labCheck shots` throws "cameras are stale"; `labAssemble` refuses.
  - Review Focus 3: `labAssemble` after a failing shot check → `LabError`, run still `running`, no `prompt.txt`.
  - full pass → `labAssemble` writes `prompt.txt` with `Shot 1:`, run `done`; a second `labAssemble` → `LabError("run is done")`.
  - with `brief.avatar` set, `prompt.txt` contains the avatar description byte-identical.
  - `labStop` → `stopped`; then `labSave` refuses.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/check.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run apps/backend/tests/lab`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): code checks, routing, caps and assembly gate`

---

### Task 8: The sequential recipe

**Files:**
- Create: `apps/backend/src/lab/sequential.ts`
- Test: `apps/backend/tests/lab/sequential.test.ts`

**Interfaces:**
- Consumes: `askQuestions`, `fillBrief` (Task 3); `askForPlan`, `assertPlanShape` and v2 Director renderers (Task 4); `shootAll`, `reshoot` with `CINEMATOGRAPHER_PROMPTS_V2`; `meter` (`orchestrate/director/metered.ts`); every command from Tasks 6–7; `appendCalls` (Task 1).
- Produces:
  ```ts
  export const LAB_SPECIALIST_MODEL = "claude-sonnet-5-5";
  export const MAX_ASKS_PER_STEP = 3;
  export type SequentialDeps = { env: LabEnv; transport: ParseTransport; print: (line: string) => void };
  export async function sequentialAsk(deps: SequentialDeps, runId: string): Promise<LabQuestion[]>;
  export async function sequentialFinish(deps: SequentialDeps, runId: string): Promise<LabRun>;
  ```
- `sequentialAsk`: refuses unless `arch === "sequential"`; *ask* call → `labSave(questions, by "interrogator")`. Zero questions → saves `{answers: []}` itself.
- `sequentialFinish` (needs `answers.json`), fixed order, every model output saved through `labSave` (so the same rules apply), and each step re-asked on a thrown error or a refused save up to `MAX_ASKS_PER_STEP` in a row (the third refusal has already made the run `failed`; stop then):
  1. if `answers` contains a `website` answer that is a URL and there is no `scrape.json` with text, `labScrape`;
  2. *fill* → save `brief`;
  3. Director (attempt 1 `askForPlan(system V2, renderLabDirectorRequest)`, later attempts the patch prompt with the last check failures) → save `plan` → `labCheck plan` → loop on `redo`, return on `stop`;
  4. Cinematographer (`shootAll`, then `reshoot` with `pendingReshoot.shots` and the failures) → save `cameras` → `labCheck shots` → loop;
  5. `labAssemble`. (The CLI's `sequential finish` then runs `lab report`, Task 9/10.)
  Each model call goes through `meter(transport, <promptVersion>)` and its `CallLog`s are appended to `calls.jsonl` with `appendCalls`. `print` gets one line per step: `"[director] plan 1: 4 shots, 15 s planned"`, `"[checks] plan: 5 of 5 passed"`, `"[route] redo director: length_fits"`.
- The CLI (Task 10) builds the real transport with `createAnthropicTransport(LAB_SPECIALIST_MODEL)`. Tests never do.

- [ ] **Step 1: Write failing tests** with a scripted fake transport (returns the next canned `parsed_output` per call, chosen by which schema it was given):
  - happy path: questions → answers saved by the test → finish → run `done`, `prompt.txt` exists, `calls.jsonl` has 4 lines (ask, fill, director, cinematographer), printed lines include `"[route]"` none.
  - redo then pass: first plan 2 shots for 15 s, patch passes → `plan.2.json`, run `done`, a printed `"[route] redo director"`.
  - stop: three failing plans → run `stopped`, no `prompt.txt`.
  - invalid output: Director returns a plan with two products three times → run `failed`.
  - a run with `arch: "coordinator"` → `sequentialAsk` rejects with `LabError`.
  - the transport is never a real one: assert `createAnthropicTransport` is not imported by `sequential.ts` (it is injected).
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/sequential.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): the sequential recipe`

---

### Task 9: Metrics, compare, rate, collect

**Files:**
- Create: `apps/backend/src/lab/metrics.ts`, `apps/backend/src/lab/collect.ts`, `apps/backend/tests/lab/fixtures/session.jsonl`, `apps/backend/tests/lab/fixtures/subagent.jsonl` (hand-written, a few lines each in the shape below)
- Test: `apps/backend/tests/lab/metrics.test.ts`, `apps/backend/tests/lab/collect.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LabMetrics = { runId: string; arch: LabArch; status: LabStatus | "abandoned"; reason: string | null;
    wallSeconds: number | null; questionsAsked: number;
    invocations: Record<string, number>;       // per agent: recipe calls, or saves+checks by that actor for Claude Code runs
    apiRequests: number | null; tokens: { input: number; output: number; byAgent: Record<string, { input: number; output: number }> } | null;
    retries: { director: number; cinematographer: number }; refusedSaves: Record<LabStep, number>;
    firstTryPass: { plan: boolean | null; shots: boolean | null };
    models: string[]; efforts: string[]; rating: { score: number; note: string } | null };
  export async function labReport(env, runId: string): Promise<LabMetrics>;     // writes metrics.json
  export async function labCompare(env, runIds: string[]): Promise<string>;     // markdown table; no ids = every run
  export async function labRate(env, runId: string, score: number, note: string): Promise<{ ok: true }>;  // 1-5 integer
  export async function labCollect(env, runId: string, sessionIds: string[], projectsDir?: string): Promise<{ lines: number; files: string[] }>;
  export function redact(text: string): string;
  ```
- `labReport`: status `abandoned` when the run is still `running`; `firstTryPass` from the first `check` trace line of each kind; tokens from `calls.jsonl` for sequential runs, from `transcript.jsonl` for the others, else `null`; `wallSeconds` from `startedAt` to `finishedAt` (or null).
- `labCollect`: `projectsDir` defaults to `~/.claude/projects/<cwd with "/" → "-">`. For each session id reads `<id>.jsonl` and every `<id>/subagents/*.jsonl`. Keeps lines with `type` `"user"` or `"assistant"`; one output line per message: `{ session, agent ("lead" or the subagent file name), role, model, effort, text (text blocks joined, tool_use rendered as "[tool] <name> <first 300 chars of input JSON>", tool_result as "[result] <first 300 chars>"), usage }`. Assistant lines sharing a `requestId` are one API request: usage counted once per `requestId`. Every `text` goes through `redact`: `sk-ant-[A-Za-z0-9_-]+`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{20,}`, `Bearer \S+`, and any `KEY=value` / `TOKEN=value` / `SECRET=value` assignment → `[redacted]`. Writes `transcript.jsonl` in the run folder. A missing session file → `LabError`.

- [ ] **Step 1: Write failing tests:** `labReport` on a finished fake sequential run (calls.jsonl with 4 calls) sums tokens; on a `running` run → `abandoned`; `labCompare` table has a header and one row per run with status and tokens; `labRate(…, 6, …)` → `LabError`; `labCollect` on the fixtures writes lead and subagent lines, counts two assistant lines with one `requestId` once, and `redact("ANTHROPIC_API_KEY=sk-ant-abc123")` contains no `sk-ant`.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/metrics.test.ts apps/backend/tests/lab/collect.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): metrics, compare, rating and transcript collection`

---

### Task 10: The `lab` CLI

**Files:**
- Create: `apps/backend/src/cli/lab.ts`
- Modify: `package.json` (add `"lab": "tsx apps/backend/src/cli/lab.ts"`), `.gitignore` only if `data/lab-runs` would be ignored (it must be committed)
- Test: `apps/backend/tests/lab/cli.test.ts`

**Interfaces:**
- Consumes: every command above.
- Produces: `export async function runLabCli(argv: string[], io: { stdin: () => Promise<string>; stdout: (s: string) => void; env: LabEnv; transport?: ParseTransport }): Promise<number>` (exit code); the file's main calls it with `process.argv.slice(2)` and the real `createAnthropicTransport(LAB_SPECIALIST_MODEL)` only for `sequential` subcommands.
- Commands and output (stdout is always one JSON value, pretty-printed; `{ ok: false, error }` and exit 1 on `LabError`; exit 2 on bad usage with a usage text):
  `new --arch <a> --brief <text> [--url <u>]` · `scrape <run> <url>` · `avatars` · `show <run> [file]` · `save <run> <step> --by <agent>` (JSON from stdin) · `check <run> <plan|shots> --by <agent>` · `assemble <run> --by <agent>` · `stop <run> --by <agent> <reason>` · `log <run> --from <a> --to <b> <text>` · `report <run>` · `compare [run...]` (prints markdown, not JSON) · `rate <run> <1-5> <note>` · `collect <run> <session...>` · `sequential ask <run>` · `sequential finish <run>` (progress lines go to stderr; then runs `labReport`; the final metrics JSON to stdout) · `export-agents` (Task 11).
- `sequential *` refuses with a clear error if `ANTHROPIC_API_KEY` is unset, before any call.

- [ ] **Step 1: Write failing tests** driving `runLabCli` with fake io: `new` prints `{ runId }`; `save … plan` with stdin JSON prints `{ ok: true, file: "plan.1.json" }`; a refused save exits 1 with `{ ok: false, error }`; unknown command exits 2; `sequential ask` without a key exits 1 mentioning `ANTHROPIC_API_KEY` and makes no transport call.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and add the `lab` script.
- [ ] **Step 4: Run** the test, then `npm run -s lab -- new --arch coordinator --brief "smoke test"` in a shell (no network: no url) and check the printed run id and `data/lab-runs/<id>/run.json`, then delete that smoke run folder. Expected: PASS; folder created.
- [ ] **Step 5: Commit** `feat(lab): the lab command line`

---

### Task 11: Generated agent files

**Files:**
- Create: `apps/backend/src/lab/agentFiles.ts`, `.claude/agents/lab-interrogator.md`, `.claude/agents/lab-director.md`, `.claude/agents/lab-cinematographer.md` (generated)
- Modify: `apps/backend/src/cli/lab.ts` (`export-agents` writes the three files)
- Test: `apps/backend/tests/lab/agentFiles.test.ts`

**Interfaces:**
- Produces: `export function renderAgentFiles(): Record<"lab-interrogator" | "lab-director" | "lab-cinematographer", string>`.
- Each file: frontmatter `name`, `description` (one line, "Lab specialist: … Used by /direct; never invoke on its own."), `tools: Bash, Read`, `model: claude-sonnet-5-5`, `effort: high`; then a **lab header**, then `## Your instructions` followed by the v2 system prompt(s) verbatim (Interrogator: both *ask* and *fill* under `### When asked for questions` / `### When asked to fill the brief`; Director: system and patch; Cinematographer: system and reshoot). Generated files start with `<!-- generated by npm run lab -- export-agents; do not edit -->` after the frontmatter.
- Lab header rules (all three): you work on one run, `data/lab-runs/<runId>/`; read it with `npm run -s lab -- show <runId>`; save your output only with `npm run -s lab -- save <runId> <step> --by <name> <<'JSON'` … `JSON` (one JSON value, no fence); a refusal tells you why: fix and save again, three refusals in a row fail the run; run your own checks (`lab check`) after saving (Director: `plan`; Cinematographer: `shots`, then `lab assemble` when they pass and you are in a swarm); follow the route it prints: `redo` = fix the listed checks/shots, `stop` = stop and report; never write files by hand, never call any other API, never generate images or video; you cannot talk to the owner. Swarm-only lines (marked "If you are a teammate in a swarm:"): hand off with SendMessage to the next teammate by name and also `lab log`; ask a peer a question the same way; send the owner's questions (Interrogator) and "done"/"stopped" to the lead. Coordinator-only line: "If you were called as a subagent: return a two-line summary of what you saved and the check result; the lead decides what happens next."
- `npm run -s lab -- export-agents` overwrites the three files.

- [ ] **Step 1: Write failing tests:** each rendered file's frontmatter has `model: claude-sonnet-5-5`, `effort: high`, `tools: Bash, Read`; the body contains `buildDirectorSystemPromptV2()` byte-identical (and the other agents' v2 prompts); drift test: the committed `.claude/agents/lab-*.md` equal `renderAgentFiles()` (fails until Step 4 writes them).
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/agentFiles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `agentFiles.ts` and the CLI command.
- [ ] **Step 4: Run** `npm run -s lab -- export-agents`, then the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(lab): generated Claude Code agent files`

---

### Task 12: `/direct`, decision log, implementation explainer

**Files:**
- Create: `.claude/skills/direct/SKILL.md`, `docs/agent-architectures-implementation.html`, `docs/agent-architectures-implementation.pdf`
- Modify: `docs/decision-log.md` (two entries at the top, dated 2026-10-29), `docs/architecture.md` (one short section 8 pointing at the lab)
- Test: `apps/backend/tests/lab/skill.test.ts` (static checks of the skill text)

**Interfaces:**
- Consumes: the CLI commands (Task 10), the agent names (Task 11).
- `/direct` frontmatter: `name: direct`, `description` ("Run one brief through the architecture lab: sequential, coordinator or swarm. Text only."), `effort: high`. Body sections, in order:
  1. **Before anything:** ask which architecture (AskUserQuestion: sequential, coordinator, swarm). Coordinator or swarm: tell the owner to have started the session with `claude --model claude-opus-5-5 --effort high` (swarm: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --model claude-opus-5-5 --effort high --teammate-mode tmux`, inside iTerm2 or tmux), to confirm with `/effort status`, and stop if not. Swarm: check `echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is `1` and `$TMUX` or `$ITERM_SESSION_ID` is set, else explain and stop. Never set `CLAUDE_CODE_EFFORT_LEVEL`.
  2. Ask for the brief and the optional website; `npm run -s lab -- new …`.
  3. **Sequential:** `lab sequential ask`; show the questions with AskUserQuestion (each question's `ifYouDecide` as the first option labelled "You decide: …"); `lab save <run> answers --by owner`; `lab sequential finish`; "In this architecture I only pass messages; the code decides every step."
  4. **Coordinator:** you are the lead. Goal: an assembled shot list that passes every check. Specialists: `lab-interrogator`, `lab-director`, `lab-cinematographer` (subagents; never give them a `name`; never write their output yourself). You decide whom to call, in what order, with what brief, and when to give up (`lab stop`). Only you talk to the owner (AskUserQuestion for the Interrogator's questions; save the answers with `--by owner`). After any save, check `lab show`.
  5. **Swarm:** spawn three teammates from the three agent types, named `interrogator`, `director`, `cinematographer`; give each the run id and the names of the others; send the brief to `interrogator`. Then you only relay: the Interrogator's questions to the owner and the answers back (also saved with `--by owner`), and wait for "done" or "stopped". You never plan, route or order anyone. Tell the owner not to message teammates directly during the run.
  6. **End (all three):** `lab report <run>`; print `shotlist.md` if the run is `done`; if `stopped`/`failed`, say so in the first line and never call it a success; coordinator/swarm: `lab collect <run> <this session id and teammates' session ids>`, and remind the owner to read `transcript.jsonl` before committing; offer `lab rate`.
  7. **Never:** call a generation API, render, or any video/image tool; edit lab files by hand.
- Decision-log entries: "Lab models: specialists `claude-sonnet-5-5`, leads `claude-opus-5-5`, all effort high; an exception scoped to the lab, the Director app keeps `claude-opus-5`" and "Architecture lab: one toolbox owns the rules, three wirings; why the swarm has a relaying lead".
- Implementation explainer: same look and length as `docs/agent-architectures-simple.html` (2–3 A4 pages, same CSS tokens), kid-simple: "the toolbox" (one diagram: three architectures → same `lab` commands → same run folder), one card per architecture with a 5–10 line real snippet each (sequential: the loop in `sequentialFinish`; coordinator: a frontmatter + header excerpt of `lab-director.md`; swarm: the `/direct` swarm paragraph), one card "the rules live in code" with the `labSave` retry-cap snippet, one card "how to test it yourself" (the three start commands and `/direct`). Print with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf=docs/agent-architectures-implementation.pdf "file://$PWD/docs/agent-architectures-implementation.html"` and check every page as an image.

- [ ] **Step 1: Write failing test** `skill.test.ts`: the skill contains `claude-opus-5-5`, `--effort high`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `--teammate-mode tmux`, each agent type name, `lab stop`, and does not contain `render` as a command, `gates/C`, or `CLAUDE_CODE_EFFORT_LEVEL=` as an instruction to set it.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/lab/skill.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** the skill, the decision-log entries and the architecture.md pointer.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Write and print** the implementation explainer; render each page to PNG and look at it; fix overlaps.
- [ ] **Step 6: Run** the whole suite `npm test` and `npm run typecheck`. Expected: all pass (651 old + new), no type errors.
- [ ] **Step 7: Commit** `feat(lab): /direct skill, decision log, implementation explainer`

---

## After the build (owner, not this plan)

The nine live runs (three briefs × three architectures) are the owner's: they spend text-model money and need answers at the keyboard. Then `npm run -s lab -- compare`, and `docs/agent-architectures.md` is written from the run folders (spec section 7).
