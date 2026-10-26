# AI Director, Part 1: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-line brief goes through a fixed graph of agents and code steps (Interrogator, Director, plan checks, four parallel branches, Assembler, prompt checks) and stops at three gates; at the last gate a person can render one Seedance 2.5 take with the product and location as reference images.

**Architecture:** A recipe (the graph) declared in code, a runner that starts every ready node at once, and a router that sends a failed check back to the node that owns it, at most twice. Every state change is an event appended to `data/director-runs/<id>/events.jsonl`; the run's state is a pure fold of that log, so a reload or a server restart resumes exactly where it stopped. Agents are `claude-opus-5` behind the existing `ParseTransport` seam; everything exact (order, assembly, checks, routing, cost) is code.

**Tech Stack:** Node 24, TypeScript (ESM), Fastify 5, zod 4, `@anthropic-ai/sdk` (existing), `@google/genai` (existing), `uploadthing` 7 (new, server side only), vitest.

**Spec:** `docs/ai-director-design.html` (Part 7) and `docs/ai-director-requirements-and-advice.md`, with the decisions below taking precedence where they differ. UI: the board at https://claude.ai/artifact/LGaV9nbrJet93jH8VMkgAX (also `~/Desktop/AI Director UI Board.pdf`). Part 2 (frontend) is `docs/superpowers/plans/2026-10-26-ai-director-frontend.md` and consumes the routes and contract this plan produces.

---

## Decisions taken on 26 Oct 2026 (they override the design where they differ)

1. **Gate order.** A (answers) → Director → plan checks → **B approves the plan, before anything is generated** → product picture, location picture, character, Cinematographer run in parallel → Assembler → prompt checks → **C shows the final prompt, pictures and price, and is the only render button.** Part 7 put plan approval after the pictures; moving it first means a rejected plan costs nothing and a re-planned shot never invalidates finished pictures.
2. **Cinematographer is one call for all shots, in order** (Part 5 §6, Part 7). Requirements FR-2/FR-8 saying "one call per shot" are stale; Task 14 corrects them.
3. **Character:** Gate A picks one of the owner's existing avatars by default; "cast a new one" is optional and runs the avatar pipeline from the plan's character description.
4. **A character that does not pass the Prompt Coach does not stop the run.** Gate C then requires `acceptNotPassed: true`.
5. **Reference images, the Mentic way** (`~/Desktop/Mentic.io/lib/video-lab/render-ugc.ts`, `lib/media-mirror.ts`): OpenRouter `input_references: [{type:"image_url", image_url:{url}}]`, public HTTPS URLs hosted on **UploadThing**, named in the prompt by position ("The first reference image is …"). Never a face: only `product` and `location` images can be references, by type.
6. **Product picture is one view, not a two-view sheet.** Mentic's own header on `generate-product-sheet.ts` warns a two-view frame may render as two products and gates it on an unrun probe. One clean studio view from the owner's photo avoids that.
7. **Location picture is an empty room, nobody in frame** (Mentic rule since 2026-08-28).
8. **Shot length rule:** short = 2 s, normal = 3 s, long = 4 s; a plan fits when the sum is within ±2 s of the chosen length.
9. **Routed checks are only those a model can fail and fix.** Assembly invariants (style line and character text byte-identical, every reference named) are assertions: if one fails, it is a code defect and the run fails, it is never routed.
10. **One brief rendered for the proof, chosen by the owner.** No product is fixed in code or fixtures beyond test data.
11. **One branch only.** Every commit goes on `main`. No branches, no worktrees.

## Global Constraints

- Agents (Interrogator, Director, Cinematographer) use `claude-opus-5` through `createAnthropicTransport()` (`apps/backend/src/api/client.ts`). Never a date-suffixed id. The describe step stays on `claude-sonnet-5` (unchanged Mentic reproduction); Task 14 records this against NFR-4.
- `packages/contract` is the only place a type that crosses the network is defined.
- Prompt files are append-only: `agents/<agent>/prompt-v1.ts` exporting `<AGENT>_PROMPT_VERSION = "v1"`. A change ships as `prompt-v2.ts`.
- No test may spend money. Every paid seam is injected (`ParseTransport`, `ImageTransport`, `VideoTransport`, `ReferenceHost`). Live tests live in `apps/backend/tests/live/*.live.test.ts` behind `describe.skipIf(process.env.RUN_LIVE_API !== "1")`.
- Only `POST /director/runs/:id/gates/C` with `decision: "render"` can submit a render.
- Seedance: model `SEEDANCE_MODEL` (`bytedance/seedance-2.5`), size `"720x1280"`, `generate_audio: true`, duration 4–30 (`isValidVideoSeconds`), prompt ≤ 15,000 characters, at most **5** reference images (OpenRouter's cap is 9; 5 is the research rule, R§4).
- Price shown before render: `estimateMicroUsd("720x1280", seconds)` from `packages/contract/src/video.ts` (15 s ≈ $3.47). The billed amount is `actualMicroUsd` from OpenRouter and never overwrites the estimate.
- Retries: `MAX_RETRIES_PER_OWNER = 2` per owner (`director`, `cinematographer`). A third failure stops the run with status `stopped`.
- Terminal statuses: `rendered`, `render_failed`, `stopped`, `rejected`, `failed`. Only `rendered` is a success.
- Files on disk: `data/director-runs/<runId>/{manifest.json, events.jsonl, nodes/<node>.<attempt>.json, assets/<name>, render.claim, clip.mp4}`. `data/` is committed (CLAUDE.md), so runs and their pictures are committed artefacts.
- New secret `UPLOADTHING_TOKEN`, documented in `.env.example` (same name Mentic uses). Never commit a value.
- ESM: no `__dirname`; use `fileURLToPath(import.meta.url)`.

## Review Focus

1. **Double press on Render** (two tabs, or a retry after a timeout): exactly one OpenRouter submit; the second press answers 409 with the existing render. Test in Task 11.
2. **Server restart mid-run**: a node that started and never finished is re-run as the next attempt and logged as abandoned; a render with a claim and a task id resumes polling; a render with a claim and no task id settles `render_failed` with billing `unknown` and is never resubmitted. Tests in Tasks 5 and 11.
3. **A gate answered twice or out of order** (`POST gates/B` while waiting at A, or B twice): 409, state unchanged. Test in Task 12.
4. **Director patch that silently changes assets** while fixing one shot: detected by code, the patch is refused as a failed attempt. Test in Task 7.
5. **A product photo that is not an image, or over 6 MB**: 400 before anything is saved or uploaded. Test in Task 12.

---

## File structure

```
packages/contract/src/
  director.ts            node/gate ids, Plan, Camera, checks, events, run view, constants
  directorState.ts       reduceDirectorEvents(events) -> DirectorRunView (pure; used by backend AND frontend)
  index.ts               + export * from "./director.js", "./directorState.js"
apps/backend/src/
  api/client.ts          ParseTransport result gains optional usage/model
  api/pricing.ts         micro-USD per token (claude-opus-5) and per image (gemini-3-pro-image)
  store/DirectorRunStore.ts        interface
  store/FileDirectorRunStore.ts    events.jsonl, node outputs, assets, render claim
  orchestrate/director/
    metered.ts           wraps a ParseTransport, collects CallLog[]
    recipe.ts            DIRECTOR_RECIPE: NodeSpec[]
    runner.ts            driveDirectorRun, resolveGate, resumeAllDirectorRuns
    checks.ts            runPlanChecks, runPromptChecks (pure)
    router.ts            route(outcomes, retries) (pure)
    assemble.ts          assembleSeedancePrompt (pure)
    assemblePrompt/v1.ts fixed strings of the final prompt (append-only)
    render.ts            submitDirectorRender, settleDirectorRender (claim discipline)
  agents/interrogator/{prompt-v1,schema,run}.ts
  agents/director/{prompt-v1,schema,run}.ts
  agents/cinematographer/{prompt-v1,schema,run}.ts
  images/referenceHost.ts          ReferenceHost + UploadThing implementation
  images/prompts/v1.ts             productShotBrief, locationPlateBrief (append-only)
  images/makeReference.ts          makeProductPicture, makeLocationPicture
  avatar/makeCharacter.ts          extracted from server/routes/avatar.ts
  orchestrate/coach.ts             coachDescription + buildRetryVerbatim, extracted from server.ts and cli/score.ts
  video/openrouterClient.ts        VideoSubmitRequest gains input_references
  server/routes/director.ts        HTTP + SSE
  server/app.ts, server/server.ts  optional director deps, resume on boot
apps/backend/tests/  mirrors src, plus tests/live/director.live.test.ts
```

---

### Task 1: The Director contract

**Files:**
- Create: `packages/contract/src/director.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `packages/contract/tests/director.test.ts`

**Interfaces:**
- Produces (every later task, both plans, uses these names exactly):

```ts
export const DIRECTOR_NODE_IDS = ["interrogator", "director", "planChecks", "product", "location",
  "character", "cinematographer", "assembler", "promptChecks", "render"] as const;
export type DirectorNodeId = (typeof DIRECTOR_NODE_IDS)[number];
export const GATE_IDS = ["A", "B", "C"] as const;
export type GateId = (typeof GATE_IDS)[number];
export type NodeStatus = "queued" | "running" | "done" | "failed" | "skipped" | "blocked";
export type GateStatus = "locked" | "waiting" | "done" | "blocked";

export type FilledBrief = { brief: string; productKind: string; audience: string; tone: string;
  setting: string; character: string; suggestedSeconds: number | null };
export type CastChoice = { kind: "avatar"; avatarId: string } | { kind: "new" };
export type GateAAnswers = { productPhotoAsset: string; productKind: string; seconds: number;
  mustNotAppear: string[]; cast: CastChoice };

export const SHOT_WEIGHT_SECONDS = { short: 2, normal: 3, long: 4 } as const;
export type ShotWeight = keyof typeof SHOT_WEIGHT_SECONDS;
export const LENGTH_TOLERANCE_SECONDS = 2;
export type AssetKind = "product" | "location" | "character";
export type PlanAsset = { handle: string; kind: AssetKind; description: string };
export type PlanShot = { action: string; weight: ShotWeight; sound: string };
export type Plan = { styleLine: string; scene: string; assets: PlanAsset[]; shots: PlanShot[] };
export function plannedSeconds(plan: Plan): number;

export const CAMERA_MOVES = ["static", "slow push-in", "pull-out", "tracking", "orbit", "crane up", "handheld"] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];
export type Camera = { shot: number; framing: string; lensMm: number; move: CameraMove; light: string };

export type ReferenceImage = { slot: number; handle: string; kind: "product" | "location"; url: string; asset: string };
export type CharacterOutcome = { avatarId: string; coachRunId: string; status: RunStatus;
  description: string; passed: boolean };

export const DIRECTOR_CHECK_IDS = ["length_fits", "handles_match", "references_within_cap",
  "no_timestamps", "nothing_ruled_out", "camera_per_shot", "light_has_direction"] as const;
export type DirectorCheckId = (typeof DIRECTOR_CHECK_IDS)[number];
export const DIRECTOR_CHECK_LABELS: Record<DirectorCheckId, string>;
export type CheckOwner = "director" | "cinematographer";
export type CheckOutcome = { id: DirectorCheckId; passed: boolean; owner: CheckOwner; detail: string | null; shots: number[] };

export const MAX_RETRIES_PER_OWNER = 2;
export const MAX_REFERENCE_IMAGES = 5;
export const SEEDANCE_PROMPT_CHAR_CAP = 15_000;
export const DIRECTOR_VIDEO_SIZE: VideoSize = "720x1280";
export type AssembledPrompt = { text: string; sha256: string; references: ReferenceImage[] };
export type CallLog = { model: string; promptVersion: string; inputTokens: number | null;
  outputTokens: number | null; microUsd: number | null; latencyMs: number };

export type DirectorRunStatus = "running" | "awaiting_gate" | "rendering" | "rendered"
  | "render_failed" | "stopped" | "rejected" | "failed";
export type Billing = "billed" | "not_billed" | "unknown";
export type DirectorEventBody =
  | { type: "run.started"; brief: string }
  | { type: "node.started"; node: DirectorNodeId; attempt: number; patchShots: number[] | null }
  | { type: "node.completed"; node: DirectorNodeId; attempt: number; outputRef: string;
      summary: string; calls: CallLog[]; latencyMs: number }
  | { type: "node.failed"; node: DirectorNodeId; attempt: number; error: string }
  | { type: "node.abandoned"; node: DirectorNodeId; attempt: number }
  | { type: "checks.completed"; node: "planChecks" | "promptChecks"; outcomes: CheckOutcome[] }
  | { type: "route.sent"; owner: CheckOwner; checkIds: DirectorCheckId[]; shots: number[]; retry: number }
  | { type: "gate.opened"; gate: GateId }
  | { type: "gate.resolved"; gate: GateId; decision: "approve" | "reject"; reason: string | null }
  | { type: "render.submitted"; attempt: number; taskId: string; estimatedMicroUsd: number }
  | { type: "render.polled"; status: RenderStatus; reads: number }
  | { type: "render.settled"; status: RenderStatus; billing: Billing; actualMicroUsd: number | null; failure: string | null }
  | { type: "run.finished"; status: DirectorRunStatus; reason: string | null };
export type DirectorEvent = DirectorEventBody & { runId: string; seq: number; at: string };

export type DirectorNodeView = { status: NodeStatus; attempt: number; summary: string | null;
  outputRef: string | null; error: string | null };
export type DirectorRunView = { id: string; brief: string; status: DirectorRunStatus;
  waitingAt: GateId | null; seconds: number | null;
  nodes: Record<DirectorNodeId, DirectorNodeView>; gates: Record<GateId, GateStatus>;
  retries: Record<CheckOwner, number>; checks: { plan: CheckOutcome[]; prompt: CheckOutcome[] };
  textMicroUsd: number; render: { attempt: number; status: RenderStatus; billing: Billing | null;
    estimatedMicroUsd: number; actualMicroUsd: number | null; failure: string | null } | null;
  reason: string | null; lastSeq: number; startedAt: string; finishedAt: string | null };
export type DirectorRunSummary = Pick<DirectorRunView, "id" | "brief" | "status" | "waitingAt"
  | "seconds" | "textMicroUsd" | "startedAt"> & { billedMicroUsd: number | null };
export const DIRECTOR_RECIPE_EDGES: ReadonlyArray<{ from: DirectorNodeId | GateId; to: DirectorNodeId | GateId }>;
```

`DIRECTOR_CHECK_LABELS` copy, verbatim (the UI shows it): `length_fits` "The shots fit the length you chose", `handles_match` "Every @handle is declared, and every asset is used", `references_within_cap` "At most 5 reference images, each with a role", `no_timestamps` "No timestamps or seconds in any shot", `nothing_ruled_out` "Nothing you said must not appear", `camera_per_shot` "Every planned shot has one camera", `light_has_direction` "Every light line names a source and a direction".

`DIRECTOR_RECIPE_EDGES`, in order: interrogator→A, A→director, director→planChecks, planChecks→B, B→product, B→location, B→character, B→cinematographer, product→assembler, location→assembler, character→assembler, cinematographer→assembler, assembler→promptChecks, promptChecks→C, C→render.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { CAMERA_MOVES, DIRECTOR_CHECK_IDS, DIRECTOR_CHECK_LABELS, DIRECTOR_RECIPE_EDGES,
  SHOT_WEIGHT_SECONDS, plannedSeconds, type Plan } from "../src/index.js";

const plan = (weights: Array<"short" | "normal" | "long">): Plan => ({
  styleLine: "s", scene: "x", assets: [],
  shots: weights.map((weight) => ({ action: "a", weight, sound: "" })),
});

describe("director contract", () => {
  it("weights are 2, 3 and 4 seconds", () => {
    expect(SHOT_WEIGHT_SECONDS).toEqual({ short: 2, normal: 3, long: 4 });
    expect(plannedSeconds(plan(["normal", "long", "long", "long"]))).toBe(15);
  });
  it("camera moves are the closed list from the design", () => {
    expect(CAMERA_MOVES).toEqual(["static", "slow push-in", "pull-out", "tracking", "orbit", "crane up", "handheld"]);
  });
  it("every check has a label", () => {
    for (const id of DIRECTOR_CHECK_IDS) expect(DIRECTOR_CHECK_LABELS[id]).toBeTruthy();
  });
  it("the four branches all hang off gate B and all feed the assembler", () => {
    const fromB = DIRECTOR_RECIPE_EDGES.filter((e) => e.from === "B").map((e) => e.to);
    expect(fromB).toEqual(["product", "location", "character", "cinematographer"]);
    const intoAssembler = DIRECTOR_RECIPE_EDGES.filter((e) => e.to === "assembler").map((e) => e.from);
    expect(intoAssembler).toEqual(["product", "location", "character", "cinematographer"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run packages/contract/tests/director.test.ts`
Expected: FAIL, `plannedSeconds` (and the rest) not exported.

- [ ] **Step 3: Write `packages/contract/src/director.ts` with the interface above, and export it from `index.ts`**

`RunStatus` comes from `./run.js`, `RenderStatus` and `VideoSize` from `./video.js`. `plannedSeconds` sums `SHOT_WEIGHT_SECONDS[shot.weight]`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run packages/contract && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contract
git commit -m "feat(contract): the Director's nodes, plan, camera, checks and events"
```

---

### Task 2: Run state is a fold of the event log

**Files:**
- Create: `packages/contract/src/directorState.ts`
- Modify: `packages/contract/src/index.ts`
- Test: `packages/contract/tests/directorState.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `reduceDirectorEvents(events: DirectorEvent[]): DirectorRunView` and `applyDirectorEvent(view: DirectorRunView, event: DirectorEvent): DirectorRunView`, both pure. The backend uses it for resume and `GET`; the frontend applies SSE events with the same function, so the two can never disagree.

Rules the fold implements (each one is a test):
- `run.started` → status `running`, every node `queued`, every gate `locked`.
- `gate.opened` → that gate `waiting`, run `awaiting_gate`, `waitingAt` set. `gate.resolved` approve → gate `done`, run `running`, `waitingAt` null; reject → run `rejected`, `reason` set.
- `node.started` → `running`, `attempt` set. `node.completed` → `done`, `summary`, `outputRef`; adds the sum of `calls[].microUsd` (nulls ignored) to `textMicroUsd`. `node.failed` → `failed`, `error`. `node.abandoned` → back to `queued`.
- `checks.completed` → stores outcomes under `checks.plan` or `checks.prompt`.
- `route.sent` → `retries[owner] = retry`; the owner and every node downstream of it in `DIRECTOR_RECIPE_EDGES` up to the checks node go back to `queued`.
- `run.finished` with `stopped`, `failed`, `rejected` or `render_failed` → every node and gate not `done` becomes `blocked`.
- `render.*` → fills `render`; `render.settled` succeeded → status `rendered`; otherwise `render_failed`.

- [ ] **Step 1: Write the failing tests** (`directorState.test.ts`), one `it` per rule above, building events with a local `ev(body, seq)` helper. Key assertions:

```ts
it("a routed failure re-queues the owner and its downstream, and counts the retry", () => {
  const v = reduceDirectorEvents([
    ev({ type: "run.started", brief: "b" }, 1),
    ev({ type: "node.completed", node: "director", attempt: 1, outputRef: "nodes/director.1.json",
      summary: "4 shots", calls: [], latencyMs: 10 }, 2),
    ev({ type: "route.sent", owner: "director", checkIds: ["no_timestamps"], shots: [3], retry: 1 }, 3),
  ]);
  expect(v.nodes.director.status).toBe("queued");
  expect(v.nodes.planChecks.status).toBe("queued");
  expect(v.retries.director).toBe(1);
});
it("a stopped run blocks everything not done, and never reads as rendered", () => {
  const v = reduceDirectorEvents([ev({ type: "run.started", brief: "b" }, 1),
    ev({ type: "run.finished", status: "stopped", reason: "camera_per_shot after 2 retries" }, 2)]);
  expect(v.status).toBe("stopped");
  expect(v.gates.C).toBe("blocked");
  expect(v.nodes.render.status).toBe("blocked");
});
```

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run packages/contract/tests/directorState.test.ts` → FAIL, not exported.
- [ ] **Step 3: Implement `reduceDirectorEvents` as `events.reduce(applyDirectorEvent, emptyView)`**; `applyDirectorEvent` returns a new object (no mutation, the frontend relies on identity changes).
- [ ] **Step 4: Run** `npx vitest run packages/contract` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contract): a Director run's state is a pure fold of its events"`

---

### Task 3: Every model call is measured

**Files:**
- Modify: `apps/backend/src/api/client.ts`
- Create: `apps/backend/src/api/pricing.ts`, `apps/backend/src/orchestrate/director/metered.ts`
- Test: `apps/backend/tests/api/pricing.test.ts`, `apps/backend/tests/orchestrate/director/metered.test.ts`

**Interfaces:**
- Produces:
  - `ParseTransport` result becomes `Promise<{ parsed_output: unknown; usage?: { inputTokens: number; outputTokens: number }; model?: string }>`. Optional, so every existing fake keeps compiling. `createAnthropicTransport` fills both from `response.usage.input_tokens/output_tokens` and `response.model`.
  - `api/pricing.ts`: `MICRO_USD_PER_INPUT_TOKEN: Record<string, number>`, `MICRO_USD_PER_OUTPUT_TOKEN: Record<string, number>`, `MICRO_USD_PER_IMAGE: Record<string, number>`, `tokenMicroUsd(model, usage): number | null` (null for an unknown model, never 0).
  - `metered.ts`: `meter(transport: ParseTransport, promptVersion: string, now?: () => number): { transport: ParseTransport; calls: () => CallLog[] }`.

Rates: copy `claude-opus-5` input/output per-token prices from https://docs.anthropic.com/en/docs/about-claude/pricing and the `gemini-3-pro-image` per-image price from https://ai.google.dev/gemini-api/docs/pricing on the day of implementation, each with a `// checked <date>, <url>` comment. Do not type a rate from memory.

- [ ] **Step 1: Write the failing tests**

```ts
it("an unknown model costs null, never 0", () => {
  expect(tokenMicroUsd("not-a-model", { inputTokens: 10, outputTokens: 10 })).toBeNull();
});
it("meter records model, tokens, version and latency for each call", async () => {
  let t = 0;
  const fake: ParseTransport = async () => ({ parsed_output: {}, usage: { inputTokens: 100, outputTokens: 50 }, model: "claude-opus-5" });
  const m = meter(fake, "v1", () => (t += 25));
  await m.transport({ system: "s", user: "u", schema: z.object({}) });
  expect(m.calls()).toEqual([{ model: "claude-opus-5", promptVersion: "v1", inputTokens: 100, outputTokens: 50,
    microUsd: tokenMicroUsd("claude-opus-5", { inputTokens: 100, outputTokens: 50 }), latencyMs: 25 }]);
});
it("a served fallback model is logged as what actually served it", async () => { /* model: "claude-sonnet-5" → CallLog.model === "claude-sonnet-5" */ });
```

- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/api/pricing.test.ts apps/backend/tests/orchestrate/director/metered.test.ts` → FAIL.
- [ ] **Step 3: Implement**, then run the whole backend suite (`npx vitest run`) so the widened `ParseTransport` breaks nothing.
- [ ] **Step 4: Run** → PASS, `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): every model call reports its tokens, model and cost"`

---

### Task 4: The Director run store

**Files:**
- Create: `apps/backend/src/store/DirectorRunStore.ts`, `apps/backend/src/store/FileDirectorRunStore.ts`
- Test: `apps/backend/tests/store/FileDirectorRunStore.test.ts`

**Interfaces:**
- Consumes: `DirectorEvent`, `DirectorEventBody`, `DirectorRunSummary` (Task 1), `reduceDirectorEvents` (Task 2), `writeJsonAtomic` from `store/FileRunStore.ts` (export it if it is not).
- Produces:

```ts
export interface DirectorRunStore {
  createRun(brief: string): Promise<string>;                       // writes manifest + run.started, returns id
  append(runId: string, body: DirectorEventBody): Promise<DirectorEvent>;  // assigns seq = last + 1, serialized per run
  events(runId: string, afterSeq?: number): Promise<DirectorEvent[]>;
  writeOutput(runId: string, node: DirectorNodeId, attempt: number, payload: unknown): Promise<string>; // returns "nodes/<node>.<attempt>.json"
  readOutput<T>(runId: string, ref: string): Promise<T>;
  saveAsset(runId: string, name: string, bytes: Buffer): Promise<string>;  // returns "assets/<name>"
  readAsset(runId: string, ref: string): Promise<Buffer>;
  writeAnswers(runId: string, answers: GateAAnswers): Promise<void>;  // answers.json, written once (second write throws)
  readAnswers(runId: string): Promise<GateAAnswers | null>;
  claimRender(runId: string, attempt: number): Promise<"claimed" | "already_claimed">; // atomic "wx" on render.<attempt>.claim
  listRuns(): Promise<DirectorRunSummary[]>;                        // newest first, from each run's folded events
  listIds(): Promise<string[]>;
}
export class FileDirectorRunStore implements DirectorRunStore { constructor(root: string) }
```

Appends are one JSON line each via `appendFile`, behind a per-run promise chain so concurrent appends from parallel nodes never interleave or reuse a `seq`. Refs passed to `readOutput`/`readAsset` must match `^(nodes|assets)/[\w.-]+$` or throw (no path traversal).

- [ ] **Step 1: Write the failing tests**: (a) 20 concurrent `append` calls produce seqs 1..20 with no gaps and 20 lines on disk; (b) `events(id, 5)` returns seq 6+; (c) `claimRender` twice → `"claimed"` then `"already_claimed"`; (d) `readOutput(id, "../manifest.json")` rejects; (e) `listRuns` is newest first and carries `waitingAt`.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/store/FileDirectorRunStore.test.ts` → FAIL.
- [ ] **Step 3: Implement**; root default `data/director-runs` (resolved by the caller, as `FileRunStore` is).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(store): Director runs are an append-only event log on disk"`

---

### Task 5: Recipe and runner, proven with fake agents

**Files:**
- Create: `apps/backend/src/orchestrate/director/recipe.ts`, `apps/backend/src/orchestrate/director/runner.ts`
- Test: `apps/backend/tests/orchestrate/director/runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4. `meter` (Task 3).
- Produces:

```ts
// recipe.ts
export type NodeContext = { runId: string; attempt: number; patch: { checkIds: DirectorCheckId[]; shots: number[]; failures: CheckOutcome[] } | null;
  view: DirectorRunView; read: <T>(node: DirectorNodeId) => Promise<T>; answers: () => Promise<GateAAnswers> };
export type NodeResult = { output: unknown; summary: string; calls: CallLog[] };
export type NodeSpec = { id: DirectorNodeId; after: Array<DirectorNodeId | GateId>; run: (ctx: NodeContext) => Promise<NodeResult> };
export type DirectorAgents = Record<Exclude<DirectorNodeId, "render">, (ctx: NodeContext) => Promise<NodeResult>>;
export function buildRecipe(agents: DirectorAgents): NodeSpec[];   // dependencies from DIRECTOR_RECIPE_EDGES

// runner.ts
export type RunnerDeps = { store: DirectorRunStore; recipe: NodeSpec[]; publish?: (ev: DirectorEvent) => void };
export async function startDirectorRun(deps: RunnerDeps, brief: string): Promise<string>;
export async function driveDirectorRun(deps: RunnerDeps, runId: string): Promise<void>;
export async function resolveGate(deps: RunnerDeps, runId: string, gate: GateId,
  decision: { decision: "approve"; answers?: GateAAnswers } | { decision: "reject"; reason: string }): Promise<void>;
export async function resumeAllDirectorRuns(deps: RunnerDeps): Promise<void>;
export class GateConflictError extends Error {}   // gate not waiting → routes answer 409
```

How `driveDirectorRun` works (the algorithm the tests pin):
1. A per-run in-process lock (`Map<string, Promise<void>>`) so two drives never overlap.
2. Fold events. Stop if terminal or `awaiting_gate`.
3. A gate whose `after` nodes are all `done` and which is `locked` → append `gate.opened`, return.
4. Every node that is `queued` with all `after` done (a gate counts as done when `gates[g] === "done"`) starts **now**: append `node.started`, call `spec.run`, and on completion write the output, append `node.completed` (or `node.failed`). Keep an in-flight map and loop on `Promise.race`, recomputing ready nodes after each completion.
5. `planChecks` and `promptChecks` are ordinary nodes whose output is `CheckOutcome[]`; after either completes the runner calls `route` (Task 6) and appends `checks.completed`, then `route.sent` or `run.finished stopped`.
6. A thrown error in a node → `node.failed` + `run.finished failed` with the message.

`resolveGate` throws `GateConflictError` unless `view.waitingAt === gate`; Gate A saves `answers` with `store.writeAnswers` (read back by `ctx.answers()`), then calls `driveDirectorRun`. `resumeAllDirectorRuns` lists ids, appends `node.abandoned` for every node `running` with no completion, then drives each non-terminal, non-waiting run.

- [ ] **Step 1: Write the failing tests** with fake agents built from a `deferred()` helper:

```ts
it("stops at gate A after the Interrogator", async () => { /* status awaiting_gate, waitingAt "A", director never called */ });
it("after B, the four branches all start before any of them finishes", async () => {
  // product/location/character/cinematographer agents return deferred promises
  // drive, then assert the events contain four node.started (those four) before the first node.completed of any of them
});
it("a fresh runner over the same store resumes without re-running finished nodes", async () => {
  // run to gate B with runner 1; build runner 2 over the same FileDirectorRunStore; resolveGate B approve;
  // expect interrogator and director call counts still 1
});
it("a node in flight at restart is re-run as attempt 2 and logged as abandoned", async () => { /* write node.started only, resumeAll, expect node.abandoned then node.started attempt 2 */ });
it("answering a gate that is not waiting throws GateConflictError and appends nothing", async () => {});
it("a node that throws fails the run with its message", async () => {});
```

- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/orchestrate/director/runner.test.ts` → FAIL.
- [ ] **Step 3: Implement** `recipe.ts` and `runner.ts`. No agent, model or vendor is imported here.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): a recipe in code and a runner that runs ready steps at once"`

---

### Task 6: Checks and the router

**Files:**
- Create: `apps/backend/src/orchestrate/director/checks.ts`, `apps/backend/src/orchestrate/director/router.ts`
- Test: `apps/backend/tests/orchestrate/director/checks.test.ts`, `.../router.test.ts`

**Interfaces:**
- Produces:
  - `runPlanChecks(plan: Plan, seconds: number, mustNotAppear: string[]): CheckOutcome[]`: `length_fits`, `handles_match`, `references_within_cap`, `no_timestamps`, `nothing_ruled_out`, all owner `director`.
  - `runPromptChecks(plan: Plan, cameras: Camera[]): CheckOutcome[]`: `camera_per_shot`, `light_has_direction`, owner `cinematographer`.
  - `route(outcomes: CheckOutcome[], retries: Record<CheckOwner, number>): { kind: "pass" } | { kind: "redo"; owner: CheckOwner; checkIds: DirectorCheckId[]; shots: number[]; retry: number } | { kind: "stop"; reason: string }`.

Exact rules:
- `length_fits`: `|plannedSeconds(plan) - seconds| <= LENGTH_TOLERANCE_SECONDS`. Detail: `"3 + 4 + 4 + 4 = 15 s, you chose 15 s"`.
- `handles_match`: every `@[a-z0-9_]+` in `scene` and shot actions is a declared handle, and every declared non-character asset is used at least once. `shots` lists offending shot numbers (1-based).
- `references_within_cap`: count of `product` + `location` assets ≤ `MAX_REFERENCE_IMAGES`, each with a non-empty `description`.
- `no_timestamps`: no shot action or sound matches `/\b\d+(\.\d+)?\s*(s|sec|secs|seconds)\b|\(\s*\d+\s*[–-]\s*\d+\s*s\s*\)|\b\d{1,2}:\d{2}\b/i`.
- `nothing_ruled_out`: no `mustNotAppear` term (trimmed, case-insensitive, whole word) appears in `styleLine`, `scene`, asset descriptions or shots.
- `camera_per_shot`: exactly one camera per shot number 1..N, no extra numbers.
- `light_has_direction`: each `light` contains one of `left|right|behind|above|overhead|below|front|side|backlit|from the window`.
- `route`: all pass → `pass`. Otherwise take the first failing owner in order `director`, `cinematographer`; if `retries[owner] >= MAX_RETRIES_PER_OWNER` → `stop` with `"<check ids> still failing after 2 retries (owner: <owner>)"`; else `redo` with `retry = retries[owner] + 1` and the union of failing shots.

- [ ] **Step 1: Write the failing tests**: one passing and one failing case per check, with the Gate B board example as the passing plan (shots normal/long/long/long, 15 s); `"(2–4s)"` fails `no_timestamps` on shot 3; 3 cameras for 4 shots fails `camera_per_shot` with `shots: [4]`; router: retries `{director: 2}` + failing director check → `stop`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (pure, no I/O). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): yes/no checks in code, and a router that sends failures to their owner"`

---

### Task 7: The three agents

**Files:**
- Create: `apps/backend/src/agents/{interrogator,director,cinematographer}/{prompt-v1,schema,run}.ts`
- Test: `apps/backend/tests/agents/{interrogator,director,cinematographer}/run.test.ts`, `apps/backend/tests/live/director.live.test.ts`

**Interfaces:**
- Consumes: `ParseTransport`; contract types.
- Produces:
  - `interrogate(deps: { transport: ParseTransport }, args: { brief: string }): Promise<FilledBrief>`
  - `direct(deps, args: { brief: FilledBrief; answers: GateAAnswers }): Promise<Plan>`
  - `patchPlan(deps, args: { plan: Plan; failures: CheckOutcome[]; brief: FilledBrief; answers: GateAAnswers }): Promise<Plan>`: throws `PlanPatchError` when any asset's `handle`, `kind` or `description` differs from the input plan. A patch fixes shots, never assets, so what the owner approves at Gate B is the asset list the pictures are made from.
  - `shootAll(deps, args: { plan: Plan; seconds: number }): Promise<Camera[]>`
  - `reshoot(deps, args: { plan: Plan; cameras: Camera[]; shots: number[]; failures: CheckOutcome[] }): Promise<Camera[]>`: asks the model only for the listed shots, then splices them into `cameras`; the cameras for other shots are returned by reference unchanged (test with `toBe`).
  - Each `prompt-v1.ts` exports `<NAME>_PROMPT_VERSION = "v1"` and `build<Name>SystemPrompt()`; each `schema.ts` a zod schema whose output type is checked against the contract type with a `satisfies`/type-equality test.

Prompt content decisions:
- **Interrogator:** decides audience, tone, setting, character itself; never asks; fills `productKind` with what kind of thing the product is, never what it looks like (Mentic rule).
- **Director:** vendor the relevant parts of the Higgsfield `seedance-shotlist-director` skill (`~/.claude/skills/**/seedance-shotlist-director/SKILL.md`; copy the text, credit it in a header comment) with the four adaptations: **no timestamps or seconds** (weights only: short/normal/long), **one take, no 15-second blocks, no cuts across generations**, **sound written per shot in Seedance syntax** (`<sound effect>`, `(music)`, `{dialogue}`), **assets: one product, one location, one character, handles in lowercase**. Behaviour shown in the body, never stated. No brand names.
- **Cinematographer:** one call writes every shot in order so each continues the last; exactly one move from `CAMERA_MOVES`; lens in mm; light names a source and its direction; it sees the plan's scene and location description, not the generated picture (accepted gap, Part 5).

- [ ] **Step 1: Write the failing tests** with a fake `ParseTransport` returning canned objects: parse + validation; `patchPlan` refuses a changed asset; `reshoot` splices shot 2 only and keeps 1, 3, 4 by reference; each system prompt contains the adaptations (`expect(buildDirectorSystemPrompt()).toMatch(/never write seconds|no timestamps/i)`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Add the live test** (skipped by default): one real `interrogate`, `direct`, `shootAll` on a placeholder brief, asserting only shape and `CallLog.model === "claude-opus-5"`. Costs cents; run once with `RUN_LIVE_API=1 npx vitest run apps/backend/tests/live/director.live.test.ts`.
- [ ] **Step 6: Commit** — `git commit -m "feat(agents): Interrogator, Director and Cinematographer, prompt v1"`

---

### Task 8: Pictures, and where they live

**Files:**
- Modify: `apps/backend/src/avatar/generateSheet.ts` (transport only)
- Create: `apps/backend/src/images/referenceHost.ts`, `apps/backend/src/images/prompts/v1.ts`, `apps/backend/src/images/makeReference.ts`
- Modify: `package.json` (add `uploadthing@^7.7.4` to `apps/backend`), `.env.example`
- Test: `apps/backend/tests/images/*.test.ts`

**Interfaces:**
- Produces:
  - `ImageTransport` args gain `referenceImages?: TransportImage[]`, sent as Gemini `inlineData` parts after the text part (Mentic `googleGenerateImage` order). Existing callers unchanged.
  - `ReferenceHost = { publish(bytes: Buffer, name: string, mediaType: string): Promise<{ url: string }> }`, `createUploadThingHost(): ReferenceHost` (UTApi `uploadFiles`, returns `data.ufsUrl`; throws `ReferenceHostConfigError` without `UPLOADTHING_TOKEN`), `isUploadThingUrl(url: string): boolean` (https + `*.ufs.sh` or `utfs.io` host; port the check from Mentic `lib/uploadthing-url.ts`).
  - `productShotBrief(productKind: string): string` and `locationPlateBrief(description: string, styleLine: string): string` in `images/prompts/v1.ts` (`IMAGE_PROMPT_VERSION = "v1"`).
  - `makeProductPicture(deps: { images: ImageTransport; host: ReferenceHost; store: DirectorRunStore }, args: { runId: string; photo: TransportImage; productKind: string; handle: string }): Promise<ReferenceImage>` (aspect `"1:1"`, slot 1).
  - `makeLocationPicture(deps, args: { runId: string; description: string; styleLine: string; handle: string }): Promise<ReferenceImage>` (aspect `"9:16"`, slot 2).

`productShotBrief` adapts Mentic `productSheetBrief` to **one** view: reproduce the product in the first reference image exactly (shape, proportions, finish, label in place), straight-on three-quarter view, plain seamless neutral ground, soft even light, nothing else in frame (no hands, no people, no props, no added text). It states the **kind** only; a test pins that two briefs with different kinds differ only in the kind line. `locationPlateBrief`: the place from the plan, three-quarter angle with depth for the camera to move through, **empty, nobody in the frame**, the style line's light and palette.

- [ ] **Step 1: Write the failing tests**: Gemini request built with the photo as an `inlineData` part after the text (fake `generateContent`); product brief never contains colour words from the kind's absence (pin by construction as above); location brief contains "nobody in the frame"; `makeProductPicture` saves the asset, publishes it, and returns `{ slot: 1, kind: "product", url }`; host refuses without token.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, add `UPLOADTHING_TOKEN=` to `.env.example` with a comment ("public URLs for the product and location reference images; same variable Mentic reads"). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(images): product and location pictures, hosted where OpenRouter can fetch them"`

---

### Task 9: The character branch reuses the Prompt Coach

**Files:**
- Create: `apps/backend/src/avatar/makeCharacter.ts`, `apps/backend/src/orchestrate/coach.ts`
- Modify: `apps/backend/src/server/routes/avatar.ts`, `apps/backend/src/server/server.ts`, `apps/backend/src/cli/score.ts` (call the extracted functions; behaviour unchanged)
- Test: `apps/backend/tests/avatar/makeCharacter.test.ts`, `apps/backend/tests/orchestrate/coach.test.ts`; existing route, server and CLI tests must stay green unchanged

**Interfaces:**
- Produces:
  - `makeCharacter(deps: { text: TextTransport; images: ImageTransport; vision: VisionTransport; avatars: AvatarStore }, args: { description: string }): Promise<AvatarRecord>`: the author → `actorSheetBrief` → `generateSheet` → `save` → `describeImage` → `attachDescription` sequence now inline in `POST /avatar/sheet` and `POST /avatar/describe`.
  - `coachDescription(deps: { transport: ParseTransport; avatars: AvatarStore; runs: RunStore; rubric: Rubric; emit?: EventSink }, args: { avatarId: string; runId: string }): Promise<CharacterOutcome>`, wiring `runToCompletion` exactly as `server.ts` `startRun` does today (`repairerPromptVersion: "v2"`, grounding via `loadGrounding`); `passed = status === "passed"`.
  - `buildRetryVerbatim` moves into `coach.ts` and is imported by `server.ts` and `cli/score.ts` (one copy, not two).

- [ ] **Step 1: Write the failing tests** for both functions with fakes; then run the existing suite to record the baseline (`npx vitest run` → 386 passed, 4 skipped, or whatever the current count is).
- [ ] **Step 2: Run** → new tests FAIL. **Step 3: Extract** (move code, do not rewrite it). **Step 4: Run the full suite** → new tests PASS and the baseline count still passes.
- [ ] **Step 5: Commit** — `git commit -m "refactor: the avatar pipeline and the Prompt Coach become callable steps"`

---

### Task 10: The Assembler

**Files:**
- Create: `apps/backend/src/orchestrate/director/assemble.ts`, `apps/backend/src/orchestrate/director/assemblePrompt/v1.ts`
- Test: `apps/backend/tests/orchestrate/director/assemble.test.ts`

**Interfaces:**
- Produces: `assembleSeedancePrompt(args: { plan: Plan; cameras: Camera[]; character: CharacterOutcome; references: ReferenceImage[] }): AssembledPrompt` and `AssemblyInvariantError`.

The prompt, in this order (Part 7 §8, Mentic reference sentences):
1. One sentence per reference, by slot: `The first reference image is the product (@product).` / `The second reference image is the <location description short> (@kitchen).` Ordinals from `assemblePrompt/v1.ts` (`ORDINALS = ["first", "second", "third", "fourth", "fifth"]`).
2. `plan.styleLine`, verbatim.
3. `HERO (@<character handle>): <character.description>`, verbatim.
4. `Scene: <plan.scene>`.
5. `Shot n: <framing>, <lensMm>mm, <move>, <light>. <action> <sound>` for n = 1..N.
6. `CLOSING_LINE = "Keep it subtitle-free, do not generate a logo or watermark."`

Invariants checked in code after building, each throwing `AssemblyInvariantError` (never routed): `text.indexOf(plan.styleLine) !== -1`, `text.indexOf(character.description) !== -1`, every reference's sentence present, `Shot 1..N` present once each, `text.length <= SEEDANCE_PROMPT_CHAR_CAP`, `references.length <= MAX_REFERENCE_IMAGES`, and no reference of a kind other than `product`/`location`. `sha256` is hex of the UTF-8 text.

- [ ] **Step 1: Write the failing tests**: build from a fixture (4 shots, 2 references); `expect(out.text.indexOf(plan.styleLine)).toBeGreaterThan(-1)`; order of the six parts by index; over-long character description → `AssemblyInvariantError`; same input twice → same `sha256`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (pure). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): code assembles the final prompt from the approved plan"`

---

### Task 11: Rendering with references, and never twice

**Files:**
- Modify: `apps/backend/src/video/openrouterClient.ts`, `apps/backend/tests/video/openrouterClient.test.ts`, `apps/backend/tests/compare/runComparison.test.ts`
- Create: `apps/backend/src/orchestrate/director/render.ts`
- Test: `apps/backend/tests/orchestrate/director/render.test.ts`

**Interfaces:**
- Produces:
  - `VideoSubmitRequest` gains `input_references?: Array<{ type: "image_url"; image_url: { url: string } }>`. The file's header "No image field exists, by construction" is rewritten to say references exist for **products and locations only** and why (decision 5). The two existing tests that assert no image field are narrowed to "a Compare request carries no `input_references`", which stays true.
  - `submitDirectorRender(deps: { store: DirectorRunStore; video: VideoTransport; publish?: (ev: DirectorEvent) => void }, args: { runId: string; attempt: number; prompt: AssembledPrompt; seconds: number }): Promise<void>` and `settleDirectorRender(deps & { sleep?: (ms: number) => Promise<void>; now?: () => number }, args: { runId: string; attempt: number }): Promise<void>`.

Claim discipline, ported from `compare/runComparison.ts` (same constants `POLL_INTERVAL_MS`, `POLL_DEADLINE_MS`):
1. `store.claimRender(runId, attempt)` **before** `video.submit`. `"already_claimed"` → no submit (the route turns this into 409).
2. Request: `{ model: SEEDANCE_MODEL, prompt: prompt.text, duration: seconds, size: DIRECTOR_VIDEO_SIZE, generate_audio: true, input_references: prompt.references.map(r => ({ type: "image_url", image_url: { url: r.url } })) }`. Every URL must pass `isUploadThingUrl` or the submit is refused before `fetch` (billing `not_billed`).
3. Append `render.submitted` with the task id **before** waiting on it.
4. Submit throws: `submitProvablyUnbilled(err)` → `render.settled` failed, billing `not_billed`; anything else (timeout, 5xx, unparseable 2xx) → failed, billing `unknown`. Never retried automatically.
5. Poll `check` until terminal; on `succeeded` fetch the clip to `clip.<attempt>.mp4` via `saveAsset`; `render.settled` with `actualMicroUsd`; billing `billed` when succeeded or when `actualMicroUsd` is a number, else `unknown`. Then `run.finished` `rendered` or `render_failed`.
6. Resume (called from `resumeAllDirectorRuns`): claim + `render.submitted` with no `render.settled` → keep polling; claim and no `render.submitted` → settle failed, billing `unknown`.
7. "Render again" after `render_failed` is a new press with `attempt + 1`, its own claim, its own estimate.

- [ ] **Step 1: Write the failing tests** with a fake `VideoTransport`: references sent in slot order; double `submitDirectorRender` for the same attempt → `submit` called once; submit timeout → `unknown`, `submit` called once even after `resumeAll`; 4xx → `not_billed`; success → clip saved and `actualMicroUsd` stored; a non-UploadThing URL never reaches `submit`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run the whole backend suite** (Compare tests included) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(render): one Seedance take with product and location references, never sent twice"`

---

### Task 12: Wiring the real agents, the routes and resume on boot

**Files:**
- Create: `apps/backend/src/orchestrate/director/agents.ts` (builds `DirectorAgents` from the real functions), `apps/backend/src/server/routes/director.ts`
- Modify: `apps/backend/src/server/app.ts`, `apps/backend/src/server/server.ts`, `apps/backend/src/server/sse.ts`
- Test: `apps/backend/tests/server/director.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `buildDirectorAgents(deps: { transport: ParseTransport; images: ImageTransport; host: ReferenceHost; store: DirectorRunStore; coach: CoachDeps; character: MakeCharacterDeps }): DirectorAgents`. Node bodies: `interrogator` → `interrogate`; `director` → `direct`, or `patchPlan` when `ctx.patch`; `planChecks` → `runPlanChecks(plan, answers.seconds, answers.mustNotAppear)`; `product` → `makeProductPicture` (skipped output `null` when the plan has no product asset); `location` → `makeLocationPicture`; `character` → existing avatar (`answers.cast.kind === "avatar"`) or `makeCharacter` from the plan's character asset description, then `coachDescription`; `cinematographer` → `shootAll`, or `reshoot` when `ctx.patch`; `assembler` → `assembleSeedancePrompt`; `promptChecks` → `runPromptChecks`. Each wraps its transport in `meter`.
  - `DirectorRouteDeps = { runner: RunnerDeps; store: DirectorRunStore; video: VideoTransport | null; avatars: AvatarStore }`; `AppDeps.director?: DirectorRouteDeps` (absent → every `/director` route answers 503 with `"the Director needs ANTHROPIC_API_KEY, GOOGLE_AI_KEY and UPLOADTHING_TOKEN"`).
  - Routes (all JSON; bodies validated with zod):
    - `POST /director/runs` `{ brief: string (1..300 chars) }` → 202 `{ id }`, drive fired without awaiting.
    - `GET /director/runs` → `DirectorRunSummary[]`.
    - `GET /director/runs/:id` → `DirectorRunView`.
    - `GET /director/runs/:id/events` → SSE of `DirectorEvent`, `id:` = `seq`, honours `Last-Event-ID`, replays from the store (not memory), 15 s keepalive, unsubscribes on close.
    - `GET /director/runs/:id/output?ref=nodes/<file>` → the node output JSON.
    - `GET /director/runs/:id/asset?ref=assets/<file>` → the bytes with their media type.
    - `POST /director/runs/:id/gates/A` `{ photo: { imageBase64, mediaType }, productKind, seconds, mustNotAppear: string[], cast }` → 202. Photo: `isSupportedMediaType`, decoded size ≤ 6 MB, else 400 before anything is written; `seconds` must pass `isValidVideoSeconds`; `cast.avatarId` must exist and have a description, else 422.
    - `POST /director/runs/:id/gates/B` `{ decision: "approve" } | { decision: "reject", reason }` → 202.
    - `POST /director/runs/:id/gates/C` `{ decision: "render", acceptNotPassed?: boolean } | { decision: "reject", reason }` → 202; 409 if a render is already claimed; 422 if the character did not pass and `acceptNotPassed !== true`; 503 if `video` is null.
    - `POST /director/runs/:id/render/again` → 202 only when status is `render_failed`; next attempt.
    - `GET /director/runs/:id/clip?attempt=n` → the mp4.
  - `formatDirectorSse(event: DirectorEvent): string` beside `formatSse`.
  - `DirectorEventHub` (`orchestrate/director/hub.ts`): `publish(ev)` and `subscribe(runId, sink) → unsubscribe`, in memory, for live delivery only. The runner's `publish` dep is `hub.publish`. The SSE route first subscribes to the hub (buffering), then replays `store.events(runId, lastEventId)`, then flushes the buffer, dropping any `seq` already sent, so no event is lost or doubled between replay and live.
  - `server.ts`: builds `FileDirectorRunStore(resolve("data/director-runs"))`, the real transports when keys are present, and calls `resumeAllDirectorRuns` once after `listen`.

- [ ] **Step 1: Write the failing tests** with `buildApp` and fake agents (Fastify `inject`): the full happy path through A, B, C with a fake `VideoTransport` (status ends `rendered`); gate answered out of order → 409; photo 7 MB → 400 and no asset on disk; second C press → 409 and one submit; C without `acceptNotPassed` when the fake coach returns `improved_still_failing` → 422; reject at B → status `rejected`, reason stored; SSE replays from `Last-Event-ID: 3` starting at seq 4; no `director` deps → 503.
- [ ] **Step 2: Run** `npx vitest run apps/backend/tests/server/director.test.ts` → FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run the full suite and typecheck** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(server): Director routes, live events, and resume after a restart"`

---

### Task 13: The owner's live run (owner only, paid)

No code. A checkpoint before Part 2 depends on real outputs.

- [ ] **Step 1 (free-ish, cents):** with keys in `.env`, `npm run dev:server`, then with `curl`: start a run with the owner's own brief, answer Gate A with the owner's product photo and an existing avatar, approve Gate B. Expected: status `awaiting_gate` at C; `events.jsonl` shows the four branch `node.started` events before any of their `node.completed`; product and location pictures are on UploadThing.
- [ ] **Step 2 (paid, the owner's decision, ~$0.92):** a 4-second probe through Gate C at 720×1280 to confirm OpenRouter accepts the two `input_references` and that the product appears once. Record the result in `docs/decision-log.md`.
- [ ] **Step 3: Commit the run folder** — `git add data/director-runs && git commit -m "chore(data): first Director run, through Gate C"`

---

### Task 14: Documents follow the code

**Files:**
- Modify: `docs/decision-log.md`, `docs/ai-director-requirements-and-advice.md`, `docs/architecture.md`, `CLAUDE.md`

- [ ] **Step 1:** Decision log, dated 26 Oct 2026, one entry each: gate order (decision 1); reference images for products and locations reverse "text only" for non-face images (decision 5, cite Mentic); one-view product picture (decision 6); shot length rule (decision 8); routed checks vs invariants (decision 9); the describe step stays on `claude-sonnet-5`, so NFR-4 now reads "the three new agents and the Prompt Coach use `claude-opus-5`".
- [ ] **Step 2:** Requirements: FR-2, FR-8, the §4 diagram and done-item 2 say one Cinematographer call for all shots, in parallel with the pictures; fix the [R§n] citations to the research's real section numbers (§3 Seedance rules, §4 multi-agent systems and patterns, §5 SWOT).
- [ ] **Step 3:** `architecture.md`: a Director section (recipe, runner, event log, routes). `CLAUDE.md`: the Director in Layout, `UPLOADTHING_TOKEN`, and the rule "only Gate C renders".
- [ ] **Step 4: Commit** — `git commit -m "docs: the Director's decisions, and the requirements brought in line with the design"`
