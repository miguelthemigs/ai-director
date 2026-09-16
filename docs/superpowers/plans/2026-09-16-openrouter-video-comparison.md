# OpenRouter Video Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the same avatar twice on Seedance 2.5 through OpenRouter — once from the raw `describeImage` output and once from the repaired description — with everything except the description held identical, and show the pair side by side with what each clip was estimated to cost and what it actually billed.

**Architecture:** Five phases in dependency order, each independently testable. Phase 1 ports Mentic's pricing and video client as modules with no callers, unit-tested with `fetch` stubbed. Phase 2 adds a file-backed comparison store and the two-clip orchestration, including the claim discipline that makes a double charge structurally impossible. Phase 3 puts routes in front of it. Phase 4 builds a fourth screen. Phase 5 builds the CLI that renders a pair and stops there. No step in this plan spends money: the owner runs every paid call, and the implementing agent proves the CLI with a dry run that submits nothing.

**Tech Stack:** Node 24, TypeScript (ESM), `fastify`, `zod`, React 19, Vite, `motion`, `vitest`. No new runtime dependency: OpenRouter's video endpoints are plain `fetch`, exactly as they are in Mentic (`lib/openrouter/video-client.ts` uses no SDK, because there is no first-party Node SDK for `/videos`).

**Spec:** `docs/superpowers/specs/2026-09-10-character-description-agents-design.md`

**Source ported from:** the Mentic repo at `~/Desktop/Mentic.io`, which migrated UGC video to OpenRouter on 2026-09-15. Specifically `lib/openrouter/seedance-pricing.ts`, `lib/openrouter/video-client.ts`, the header of `lib/video-lab/render-ugc.ts`, and `lib/video-lab/ugc-provider.ts`. Section 5 of `docs/architecture.md` already records which Mentic files this repo reproduces and why; this adds a row to that table.

---

## The scope question, answered before Task 1

Spec §2 says, in the list of things out of scope in v1: *"any Runway call, any render."* `PRODUCT.md` says *"nothing in it spends a render credit."* This plan renders. That is a real contradiction with the two documents that are the authority here, and it is not resolved by ignoring it.

It is resolved by reading `docs/decision-log.md`, 2026-09-11, **Unbuildable in v1**:

> Failure condition clause 2 ("repaired descriptions score higher on the rubric while a later render comparison shows no reduction in identity drift or refusal rate") cannot currently be evaluated by anything in this repository. Evaluating it needs a render comparison [...] It is not waiting on a command the way the four items above are; it is waiting on a different piece of research.

This plan is that different piece of research. So the honest framing is not "v1 grew a renderer" but "the render comparison clause 2 always needed is now being built, outside the v1 surface." Three consequences bind every task below:

1. **No screen that grades a description may change.** Run, Architecture and Versions keep every claim they make today. The Compare screen is a fourth screen and it grades nothing.
2. **`PRODUCT.md` and the spec's scope line are amended in Task 1, before any code lands**, so the repository is never in a state where the product document says something the code contradicts. An assessor reading `PRODUCT.md` against a repo that renders would be right to distrust everything else in it.
3. **The positioning line "Seedance 2.5 on Runway" is now wrong about the transport.** Same model, same weights, a different vendor billing for it (Mentic's `ugc-provider.ts` header makes exactly this point). Task 1 corrects it and Task 11 records why in the decision log.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `CLAUDE.md`, the spec, and the established facts of the OpenRouter migration.

### Inherited from `CLAUDE.md` and unchanged

- `packages/contract` is the only definition of types that cross the network. Defining one of these types a second time anywhere else is a defect.
- Rubric and prompt files are append-only. A change ships as a new version file. The shot-prompt wrapper introduced here is a prompt file and obeys this: it lives at `apps/backend/src/video/shotPrompt/v1.ts` and a change ships as `v2.ts`.
- Motion is tied to real state changes only. No ambient or looping animation anywhere. See "The spinner problem" below — this rule decides how a 60-to-180-second render reports progress.
- Never commit a key. Secrets live in `.env`; `.env.example` documents them.
- Model for the Evaluator and Repairer stays `claude-opus-5`. Nothing here touches either agent.
- `npm test` is the full suite; live API tests are skipped unless `RUN_LIVE_API=1`.
- ESM only: `__dirname` is undefined. Derive paths with `path.dirname(fileURLToPath(import.meta.url))` or use cwd-relative paths.

### OpenRouter, exact values

- Model slug: `bytedance/seedance-2.5`.
- `POST https://openrouter.ai/api/v1/videos`, `GET .../videos/{id}`, `GET .../videos/{id}/content?index=0`. The content endpoint requires `Authorization: Bearer <key>`, so the browser can never fetch it directly.
- Key from `OPENROUTER_API_KEY`. It is **not** in this repo's `.env` yet. Task 1 adds a documented placeholder to `.env.example` and copies no value from anywhere.
- Published sizes for this model: `854x480`, `752x560`, `640x640`, `560x752`, `480x854`, `992x432`, `1280x720`, `1112x834`, `960x960`, `834x1112`, `720x1280`, `1470x630`. This repo offers exactly two of them (below).
- Duration is an integer, 4 to 30 inclusive.
- Status map: `pending` and `in_progress` -> RUNNING; `completed` -> SUCCEEDED; `failed` -> FAILED; `cancelled` -> CANCELLED; `expired` -> FAILED. An unrecognised status maps to FAILED, never to `undefined` and never to a throw.
- `actualMicroUsd = Math.round(usage.cost * 1_000_000)` when `usage.cost` is a number, else `null`. Never `0` for unknown — `0` is a measurement of free.
- Request timeout 60s, and a submit that times out is **billed until proven otherwise**. See the claim discipline below.

### Sizes and cost, for this repo

- Offered sizes: **`480x854`** (default) and **`720x1280`**. Both vertical, both published for this model. Nothing else is offered, because nothing else has been probed here and a size picker that silently accepts an unprobed shape is a paid render finding out.
- Default duration: **4 seconds**, the model's floor.
- Cost formula, **derived and never typed as a literal**: `tokens = width * height * FPS * seconds / 1024` with `FPS = 24`, and `microUsd = round(tokens * MICRO_USD_PER_VIDEO_TOKEN)` with `MICRO_USD_PER_VIDEO_TOKEN = 10.7`. Both constants named and exported.
- The consequence, for orientation only — the code computes it: 480x854 for 4s is 38,430 tokens, 411,201 micro-USD, about **$0.41 a clip** and **$0.82 a pair**. 720x1280 for 4s is 86,400 tokens, 924,480 micro-USD, about **$0.92 a clip** and **$1.85 a pair**.
- **The estimate never overwrites the billed figure.** `estimatedMicroUsd` is computed before submitting and is a property of the request. `actualMicroUsd` arrives on the terminal task as `usage.cost` and is a property of the outcome. They are two columns, never one.

### The description travels as text, and only as text

No `input_references`. No `frame_images`. No image of the avatar anywhere in the request body. Mentic established this with nine probe calls on 2026-08-25 (four photos, both `promptImage` modes, an external HTTPS URL and Runway's own upload; every one refused with `INPUT_PREPROCESSING.SAFETY.THIRD_PARTY`, while the identical call carrying a logo rendered and billed), and `apps/backend/src/describe/prompt.ts` documents the same finding as the reason that file exists at all. **Do not add an image-reference path.** It will fail at full latency on every render, and the whole point of this comparison is that prose is the only carrier.

The avatar's rendered sheet is still on the screen. It is there for the human eye to compare the clips against, and it is never sent to the video model. That distinction has to be visible in the UI, for the same reason the composer says "this is what gets rendered, not what gets graded."

### Money safety, ported from `render-ugc.ts`

The claim discipline is Mentic's, verbatim in shape:

1. **Compare-and-swap before the call.** The submit claim is taken atomically before `fetch` is called, so two concurrent requests cannot both submit the same side.
2. **Never resubmit an unknown outcome.** If the claim is held and no task id was ever stamped, the previous attempt's result is UNKNOWN. OpenRouter publishes no endpoint that lists tasks by anything we hold, so that id is unrecoverable. The side settles FAILED and says why. It is never retried.
3. **Stamp the task id before anything waits on it.** A lost id is a paid render nobody can find.

And the classifier that decides whether a failed submit can be retried at all: `true` for exactly two shapes — a missing-key config error (nothing left the process) and a 4xx (OpenRouter answered that it would not accept the request). A timeout is **not** retryable: an abort cancels our wait, not the vendor's work. A 5xx is **not** retryable: OpenRouter's error envelope cannot distinguish "rejected before scheduling" from "scheduled, then failed while answering." A 2xx with an unparseable body is the worst case of all — the job almost certainly exists and what was lost is its id.

Nothing in this repo retries a submit today, and nothing in this plan adds one. The classifier is ported anyway because it is the thing that makes the decision auditable, and because the CLI in Phase 5 prints it.

### No invented ledger, no invented object store

`apps/backend/src/avatar/generateSheet.ts` says it in its own header and it still holds: this repo has no object store and no billing ledger, and inventing half of either would be worse than having none. Cost is shown to the user and stored on the render row. That is all. There is no spend total, no budget gate, no usage table, and no conversion into any credit currency.

Clip bytes are written to disk beside the comparison row, exactly the way `FileAvatarStore` writes sheet bytes. That is not an object store; it is the same "a paid artefact that exists only in a response body is one a reload destroys" rule that store already encodes.

### No test may spend money

Every vendor call goes through an injected transport, following the two seams this repo already has: `ImageTransport` in `apps/backend/src/avatar/generateSheet.ts` and `ParseTransport` in `apps/backend/src/api/client.ts`. The real implementation is constructed in exactly one place (`apps/backend/src/server/server.ts`, and the Phase 5 CLI), and only when `OPENROUTER_API_KEY` is present. Unit tests stub `globalThis.fetch` or inject a fake transport. The one live test is gated on `RUN_LIVE_API=1` alongside the existing ones in `apps/backend/tests/live/`.

### The spinner problem

A render takes one to three minutes and OpenRouter reports no numeric progress fraction — only a status. The repo's motion rule bans ambient and looping animation, which rules out a spinner, and `PRODUCT.md` bans inventing numbers, which rules out a synthesised percentage bar.

The resolution, and it is not a workaround: **each poll response is a real state change, so each poll may move the interface.** The Compare screen shows the number of status reads taken and the wall-clock elapsed time, both updating only when a poll actually returns. Nothing animates between polls. A render whose status has not changed in ninety seconds looks like a render whose status has not changed in ninety seconds, which is the truth.

### No new wire events

The contract's `EVENT_NAMES` enumerates exactly the nine event names spec §6 defines, and `docs/decision-log.md` (2026-09-11) records that adding to that list is a spec change rather than a bug fix. So the Compare screen **polls `GET /compare/:id`** and no video event is added to `RunEvent` or to `RunEventBus`. This is a deliberate constraint, not an oversight: the run stream carries runs.

### Version provenance on every render row

The comparison screen will eventually need to compare across prompt versions too — a v1 "after" against a v2 "after" — and a Repairer prompt v2 is being written in parallel with this plan. **This plan does not include that fix and must not implement it.** What it must do is make the confusion impossible later, so every render row carries three provenance fields:

- `rubricVersion` — read off the run manifest, which already has it.
- `repairerPromptVersion` — read off the run manifest when present, otherwise `null`. Never guessed. The manifest has no such field today; the field that will carry it is added when the v2 work lands, and until then `null` honestly means "this run predates the record."
- `descriptionSha256` — always present, computed here. This is the discriminator that works regardless: two descriptions produced by two prompt versions have two different hashes, and the full text is stored on the row beside the hash.

---

## File Structure

```
packages/contract/
  src/video.ts                              # NEW. Wire types for a comparison, plus the pure
                                            #   pricing formula both sides need.
  src/index.ts                              # MODIFY. One re-export line.
  tests/video.test.ts                       # NEW.

apps/backend/
  src/video/openrouterClient.ts             # NEW. submit / check / fetchClip, the VideoTransport
                                            #   seam, the error types, the unbilled classifier.
  src/video/shotPrompt/v1.ts                # NEW. The wrapper both clips share. Append-only.
  src/store/ComparisonStore.ts              # NEW. Interface + FileComparisonStore.
  src/compare/readSources.ts                # NEW. Run + avatar -> the two descriptions.
  src/compare/runComparison.ts              # NEW. Claim, submit, stamp, poll, download, cost.
  src/server/routes/compare.ts              # NEW. Five routes.
  src/server/app.ts                         # MODIFY. Register the routes.
  src/server/server.ts                      # MODIFY. Construct the transport and the store.
  src/cli/compare.ts                        # NEW. The gated paid probe.
  tests/video/openrouterClient.test.ts      # NEW.
  tests/video/shotPrompt.test.ts            # NEW.
  tests/store/ComparisonStore.test.ts       # NEW.
  tests/compare/readSources.test.ts         # NEW.
  tests/compare/runComparison.test.ts       # NEW.
  tests/server/compare.test.ts              # NEW.

apps/frontend/
  src/data/compareApi.ts                    # NEW. Plain functions, not on RunClient.
  src/screens/CompareScreen.tsx             # NEW.
  src/components/ClipPair.tsx               # NEW.
  src/components/CostReadout.tsx            # NEW.
  src/styles/compare-screen.css             # NEW.
  src/App.tsx                               # MODIFY. Fourth screen in the union and the router.
  src/components/ScreenTabs.tsx             # MODIFY. Fourth tab.
  vite.config.ts                            # MODIFY. Proxy /compare.
  tests/screens/CompareScreen.test.tsx      # NEW.
  tests/components/ClipPair.test.tsx        # NEW.
  tests/data/compareApi.test.ts             # NEW.

.env.example                                # MODIFY. OPENROUTER_API_KEY placeholder.
package.json                                # MODIFY. `npm run compare`.
PRODUCT.md                                  # MODIFY. The scope amendment.
docs/superpowers/specs/...-design.md        # MODIFY. §2 scope amendment, dated.
docs/architecture.md                        # MODIFY. One row in the §5 table, one §3 row.
docs/decision-log.md                        # MODIFY. Two entries (Task 1 and Task 11).
data/comparisons/<id>/                      # Runtime, gitignored.
  row.json
  before.claim  after.claim                 # Atomic claim files. Never deleted.
  before.mp4    after.mp4
.gitignore                                  # MODIFY. data/comparisons
```

### Task map

| Phase | Tasks | Deliverable |
|---|---|---|
| 1 — Provider, no callers | 1-3 | Pricing, contract types and a fully unit-tested OpenRouter client that nothing calls yet |
| 2 — Store and orchestration | 4-6 | `runComparison` drives two clips to terminal against a fake transport, with the claim discipline proven by test |
| 3 — Routes | 7 | `POST /compare` through `GET /compare/:id/:side/clip`, against a fake transport |
| 4 — The screen | 8-10 | A fourth tab that picks, estimates, submits, polls and plays |
| 5 — The probe | 11 | One real pair at 480x854 x 4s, about $0.82, written into the decision log |

Phases run in order. Within Phase 1, Tasks 2 and 3 are independent of each other and both depend on Task 1. Within Phase 4, Task 8 gates Tasks 9 and 10.

---

# Phase 1 — Provider modules with no callers

### Task 1: The scope amendment, the contract types, and the pricing formula

**Files:**
- Modify: `PRODUCT.md`
- Modify: `docs/superpowers/specs/2026-09-10-character-description-agents-design.md` (§2, the "Out of scope in v1" line)
- Modify: `docs/decision-log.md` (append one entry)
- Create: `packages/contract/src/video.ts`
- Modify: `packages/contract/src/index.ts`
- Modify: `.gitignore`
- Test: `packages/contract/tests/video.test.ts`

**Interfaces:**
- Consumes: `packages/contract/src/checks.ts` conventions only (nothing imported).
- Produces, all from `@ai-director/contract`:
  - `VIDEO_SIZES`, `VideoSize`, `DEFAULT_VIDEO_SIZE`, `videoSizeDimensions(size): { width: number; height: number }`
  - `MIN_VIDEO_SECONDS = 4`, `MAX_VIDEO_SECONDS = 30`, `DEFAULT_VIDEO_SECONDS = 4`, `isValidVideoSeconds(n: number): boolean`
  - `SEEDANCE_FPS = 24`, `MICRO_USD_PER_VIDEO_TOKEN = 10.7`, `SEEDANCE_MODEL = "bytedance/seedance-2.5"`
  - `videoTokens(width, height, seconds): number`, `estimateMicroUsd(size: VideoSize, seconds: number): number`
  - `RENDER_STATUSES`, `RenderStatus`, `isRenderTerminal(status): boolean`, `isRenderSuccess(status): boolean`
  - `ComparisonSide`, `RenderView`, `ComparisonView`, `ComparisonSummary`

**Why the pricing formula lives in the contract package and not the backend.** It is a function, not a type, so `CLAUDE.md`'s rule does not obviously reach it. But the screen has to show an estimate *before* anything is submitted — which is the exact reason Mentic split `seedance-pricing.ts` out of `video-client.ts` — and this repo has only one package both sides import. The alternatives are a second copy of the formula in the frontend, which is the defect `CLAUDE.md` names, or an HTTP round trip to multiply four numbers. So it goes here, with the constants defined once. It imports nothing and touches no network, so it stays safe for both sides to load.

- [ ] **Step 1: Amend `PRODUCT.md`**

In the **Positioning** section, replace:

```
The identity of a character survives only as prose, because Seedance 2.5 on Runway refuses a real
human face as any kind of input and two generations from the same description return two different
people. So the tool measures and repairs prose, and nothing in it spends a render credit.
```

with:

```
The identity of a character survives only as prose, because Seedance 2.5 refuses a real human face
as any kind of input and two generations from the same description return two different people. So
the tool measures and repairs prose. Grading spends no render credit; the Compare screen, added
2026-09-16, is the one surface that does, and it renders the same avatar twice to test whether a
repaired description buys anything a viewer can see.
```

In **Capabilities and Constraints**, replace the line `- Out of scope in v1: database, any Runway call, any render, auth, deployment, multi-user.` with:

```
- Out of scope in v1: database, auth, deployment, multi-user.
- Rendering is out of scope for the grading surface and always will be: no screen that scores a
  description may spend a render credit. The Compare screen is a separate fourth screen, added
  2026-09-16, which grades nothing and exists to evaluate failure-condition clause 2. It renders
  through OpenRouter rather than Runway — the same model and the same weights, a different vendor
  billing for it.
```

In **Operating Context**, replace `- Three screens: Run, Architecture, Versions.` with `- Four screens: Run, Architecture, Versions, Compare. The Architecture screen is an audit view driven by the same event stream as Run; Compare polls, and adds no event to that stream.` and delete the now-duplicated sentence about the Architecture screen that followed.

- [ ] **Step 2: Amend spec §2**

Replace the scope line:

```
Out of scope in v1: database, Interrogator agent, Director agent, Identity Meter, any Runway call,
any render, auth, deployment, multi-user.
```

with:

```
Out of scope in v1: database, Interrogator agent, Director agent, Identity Meter, auth, deployment,
multi-user.

Amended 2026-09-16. "Any Runway call, any render" was in this list and is now qualified rather than
deleted. It still binds every screen that scores a description: the Evaluator, the Repairer and the
Run, Architecture and Versions screens spend no render credit, and that is not negotiable. What it
never could bind is the pre-registered failure condition's clause 2, which asks whether repaired
descriptions actually reduce identity drift in a render — a question no amount of scoring can
answer. `docs/superpowers/plans/2026-09-16-openrouter-video-comparison.md` builds that comparison as
a fourth screen, outside the graded surface, on OpenRouter rather than Runway.
```

- [ ] **Step 3: Append the decision-log entry**

Append to `docs/decision-log.md`:

```markdown
## 2026-09-16 — The render comparison is being built, on OpenRouter, outside the graded surface

Spec §2 put "any render" out of scope for v1, and `PRODUCT.md` said nothing in the tool spends a
render credit. Both are amended today rather than quietly contradicted, because the entry above —
2026-09-11, **Unbuildable in v1** — already said why they would have to be: failure-condition clause
2 asks whether a repaired description reduces identity drift in an actual render, and nothing that
only scores text can answer it.

Two decisions inside that.

**The transport is OpenRouter, not Runway.** Same model (`bytedance/seedance-2.5`), same weights, a
different vendor billing for it. Mentic migrated its own UGC video the same way on 2026-09-15 and
measured about 23% less for an identical clip, and the client, the pricing and the claim discipline
are ported from there rather than written again. `PRODUCT.md`'s positioning line said "Seedance 2.5
on Runway" and now names the model without the vendor, because the vendor was never the claim.

**The rendering surface is walled off from the grading surface.** Compare is a fourth screen. It
grades nothing, it writes no rubric score, and it adds no event to the nine the run stream carries
(see the 2026-09-11 entry on why adding an event name is a spec change). A reader who distrusts the
render numbers can discard this screen whole and every number on the other three still stands.

No render has been made yet. The first one is Task 11 of the plan, one pair at 480x854 for four
seconds, estimated at about $0.82, and this entry gets a follow-up with what it actually billed and
what the two clips actually showed. If the two clips look equally unlike the sheet, that is the
result to report.
```

- [ ] **Step 4: Extend `.gitignore`**

Append a single line after `data/avatars`:

```
data/comparisons
```

- [ ] **Step 5: Write the failing test**

Create `packages/contract/tests/video.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isRenderSuccess,
  isRenderTerminal,
  isValidVideoSeconds,
  MAX_VIDEO_SECONDS,
  MICRO_USD_PER_VIDEO_TOKEN,
  MIN_VIDEO_SECONDS,
  SEEDANCE_FPS,
  SEEDANCE_MODEL,
  videoSizeDimensions,
  videoTokens,
  VIDEO_SIZES,
} from "../src/video.js";

describe("video sizes", () => {
  it("offers exactly the two probed vertical sizes, cheapest first", () => {
    expect(VIDEO_SIZES).toEqual(["480x854", "720x1280"]);
    expect(DEFAULT_VIDEO_SIZE).toBe("480x854");
  });

  it("splits a size into its dimensions", () => {
    expect(videoSizeDimensions("480x854")).toEqual({ width: 480, height: 854 });
    expect(videoSizeDimensions("720x1280")).toEqual({ width: 720, height: 1280 });
  });
});

describe("duration bounds", () => {
  it("accepts the published integer range and nothing else", () => {
    expect(MIN_VIDEO_SECONDS).toBe(4);
    expect(MAX_VIDEO_SECONDS).toBe(30);
    expect(DEFAULT_VIDEO_SECONDS).toBe(4);
    expect(isValidVideoSeconds(4)).toBe(true);
    expect(isValidVideoSeconds(30)).toBe(true);
    expect(isValidVideoSeconds(3)).toBe(false);
    expect(isValidVideoSeconds(31)).toBe(false);
    expect(isValidVideoSeconds(4.5)).toBe(false);
    expect(isValidVideoSeconds(Number.NaN)).toBe(false);
  });
});

describe("pricing", () => {
  it("names the constants rather than hiding them in the formula", () => {
    expect(SEEDANCE_FPS).toBe(24);
    expect(MICRO_USD_PER_VIDEO_TOKEN).toBe(10.7);
    expect(SEEDANCE_MODEL).toBe("bytedance/seedance-2.5");
  });

  it("derives token count from width x height x fps x seconds / 1024", () => {
    expect(videoTokens(480, 854, 4)).toBe(38430);
    expect(videoTokens(720, 1280, 4)).toBe(86400);
    expect(videoTokens(720, 1280, 8)).toBe(172800);
  });

  it("estimates the cheapest usable pair at about eighty cents", () => {
    // 38430 tokens x 10.7 = 411,201 micro-USD, and the pair is twice that.
    expect(estimateMicroUsd("480x854", 4)).toBe(411_201);
    expect(estimateMicroUsd("480x854", 4) * 2).toBe(822_402);
  });

  it("estimates the second size from the same formula, never a second table", () => {
    expect(estimateMicroUsd("720x1280", 4)).toBe(924_480);
    expect(estimateMicroUsd("720x1280", 8)).toBe(1_848_960);
  });

  it("rounds once, at the end", () => {
    // 480x854 for 5s is 48,037.5 tokens x 10.7 = 514,001.25, which must round to an
    // integer number of micro-USD rather than being floored per-token.
    expect(estimateMicroUsd("480x854", 5)).toBe(514_001);
  });
});

describe("render status", () => {
  it("treats succeeded, failed and cancelled as terminal and the rest as not", () => {
    expect(isRenderTerminal("queued")).toBe(false);
    expect(isRenderTerminal("running")).toBe(false);
    expect(isRenderTerminal("succeeded")).toBe(true);
    expect(isRenderTerminal("failed")).toBe(true);
    expect(isRenderTerminal("cancelled")).toBe(true);
  });

  it("makes succeeded the only success, so cancelled can never render as a win", () => {
    expect(isRenderSuccess("succeeded")).toBe(true);
    expect(isRenderSuccess("failed")).toBe(false);
    expect(isRenderSuccess("cancelled")).toBe(false);
    expect(isRenderSuccess("running")).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test and watch it fail**

Run: `npx vitest run packages/contract/tests/video.test.ts`
Expected: FAIL — `Failed to resolve import "../src/video.js"`.

- [ ] **Step 7: Write `packages/contract/src/video.ts`**

```ts
/**
 * The video comparison, as the wire carries it.
 *
 * ── Why a pure pricing formula sits in the contract package ─────────────────────────
 * `CLAUDE.md` makes this package the only definition of types that cross the network, and
 * these functions are not types. They are here anyway, for the reason Mentic split
 * `lib/openrouter/seedance-pricing.ts` out of its video client: the screen has to show an
 * estimate BEFORE anything is submitted, so the formula has to be loadable by a browser.
 * The only alternatives are a second copy of it in the frontend — the defect `CLAUDE.md`
 * names — or an HTTP round trip to multiply four numbers. This file imports nothing and
 * touches no network, so both sides can load it.
 *
 * ── The estimate is not the bill ────────────────────────────────────────────────────
 * `estimateMicroUsd` is a property of the REQUEST, computed from the published rate before
 * submitting. `RenderView.actualMicroUsd` is a property of the OUTCOME, reported by
 * OpenRouter as `usage.cost` on the terminal task. They are two fields and the estimate
 * never overwrites the bill, even when they agree.
 */

/** OpenRouter's model slug. The only video model this repo asks for. */
export const SEEDANCE_MODEL = "bytedance/seedance-2.5";

/**
 * The two sizes this repo offers, cheapest first. Both vertical, both on OpenRouter's
 * published list for this model.
 *
 * OpenRouter publishes twelve. Ten of them are absent deliberately: a size picker that
 * accepts a shape nobody has rendered here is a paid render finding out whether it works.
 * Adding a third is a one-line change plus a probe, in that order.
 */
export const VIDEO_SIZES = ["480x854", "720x1280"] as const;
export type VideoSize = (typeof VIDEO_SIZES)[number];

/** The cheapest usable vertical shape, and therefore the default. */
export const DEFAULT_VIDEO_SIZE: VideoSize = "480x854";

export function videoSizeDimensions(size: VideoSize): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  // Neither can be undefined for a member of VIDEO_SIZES; the guard exists so a future
  // entry typed with a comma or an "×" fails here rather than producing NaN micro-USD.
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`video size "${size}" is not <width>x<height>`);
  }
  return { width: width as number, height: height as number };
}

/** OpenRouter accepts an integer 4..30 for this model. */
export const MIN_VIDEO_SECONDS = 4;
export const MAX_VIDEO_SECONDS = 30;
/** The model's floor, which is also the cheapest clip that shows a face moving. */
export const DEFAULT_VIDEO_SECONDS = 4;

export function isValidVideoSeconds(seconds: number): boolean {
  return (
    Number.isInteger(seconds) && seconds >= MIN_VIDEO_SECONDS && seconds <= MAX_VIDEO_SECONDS
  );
}

/** Seedance renders at a fixed 24fps. The token count is derived from that, not from a
 *  per-request frame rate the API accepts. */
export const SEEDANCE_FPS = 24;

/**
 * Micro-USD per video token, from `GET /api/v1/videos/models`'s `pricing_skus.video_tokens`
 * for `bytedance/seedance-2.5`. $0.0000107 per token.
 */
export const MICRO_USD_PER_VIDEO_TOKEN = 10.7;

/** OpenRouter's own formula: `width * height * fps * seconds / 1024`. */
export function videoTokens(width: number, height: number, seconds: number): number {
  return (width * height * SEEDANCE_FPS * seconds) / 1024;
}

/**
 * Integer micro-USD for one clip, rounded once at the end. An ESTIMATE from the published
 * rate — never written into `actualMicroUsd`, which is the vendor's own figure.
 */
export function estimateMicroUsd(size: VideoSize, seconds: number): number {
  const { width, height } = videoSizeDimensions(size);
  return Math.round(videoTokens(width, height, seconds) * MICRO_USD_PER_VIDEO_TOKEN);
}

export const RENDER_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

/** Named `isRenderTerminal`, not `isTerminal`: `run.ts` already exports `isTerminal` for a
 *  run's status and both are re-exported from the same barrel. */
export function isRenderTerminal(status: RenderStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/** The single place that decides whether the UI may show a clip as a win. `cancelled` is
 *  terminal and is not success — the same rule `isSuccess` encodes for a run. */
export function isRenderSuccess(status: RenderStatus): boolean {
  return status === "succeeded";
}

/** Which description produced this clip. "before" is the raw describe output; "after" is
 *  the text as it stood when the run finished repairing it. */
export type ComparisonSide = "before" | "after";

export const COMPARISON_SIDES = ["before", "after"] as const;

export type RenderView = {
  side: ComparisonSide;
  status: RenderStatus;
  /** Stamped before anything waits on it. Null only before the submit returned. */
  taskId: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
  /** Machine-readable, e.g. "OPENROUTER_FAILED" or "OPENROUTER_UNKNOWN_OUTCOME". */
  failureCode: string | null;
  failure: string | null;
  /** From the published rate, before submitting. Always present. */
  estimatedMicroUsd: number;
  /** OpenRouter's own `usage.cost`, x 1e6, rounded. Null — never 0 — when the terminal
   *  task reported no cost. */
  actualMicroUsd: number | null;
  /** This server's own path for the stored clip, never OpenRouter's content URL, which is
   *  ephemeral and needs a bearer token the browser must never hold. */
  clipUrl: string | null;
  /** The exact text sent, stored verbatim so the comparison is reproducible. */
  description: string;
  /** The discriminator that works without any version record: two descriptions from two
   *  prompt versions hash differently. */
  descriptionSha256: string;
  /** Off the run manifest. */
  rubricVersion: string;
  /** Off the run manifest when it records one, else null. Never guessed: null means "this
   *  run predates the record", which is a different thing from "v1". */
  repairerPromptVersion: string | null;
  /** How many status reads have been taken. The Compare screen shows this instead of a
   *  spinner, because a poll returning is a real state change and a spinner is not. */
  polls: number;
};

export type ComparisonView = {
  comparisonId: string;
  createdAt: string;
  finishedAt: string | null;
  /** Whose sheet the two clips are compared against. The sheet is shown on screen and is
   *  never sent to the video model. */
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  model: string;
  /** Which version of the shared shot wrapper both clips used. */
  shotPromptVersion: string;
  before: RenderView;
  after: RenderView;
};

/** What `GET /compare` can answer without reading a row's full body. */
export type ComparisonSummary = {
  comparisonId: string;
  createdAt: string;
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  beforeStatus: RenderStatus;
  afterStatus: RenderStatus;
  /** The pair's estimate: both sides summed. Always present. */
  estimatedMicroUsd: number;
  /** The pair's bill, summed. Null unless BOTH sides reported one — a half-known total is
   *  a wrong total, and rendering it as if it were the pair's cost would understate it. */
  actualMicroUsd: number | null;
};

/** The pair's bill, or null when either side has not reported one. Exported rather than
 *  inlined at each call site so the "both or nothing" rule has exactly one definition. */
export function pairActualMicroUsd(
  before: number | null,
  after: number | null,
): number | null {
  return before === null || after === null ? null : before + after;
}
```

- [ ] **Step 8: Re-export from the barrel**

Add to `packages/contract/src/index.ts`, after the `./versions.js` line:

```ts
export * from "./video.js";
```

- [ ] **Step 9: Run the test and watch it pass**

Run: `npx vitest run packages/contract/tests/video.test.ts`
Expected: PASS, all cases.

Then `npm run typecheck`. Expected: clean. The barrel now exports `isRenderTerminal` beside `isTerminal` and `RenderStatus` beside `RunStatus`; if either collides, the name in `video.ts` is the one that changes.

- [ ] **Step 10: Commit**

```bash
git add PRODUCT.md docs/superpowers/specs/2026-09-10-character-description-agents-design.md \
  docs/decision-log.md .gitignore packages/contract/src/video.ts \
  packages/contract/src/index.ts packages/contract/tests/video.test.ts
git commit -m "feat(video): contract types and Seedance pricing, and amend the scope that forbade rendering

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The shot prompt wrapper, v1

**Files:**
- Create: `apps/backend/src/video/shotPrompt/v1.ts`
- Test: `apps/backend/tests/video/shotPrompt.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SHOT_PROMPT_VERSION = "v1"` and `buildShotPrompt(description: string): string`, from `apps/backend/src/video/shotPrompt/v1.ts`.

**This is a prompt file, so it is append-only.** A change ships as `v2.ts` exporting `SHOT_PROMPT_VERSION = "v2"`, and the version is stamped on every comparison row so two rows built by two wrappers are never confused. Do not edit `v1.ts` after the first comparison references it.

**What the wrapper is for.** The two clips differ in exactly one thing: the description. Everything else — the shot, the framing, the instruction not to add a scene — has to be byte-identical between them, which means it has to come from one function that takes the description as its only argument. A wrapper written twice, or interpolated at the call site, is how the two sides quietly stop being comparable.

**What it must not contain.** No camera move, no lighting, no location, no emotion. Those are the `no_cross_slot` and `drawable_only` checks' subject matter, and a wrapper that supplies them would be testing the wrapper rather than the description. The wrapper asks for a locked-off medium shot of the person and nothing else, because a static shot of a face is the hardest test of whether the identity holds.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/video/shotPrompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildShotPrompt, SHOT_PROMPT_VERSION } from "../../src/video/shotPrompt/v1.js";

const DESCRIPTION =
  "A young man in his mid-twenties with wavy brown hair, green eyes, light stubble and fair skin.";

describe("buildShotPrompt", () => {
  it("is versioned, so a row can record which wrapper produced it", () => {
    expect(SHOT_PROMPT_VERSION).toBe("v1");
  });

  it("carries the description verbatim", () => {
    expect(buildShotPrompt(DESCRIPTION)).toContain(DESCRIPTION);
  });

  it("is a pure function of the description, so the two sides differ only in that", () => {
    const a = buildShotPrompt(DESCRIPTION);
    const b = buildShotPrompt(DESCRIPTION);
    expect(a).toBe(b);

    const other = buildShotPrompt("A different person entirely.");
    const shared = a.replace(DESCRIPTION, "");
    const otherShared = other.replace("A different person entirely.", "");
    expect(shared).toBe(otherShared);
  });

  it("names no location, lighting, camera move or emotion", () => {
    const wrapper = buildShotPrompt(DESCRIPTION).replace(DESCRIPTION, "");
    for (const banned of [
      "kitchen",
      "office",
      "golden hour",
      "dolly",
      "pan",
      "zoom",
      "tracking",
      "happy",
      "confident",
      "moody",
    ]) {
      expect(wrapper.toLowerCase()).not.toContain(banned);
    }
  });

  it("refuses an empty description rather than sending a wrapper with a hole in it", () => {
    expect(() => buildShotPrompt("   ")).toThrow(/description/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/video/shotPrompt.test.ts`
Expected: FAIL — cannot resolve `../../src/video/shotPrompt/v1.js`.

- [ ] **Step 3: Write `apps/backend/src/video/shotPrompt/v1.ts`**

```ts
/**
 * The wrapper both clips share, v1.
 *
 * ── APPEND-ONLY ─────────────────────────────────────────────────────────────────────
 * This is a prompt file. `CLAUDE.md`: a change ships as a new version file. Once any
 * comparison row records `shotPromptVersion: "v1"`, this string is frozen, and a revision
 * is `v2.ts` exporting `SHOT_PROMPT_VERSION = "v2"`. Editing it in place would silently
 * change what every earlier row claims to have rendered.
 *
 * ── Why the wrapper is a function and not a template literal at the call site ────────
 * The comparison's whole claim is that the two clips differ in ONE thing. That holds only
 * if every other byte of the two prompts is identical, which is a property of there being
 * one function with one argument. Interpolating the wrapper at two call sites is how the
 * two sides stop being comparable without anyone noticing.
 *
 * ── Why it is this bare ─────────────────────────────────────────────────────────────
 * No location, no lighting, no camera move, no emotion. Those are exactly what the
 * `no_cross_slot` and `drawable_only` checks exist to keep OUT of a character description,
 * and a wrapper that supplied them would be measuring the wrapper. A locked-off medium
 * shot of a person doing almost nothing is also the hardest case for identity: there is
 * no motion, no cut and no scene for a drifting face to hide behind.
 *
 * ── No image, ever ──────────────────────────────────────────────────────────────────
 * The person reaches the model as text and nothing else. Mentic's nine probe calls on
 * 2026-08-25 established that a human likeness in any input image is refused, and
 * `apps/backend/src/describe/prompt.ts` documents the same finding as the reason it
 * exists. Nothing here builds an `input_references` array and nothing should.
 */

export const SHOT_PROMPT_VERSION = "v1";

const WRAPPER_HEAD = [
  "A single locked-off medium shot of one person, facing the camera, plain neutral background.",
  "",
  "The person:",
  "",
].join("\n");

const WRAPPER_TAIL = [
  "",
  "",
  "The person stands still and looks into the lens, with small natural movements only.",
  "The camera does not move. There is no cut and no second shot.",
].join("\n");

/** One description in, one prompt out. The only argument, deliberately. */
export function buildShotPrompt(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    throw new Error("buildShotPrompt: description must not be empty");
  }
  return `${WRAPPER_HEAD}${trimmed}${WRAPPER_TAIL}`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/video/shotPrompt.test.ts`
Expected: PASS, five cases.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/video/shotPrompt/v1.ts apps/backend/tests/video/shotPrompt.test.ts
git commit -m "feat(video): the shot prompt wrapper both clips share, v1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The OpenRouter video client, with `fetch` stubbed

**Files:**
- Create: `apps/backend/src/video/openrouterClient.ts`
- Modify: `.env.example`
- Test: `apps/backend/tests/video/openrouterClient.test.ts`

**Interfaces:**
- Consumes: `SEEDANCE_MODEL`, `RenderStatus` from `@ai-director/contract` (Task 1).
- Produces, from `apps/backend/src/video/openrouterClient.ts`:
  - `type VideoSubmitRequest = { model: string; prompt: string; duration: number; size: string; generate_audio: boolean }`
  - `type VideoTaskResult = { taskId: string; status: RenderStatus; failureCode: string | null; failure: string | null; actualMicroUsd: number | null }`
  - `type VideoTransport = { submit(req): Promise<{ taskId: string }>; check(taskId): Promise<VideoTaskResult>; fetchClip(taskId): Promise<{ bytes: Buffer; mediaType: string }> }`
  - `class OpenRouterConfigError extends Error`, `class OpenRouterHttpError extends Error` (with `readonly status: number`)
  - `submitProvablyUnbilled(err: unknown): boolean`
  - `openrouterContentUrl(taskId: string): string`
  - `createOpenRouterVideoTransport(): VideoTransport`
  - `OPENROUTER_VIDEOS_ENDPOINT`

**Nothing calls this yet.** That is the deliverable: a client that is fully exercised by unit tests before a single caller can be wrong about it. This mirrors Mentic's own Task 1 brief, which ended "No callers yet."

**The one deliberate divergence from Mentic.** Mentic's `VideoTaskResult` re-exports `RunwayTaskResult` widened, so both transports read through one type, and it carries `outputUrls`, `progress` and `actualCredits`. This repo has no Runway client to widen and no second transport to unify with, so those three fields would be structurally dead: `actualCredits` is always null here, `progress` is always null because OpenRouter reports no fraction, and `outputUrls` would be a one-element array of a URL only the server may fetch. The type is written fresh and narrow. `openrouterContentUrl` is still exported, because the transport needs it and the Phase 5 CLI prints it.

**`generate_audio` is `false`.** Mentic sends `true` because a UGC ad has a script. Here the variable under test is whether a face holds, and two different synthesised voices would dominate a viewer's sense of "these are two different people" for a reason that has nothing to do with the description. It costs nothing either way — the token formula has no audio term — so this is purely about removing a confound.

- [ ] **Step 1: Document the key in `.env.example`**

Append to `.env.example`, after the `GOOGLE_AI_KEY` block:

```
# OpenRouter — Seedance 2.5 video, used ONLY by the Compare screen and `npm run compare`.
# Every call through this key SPENDS MONEY: about $0.41 a clip at 480x854 for 4 seconds,
# so about $0.82 for one side-by-side pair. Without it the app grades and repairs exactly
# as before; POST /compare answers 503 and the Compare screen says so.
OPENROUTER_API_KEY=
```

Do not copy a value from any other repository or `.env` file. The placeholder is empty.

- [ ] **Step 2: Write the failing test**

Create `apps/backend/tests/video/openrouterClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOpenRouterVideoTransport,
  OpenRouterConfigError,
  OpenRouterHttpError,
  openrouterContentUrl,
  OPENROUTER_VIDEOS_ENDPOINT,
  submitProvablyUnbilled,
} from "../../src/video/openrouterClient.js";

const REQUEST = {
  model: "bytedance/seedance-2.5",
  prompt: "A single locked-off medium shot.",
  duration: 4,
  size: "480x854",
  generate_audio: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("submit", () => {
  it("posts to the videos endpoint with a bearer token and returns the task id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1" }));

    const result = await createOpenRouterVideoTransport().submit(REQUEST);

    expect(result).toEqual({ taskId: "task-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_VIDEOS_ENDPOINT);
    expect(url).toBe("https://openrouter.ai/api/v1/videos");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it("never sends an image reference, whatever the caller passed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1" }));
    await createOpenRouterVideoTransport().submit(REQUEST);
    const body = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string;
    expect(body).not.toContain("input_references");
    expect(body).not.toContain("frame_images");
  });

  it("throws a typed HTTP error carrying the upstream message and the status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "size not supported" } }, 400),
    );

    const error = await createOpenRouterVideoTransport()
      .submit(REQUEST)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OpenRouterHttpError);
    expect((error as OpenRouterHttpError).status).toBe(400);
    expect((error as Error).message).toContain("size not supported");
  });

  it("quotes a truncated snippet when the error body is not the documented shape", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway timeout</html>", { status: 504 }));

    const error = await createOpenRouterVideoTransport()
      .submit(REQUEST)
      .catch((err: unknown) => err);

    expect((error as Error).message).toContain("504");
    expect((error as Error).message).toContain("gateway timeout");
  });

  it("refuses a 2xx whose body has no id rather than returning an undefined task id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(createOpenRouterVideoTransport().submit(REQUEST)).rejects.toThrow(/id/i);
  });
});

describe("status map", () => {
  const cases: Array<[string, string]> = [
    ["pending", "queued"],
    ["in_progress", "running"],
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["expired", "failed"],
  ];

  for (const [upstream, expected] of cases) {
    it(`maps "${upstream}" to "${expected}"`, async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: upstream }));
      const result = await createOpenRouterVideoTransport().check("task-1");
      expect(result.status).toBe(expected);
    });
  }

  it("maps an unrecognised status to failed rather than throwing or returning undefined", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "reticulating" }));
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("OPENROUTER_UNKNOWN_STATUS");
    expect(result.failure).toContain("reticulating");
  });

  it("carries the upstream failure code and message on a failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "task-1",
        status: "failed",
        error: { code: "CONTENT_POLICY", message: "refused" },
      }),
    );
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.failureCode).toBe("CONTENT_POLICY");
    expect(result.failure).toBe("refused");
  });

  it("falls back to OPENROUTER_FAILED when the vendor names no code", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "failed" }));
    const result = await createOpenRouterVideoTransport().check("task-1");
    expect(result.failureCode).toBe("OPENROUTER_FAILED");
    expect(result.failure).toBeNull();
  });

  it("reads the vendor's cost into integer micro-USD, and null when it reports none", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "task-1", status: "completed", usage: { cost: 0.41 } }),
    );
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBe(410_000);

    fetchMock.mockResolvedValue(jsonResponse({ id: "task-1", status: "completed" }));
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBeNull();

    fetchMock.mockResolvedValue(
      jsonResponse({ id: "task-1", status: "completed", usage: { cost: null } }),
    );
    expect((await createOpenRouterVideoTransport().check("task-1")).actualMicroUsd).toBeNull();
  });
});

describe("fetchClip", () => {
  it("fetches the content URL with the bearer token and returns bytes", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      }),
    );

    const clip = await createOpenRouterVideoTransport().fetchClip("task-1");

    expect(clip.mediaType).toBe("video/mp4");
    expect([...clip.bytes]).toEqual([0, 1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/videos/task-1/content?index=0");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("defaults the media type when the vendor sends none, rather than storing an empty one", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0]), { status: 200 }));
    const clip = await createOpenRouterVideoTransport().fetchClip("task-1");
    expect(clip.mediaType).toBe("video/mp4");
  });
});

describe("the key", () => {
  it("throws at call time, never at import", async () => {
    delete process.env.OPENROUTER_API_KEY;
    // Constructing the transport must not throw either: the server builds one only when
    // the key is present, but a test or a CLI may construct one to inspect it.
    const transport = createOpenRouterVideoTransport();
    await expect(transport.submit(REQUEST)).rejects.toBeInstanceOf(OpenRouterConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitProvablyUnbilled", () => {
  it("is true only when nothing left the process, or OpenRouter refused the request", () => {
    expect(submitProvablyUnbilled(new OpenRouterConfigError("no key"))).toBe(true);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("bad size", 400))).toBe(true);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("rate limited", 429))).toBe(true);
  });

  it("is false for a 5xx, a timeout and anything unrecognised", () => {
    expect(submitProvablyUnbilled(new OpenRouterHttpError("upstream", 500))).toBe(false);
    expect(submitProvablyUnbilled(new OpenRouterHttpError("gateway", 504))).toBe(false);
    expect(submitProvablyUnbilled(new DOMException("aborted", "TimeoutError"))).toBe(false);
    expect(submitProvablyUnbilled(new Error("unparseable 200 body"))).toBe(false);
    expect(submitProvablyUnbilled("not an error at all")).toBe(false);
  });
});

describe("openrouterContentUrl", () => {
  it("is the documented shape", () => {
    expect(openrouterContentUrl("abc")).toBe(
      "https://openrouter.ai/api/v1/videos/abc/content?index=0",
    );
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/video/openrouterClient.test.ts`
Expected: FAIL — cannot resolve `../../src/video/openrouterClient.js`.

- [ ] **Step 4: Write `apps/backend/src/video/openrouterClient.ts`**

```ts
import type { RenderStatus } from "@ai-director/contract";

/**
 * Seedance 2.5 over OpenRouter's `/videos` endpoints.
 *
 * Ported from `lib/openrouter/video-client.ts` in the Mentic repo (read 2026-09-16), which
 * has run real paid renders through this exact call shape since 2026-09-15. Plain `fetch`,
 * because OpenRouter publishes no first-party Node SDK for `/videos`.
 *
 * ── What was NOT ported, and why ────────────────────────────────────────────────────
 * Mentic's `VideoTaskResult` re-exports Runway's own result type widened, so two
 * transports read through one shape, and carries `outputUrls`, `progress` and
 * `actualCredits`. This repo has one transport and no Runway client. All three fields
 * would be structurally dead here — `actualCredits` always null, `progress` always null
 * because OpenRouter reports no fraction, `outputUrls` a one-element array of a URL only
 * this server may fetch — so the type is written narrow rather than inherited wide.
 *
 * ── Nothing here decides what to render ─────────────────────────────────────────────
 * Same discipline as the file it came from: this module submits and polls once told to.
 * Which description, which size and which seconds are decided in `compare/runComparison.ts`,
 * and the claim discipline that keeps a submit from happening twice lives there too,
 * because it needs a store.
 *
 * ── Text only ───────────────────────────────────────────────────────────────────────
 * `VideoSubmitRequest` has no `input_references` and no `frame_images` field, so there is
 * no way to add one without editing this type. That is deliberate. Mentic's nine probe
 * calls on 2026-08-25 established that a human likeness in an input image is refused at
 * full latency on every render.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** `POST` here submits a render. Exported so a caller recording what it sent reads the
 *  endpoint off the one string this file actually posts to. */
export const OPENROUTER_VIDEOS_ENDPOINT = `${OPENROUTER_BASE_URL}/videos`;

/**
 * Per-request ceiling. 60s, not less, and the reasoning is Mentic's: a submit aborted
 * client-side AFTER OpenRouter accepted it is the expensive failure — a task that bills
 * with no id ever stored on our side. Nothing here runs anywhere a real Node timer cannot
 * fire.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/** Longest raw-body snippet an error message quotes, so an HTML gateway page cannot bloat
 *  what gets written onto a render row. */
const ERROR_BODY_SNIPPET_LENGTH = 200;

/** What a finished clip is assumed to be when the vendor names no type. */
const DEFAULT_CLIP_MEDIA_TYPE = "video/mp4";

/** The body this client posts. No image field exists, by construction. */
export type VideoSubmitRequest = {
  model: string;
  prompt: string;
  /** Integer seconds, 4..30 for this model. Validated by the caller. */
  duration: number;
  size: string;
  generate_audio: boolean;
};

export type VideoTaskResult = {
  taskId: string;
  status: RenderStatus;
  failureCode: string | null;
  failure: string | null;
  /** `usage.cost` x 1e6, rounded. Null — never 0 — when the terminal task reported none. */
  actualMicroUsd: number | null;
};

/**
 * The injected seam, following `ImageTransport` in `avatar/generateSheet.ts` and
 * `ParseTransport` in `api/client.ts`. Everything above it takes one of these, so no test
 * in this repo can spend money by accident.
 */
export type VideoTransport = {
  submit(req: VideoSubmitRequest): Promise<{ taskId: string }>;
  check(taskId: string): Promise<VideoTaskResult>;
  /** The clip bytes. Separate from `check` because it is only ever called once, on a
   *  succeeded task, and because the caller writes them to disk rather than holding them. */
  fetchClip(taskId: string): Promise<{ bytes: Buffer; mediaType: string }>;
};

/**
 * NOTHING LEFT THE PROCESS. Thrown before any `fetch`, so a call that fails this way
 * provably reached no vendor and provably billed nothing.
 */
export class OpenRouterConfigError extends Error {
  readonly name = "OpenRouterConfigError";
}

/**
 * OPENROUTER ANSWERED, and the answer was not a success. Carries the HTTP status, which is
 * the only evidence this client can offer about whether a job was created — precisely what
 * a timeout, an abort or a socket reset cannot tell us, which is why those keep throwing
 * their own raw types rather than this one.
 */
export class OpenRouterHttpError extends Error {
  readonly name = "OpenRouterHttpError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * CAN A FAILED SUBMIT BE RETRIED WITHOUT RISKING A SECOND CHARGE?
 *
 * True for exactly two shapes, and the burden of proof is entirely on true:
 *   1. {@link OpenRouterConfigError} — no request was made.
 *   2. {@link OpenRouterHttpError} with a 4xx — OpenRouter answered that it would not
 *      accept the request, and a rejected request creates no job.
 *
 * A TIMEOUT is billed until proven otherwise: an abort cancels our wait, not the vendor's
 * work, and there is no endpoint that lists jobs by anything we hold, so re-rendering
 * would charge twice for one clip and nobody would find out. Its transience is not the
 * question; whether a job exists is, and a timeout cannot answer it.
 *
 * A 5xx would qualify only if its body PROVED no job was created, and OpenRouter's error
 * envelope cannot distinguish "rejected before scheduling" from "scheduled, then failed
 * while answering". A 2xx with an unparseable body is the worst case of all: the job
 * almost certainly exists and what was lost is its id.
 *
 * Nothing in this repo retries a submit. This is here so the decision is auditable and so
 * the CLI can print it.
 */
export function submitProvablyUnbilled(err: unknown): boolean {
  if (err instanceof OpenRouterConfigError) return true;
  return err instanceof OpenRouterHttpError && err.status >= 400 && err.status < 500;
}

/** Read at call time, so importing this module without a key never throws. */
function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new OpenRouterConfigError(
      "OPENROUTER_API_KEY missing, required for OpenRouter video generation",
    );
  }
  return key;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}` };
}

/** OpenRouter's own URL for the finished clip. EPHEMERAL, and it requires the bearer
 *  token, which is why the browser is never given it. */
export function openrouterContentUrl(taskId: string): string {
  return `${OPENROUTER_BASE_URL}/videos/${taskId}/content?index=0`;
}

/** OpenRouter's task status vocabulary. */
type UpstreamStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

type UpstreamStatusResponse = {
  id: string;
  status: UpstreamStatus;
  usage?: { cost?: number | null } | null;
  error?: { code?: string | null; message?: string | null } | null;
};

/**
 * Reads `error.message` off a non-2xx body, falling back to a status line with a truncated
 * snippet of the raw body attached rather than discarding text already read for nothing.
 * This is what gets written onto a render row, so it must never be empty.
 */
async function upstreamErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string | null } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON, or not the documented shape — fall through to the status line.
  }
  const snippet =
    text.length > ERROR_BODY_SNIPPET_LENGTH
      ? `${text.slice(0, ERROR_BODY_SNIPPET_LENGTH)}…`
      : text;
  return snippet
    ? `OpenRouter request failed with status ${res.status}: ${snippet}`
    : `OpenRouter request failed with status ${res.status}`;
}

/**
 * Maps one `GET /videos/{id}` body onto a {@link VideoTaskResult}.
 *
 * `expired` maps to FAILED: a render that timed out upstream is a failure from our side
 * too, not something to keep polling. An unrecognised status maps to FAILED rather than
 * falling through to `undefined` — `body.status` comes off a force-cast `res.json()` with
 * no runtime validation, so the six-way union it is typed as is not a guarantee. FAILED
 * and not a throw, because a caller that treats a thrown check as "unsettled, retry later"
 * would poll an unrecognised-forever status for the whole window instead of surfacing it.
 */
function classify(body: UpstreamStatusResponse): VideoTaskResult {
  const actualMicroUsd =
    typeof body.usage?.cost === "number" ? Math.round(body.usage.cost * 1_000_000) : null;
  const base = { taskId: body.id, failureCode: null, failure: null, actualMicroUsd };

  switch (body.status) {
    case "pending":
      return { ...base, status: "queued" };
    case "in_progress":
      return { ...base, status: "running" };
    case "completed":
      return { ...base, status: "succeeded" };
    case "cancelled":
      return { ...base, status: "cancelled" };
    case "failed":
    case "expired":
      return {
        ...base,
        status: "failed",
        failureCode: body.error?.code ?? "OPENROUTER_FAILED",
        failure: body.error?.message ?? null,
      };
    default:
      return {
        ...base,
        status: "failed",
        failureCode: "OPENROUTER_UNKNOWN_STATUS",
        failure: `OpenRouter reported an unrecognised status "${String(body.status)}" for task ${body.id}.`,
      };
  }
}

/** The one implementation that talks to OpenRouter. Constructed in `server.ts` and in the
 *  Phase 5 CLI, and nowhere else. */
export function createOpenRouterVideoTransport(): VideoTransport {
  return {
    async submit(req) {
      const res = await fetch(OPENROUTER_VIDEOS_ENDPOINT, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Typed, because the STATUS is evidence: see `submitProvablyUnbilled`.
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      let body: { id?: string };
      try {
        body = (await res.json()) as { id?: string };
      } catch (err) {
        throw new Error(
          `OpenRouter returned an unparseable response for the video submit: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (typeof body.id !== "string" || body.id.length === 0) {
        // A 2xx with no id is the one outcome that is certainly billed and certainly
        // unrecoverable. It has to fail loudly rather than return an undefined id that a
        // caller would happily write to disk.
        throw new Error(
          "OpenRouter accepted the video submit but returned no task id, so the render cannot be tracked",
        );
      }
      return { taskId: body.id };
    },

    async check(taskId) {
      const res = await fetch(`${OPENROUTER_BASE_URL}/videos/${taskId}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      let body: UpstreamStatusResponse;
      try {
        body = (await res.json()) as UpstreamStatusResponse;
      } catch (err) {
        throw new Error(
          `OpenRouter returned an unparseable status response for task ${taskId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return classify(body);
    },

    async fetchClip(taskId) {
      const res = await fetch(openrouterContentUrl(taskId), {
        headers: authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new OpenRouterHttpError(await upstreamErrorMessage(res), res.status);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      return {
        bytes,
        mediaType: res.headers.get("Content-Type") ?? DEFAULT_CLIP_MEDIA_TYPE,
      };
    },
  };
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/video/openrouterClient.test.ts`
Expected: PASS, every case including all six status mappings.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: green. Nothing calls the new module yet, so nothing else can have moved.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/video/openrouterClient.ts \
  apps/backend/tests/video/openrouterClient.test.ts .env.example
git commit -m "feat(video): OpenRouter Seedance client, submit/check/fetchClip, no callers yet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Phase 2 — Store and the two-clip orchestration

### Task 4: `ComparisonStore` and `FileComparisonStore`

**Files:**
- Create: `apps/backend/src/store/ComparisonStore.ts`
- Test: `apps/backend/tests/store/ComparisonStore.test.ts`

**Interfaces:**
- Consumes: `ComparisonView`, `ComparisonSummary`, `ComparisonSide`, `RenderStatus`, `RenderView`, `VideoSize`, `pairActualMicroUsd` from `@ai-director/contract` (Task 1).
- Produces, from `apps/backend/src/store/ComparisonStore.ts`:
  - `interface ComparisonStore` with `create`, `claimSubmit`, `stampTaskId`, `patchRender`, `get`, `list`, `writeClip`, `readClip`
  - `class FileComparisonStore implements ComparisonStore`
  - `type ClaimResult = "claimed" | "already_claimed"`

**The claim is a file, and that is what makes it atomic.** Mentic's compare-and-swap is a Prisma `updateMany` with a `submitAttemptedAt: null` predicate. There is no database here. `writeFile(path, "", { flag: "wx" })` fails with `EEXIST` if the file exists, and on every POSIX filesystem that check-and-create is one atomic operation — which is the same guarantee, obtained from the tool this repo actually has. The claim file is written **before** `submit` is called, and **never deleted**: a claim that could be released is not a claim, and the whole point is that the second attempt finds evidence of the first.

Follow `FileAvatarStore` for shape: a directory per id, `row.json` beside the bytes, `get` returning `null` for a missing row, `list` returning `[]` for a store that was never written to.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/store/ComparisonStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";

let root: string;
let store: FileComparisonStore;

const SOURCES = {
  before: {
    description: "The raw description.",
    descriptionSha256: "a".repeat(64),
  },
  after: {
    description: "The repaired description.",
    descriptionSha256: "b".repeat(64),
  },
};

async function create() {
  return store.create({
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    rubricVersion: "v1",
    repairerPromptVersion: null,
    estimatedMicroUsd: 411_201,
    sources: SOURCES,
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "comparisons-"));
  store = new FileComparisonStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("create", () => {
  it("writes a row with both sides queued, estimated and unbilled", async () => {
    const row = await create();

    expect(row.comparisonId).toMatch(/[0-9a-f-]{36}/);
    expect(row.before.status).toBe("queued");
    expect(row.after.status).toBe("queued");
    expect(row.before.taskId).toBeNull();
    expect(row.before.estimatedMicroUsd).toBe(411_201);
    expect(row.after.estimatedMicroUsd).toBe(411_201);
    expect(row.before.actualMicroUsd).toBeNull();
    expect(row.after.actualMicroUsd).toBeNull();
    expect(row.before.polls).toBe(0);
  });

  it("keeps each side's own description and hash", async () => {
    const row = await create();
    expect(row.before.description).toBe("The raw description.");
    expect(row.after.description).toBe("The repaired description.");
    expect(row.before.descriptionSha256).not.toBe(row.after.descriptionSha256);
  });

  it("stamps the provenance both sides share", async () => {
    const row = await create();
    expect(row.shotPromptVersion).toBe("v1");
    expect(row.before.rubricVersion).toBe("v1");
    expect(row.after.rubricVersion).toBe("v1");
    expect(row.before.repairerPromptVersion).toBeNull();
  });

  it("is readable back off disk", async () => {
    const row = await create();
    expect(await store.get(row.comparisonId)).toEqual(row);
  });
});

describe("claimSubmit", () => {
  it("succeeds once per side and refuses every later attempt", async () => {
    const row = await create();
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("claimed");
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("already_claimed");
    // The other side is a separate claim.
    expect(await store.claimSubmit(row.comparisonId, "after")).toBe("claimed");
  });

  it("survives a process restart, because the claim is a file and is never deleted", async () => {
    const row = await create();
    expect(await store.claimSubmit(row.comparisonId, "before")).toBe("claimed");

    const second = new FileComparisonStore(root);
    expect(await second.claimSubmit(row.comparisonId, "before")).toBe("already_claimed");
  });

  it("lets exactly one of many concurrent callers through", async () => {
    const row = await create();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.claimSubmit(row.comparisonId, "before")),
    );
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
  });
});

describe("stampTaskId and patchRender", () => {
  it("writes the task id to disk before anything else touches the row", async () => {
    const row = await create();
    await store.stampTaskId(row.comparisonId, "before", "task-1");

    const raw = JSON.parse(
      await readFile(path.join(root, row.comparisonId, "row.json"), "utf8"),
    ) as { before: { taskId: string; submittedAt: string } };
    expect(raw.before.taskId).toBe("task-1");
    expect(raw.before.submittedAt).toEqual(expect.any(String));
  });

  it("merges a patch onto one side and leaves the other untouched", async () => {
    const row = await create();
    await store.patchRender(row.comparisonId, "before", {
      status: "succeeded",
      actualMicroUsd: 410_000,
      finishedAt: "2026-09-16T10:00:00.000Z",
    });

    const after = await store.get(row.comparisonId);
    expect(after?.before.status).toBe("succeeded");
    expect(after?.before.actualMicroUsd).toBe(410_000);
    expect(after?.before.description).toBe("The raw description.");
    expect(after?.after.status).toBe("queued");
  });

  it("sets finishedAt on the comparison only when both sides are terminal", async () => {
    const row = await create();
    await store.patchRender(row.comparisonId, "before", { status: "succeeded" });
    expect((await store.get(row.comparisonId))?.finishedAt).toBeNull();

    await store.patchRender(row.comparisonId, "after", { status: "failed" });
    expect((await store.get(row.comparisonId))?.finishedAt).toEqual(expect.any(String));
  });

  it("throws for a comparison that does not exist, rather than writing a new one", async () => {
    await expect(store.patchRender("nope", "before", { status: "failed" })).rejects.toThrow(
      /nope/,
    );
  });
});

describe("clips", () => {
  it("round-trips bytes and their media type", async () => {
    const row = await create();
    await store.writeClip(row.comparisonId, "before", Buffer.from([1, 2, 3]), "video/mp4");

    const clip = await store.readClip(row.comparisonId, "before");
    expect(clip?.mediaType).toBe("video/mp4");
    expect([...(clip?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("returns null for a side with no clip", async () => {
    const row = await create();
    expect(await store.readClip(row.comparisonId, "after")).toBeNull();
  });
});

describe("list", () => {
  it("is empty for a store nothing has written to", async () => {
    expect(await new FileComparisonStore(path.join(root, "never")).list()).toEqual([]);
  });

  it("summarises newest first, and reports a pair total only when both sides billed", async () => {
    const first = await create();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await create();

    await store.patchRender(first.comparisonId, "before", {
      status: "succeeded",
      actualMicroUsd: 410_000,
    });

    let rows = await store.list();
    expect(rows[0]?.comparisonId).toBe(second.comparisonId);
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.actualMicroUsd).toBeNull();
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.estimatedMicroUsd).toBe(
      822_402,
    );

    await store.patchRender(first.comparisonId, "after", {
      status: "succeeded",
      actualMicroUsd: 412_000,
    });
    rows = await store.list();
    expect(rows.find((r) => r.comparisonId === first.comparisonId)?.actualMicroUsd).toBe(822_000);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/store/ComparisonStore.test.ts`
Expected: FAIL — cannot resolve `../../src/store/ComparisonStore.js`.

- [ ] **Step 3: Write `apps/backend/src/store/ComparisonStore.ts`**

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  isRenderTerminal,
  pairActualMicroUsd,
  type ComparisonSide,
  type ComparisonSummary,
  type ComparisonView,
  type RenderView,
  type VideoSize,
} from "@ai-director/contract";

/**
 * Video comparisons, on disk.
 *
 * ── Why the same shape as `FileAvatarStore` ─────────────────────────────────────────
 * Same reason, and it is a stronger one here. A rendered clip is a paid artefact that took
 * minutes to produce; a clip that lived only in a response body is one a reload destroys,
 * and a vanished clip looks exactly like a render that never happened. Everything is
 * written before the route replies.
 *
 * ── The claim file, and why it is never deleted ─────────────────────────────────────
 * `render-ugc.ts` in Mentic stamps `submitAttemptedAt` as a compare-and-swap before
 * calling the vendor, so two concurrent ticks cannot both submit. There is no database
 * here. `writeFile(..., { flag: "wx" })` fails with EEXIST when the file already exists,
 * and that check-and-create is one atomic filesystem operation — the same guarantee, from
 * the tool this repo has.
 *
 * The file is never removed. A claim that can be released is not a claim: the point is
 * that a second attempt finds evidence of the first, including after the process that made
 * the first attempt died mid-submit. A held claim with no task id beside it is exactly the
 * UNKNOWN outcome that must never be resubmitted.
 *
 * ── No ledger ───────────────────────────────────────────────────────────────────────
 * The estimate and the bill sit on the row and nowhere else. This repo has no billing
 * ledger and `avatar/generateSheet.ts` already says why half of one would be worse than
 * none.
 */

const ROW_FILE = "row.json";

/** Whether this caller is the one allowed to submit. */
export type ClaimResult = "claimed" | "already_claimed";

/** What each side needs before it has been submitted. */
export type ComparisonSource = {
  description: string;
  descriptionSha256: string;
};

export type CreateComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  model: string;
  shotPromptVersion: string;
  rubricVersion: string;
  /** Null when the run manifest records none. Never guessed. */
  repairerPromptVersion: string | null;
  /** Per clip, not per pair. */
  estimatedMicroUsd: number;
  sources: Record<ComparisonSide, ComparisonSource>;
};

/** The fields a poll or a settle may change. Deliberately narrow: nothing may rewrite a
 *  description, a hash, an estimate or a provenance field after the row is created. */
export type RenderPatch = Partial<
  Pick<
    RenderView,
    "status" | "failureCode" | "failure" | "actualMicroUsd" | "clipUrl" | "finishedAt" | "polls"
  >
>;

export interface ComparisonStore {
  create(args: CreateComparisonArgs): Promise<ComparisonView>;
  /** Atomic. `"claimed"` exactly once per (comparison, side), for all time. */
  claimSubmit(comparisonId: string, side: ComparisonSide): Promise<ClaimResult>;
  /** Called the instant a submit returns, before anything waits on the task. */
  stampTaskId(comparisonId: string, side: ComparisonSide, taskId: string): Promise<void>;
  patchRender(
    comparisonId: string,
    side: ComparisonSide,
    patch: RenderPatch,
  ): Promise<ComparisonView>;
  get(comparisonId: string): Promise<ComparisonView | null>;
  list(): Promise<ComparisonSummary[]>;
  writeClip(
    comparisonId: string,
    side: ComparisonSide,
    bytes: Buffer,
    mediaType: string,
  ): Promise<void>;
  readClip(
    comparisonId: string,
    side: ComparisonSide,
  ): Promise<{ bytes: Buffer; mediaType: string } | null>;
}

function emptyRender(
  side: ComparisonSide,
  args: CreateComparisonArgs,
  source: ComparisonSource,
): RenderView {
  return {
    side,
    status: "queued",
    taskId: null,
    submittedAt: null,
    finishedAt: null,
    failureCode: null,
    failure: null,
    estimatedMicroUsd: args.estimatedMicroUsd,
    actualMicroUsd: null,
    clipUrl: null,
    description: source.description,
    descriptionSha256: source.descriptionSha256,
    rubricVersion: args.rubricVersion,
    repairerPromptVersion: args.repairerPromptVersion,
    polls: 0,
  };
}

/** The media type is stored beside the bytes rather than guessed from an extension, so a
 *  vendor that one day answers webm does not silently produce an unplayable `.mp4`. */
type ClipMeta = { mediaType: string; file: string };

export class FileComparisonStore implements ComparisonStore {
  constructor(private readonly root: string) {}

  private dir(comparisonId: string): string {
    return path.join(this.root, comparisonId);
  }

  private async write(row: ComparisonView): Promise<void> {
    await writeFile(
      path.join(this.dir(row.comparisonId), ROW_FILE),
      JSON.stringify(row, null, 2),
      "utf8",
    );
  }

  private async require(comparisonId: string): Promise<ComparisonView> {
    const row = await this.get(comparisonId);
    if (!row) throw new Error(`comparison ${comparisonId} not found`);
    return row;
  }

  async create(args: CreateComparisonArgs): Promise<ComparisonView> {
    const comparisonId = randomUUID();
    const row: ComparisonView = {
      comparisonId,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      avatarId: args.avatarId,
      runId: args.runId,
      seconds: args.seconds,
      size: args.size,
      model: args.model,
      shotPromptVersion: args.shotPromptVersion,
      before: emptyRender("before", args, args.sources.before),
      after: emptyRender("after", args, args.sources.after),
    };
    await mkdir(this.dir(comparisonId), { recursive: true });
    await this.write(row);
    return row;
  }

  async claimSubmit(comparisonId: string, side: ComparisonSide): Promise<ClaimResult> {
    const claim = path.join(this.dir(comparisonId), `${side}.claim`);
    try {
      // "wx" is the whole mechanism: create-if-absent, atomically, or EEXIST.
      await writeFile(claim, new Date().toISOString(), { flag: "wx" });
      return "claimed";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return "already_claimed";
      throw err;
    }
  }

  async stampTaskId(comparisonId: string, side: ComparisonSide, taskId: string): Promise<void> {
    const row = await this.require(comparisonId);
    await this.write({
      ...row,
      [side]: { ...row[side], taskId, submittedAt: new Date().toISOString() },
    } as ComparisonView);
  }

  async patchRender(
    comparisonId: string,
    side: ComparisonSide,
    patch: RenderPatch,
  ): Promise<ComparisonView> {
    const row = await this.require(comparisonId);
    const merged = { ...row, [side]: { ...row[side], ...patch } } as ComparisonView;
    // The comparison finishes when both of its renders have, and not before. A pair with
    // one clip still running is not a finished comparison however good the other one is.
    const bothDone = isRenderTerminal(merged.before.status) && isRenderTerminal(merged.after.status);
    merged.finishedAt = bothDone ? (merged.finishedAt ?? new Date().toISOString()) : null;
    await this.write(merged);
    return merged;
  }

  async get(comparisonId: string): Promise<ComparisonView | null> {
    try {
      const raw = await readFile(path.join(this.dir(comparisonId), ROW_FILE), "utf8");
      return JSON.parse(raw) as ComparisonView;
    } catch {
      return null;
    }
  }

  async list(): Promise<ComparisonSummary[]> {
    let entries: string[];
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // The store was never written to. Empty, not an error.
      return [];
    }
    const rows = await Promise.all(entries.map((id) => this.get(id)));
    return rows
      .filter((row): row is ComparisonView => row !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({
        comparisonId: row.comparisonId,
        createdAt: row.createdAt,
        avatarId: row.avatarId,
        runId: row.runId,
        seconds: row.seconds,
        size: row.size,
        beforeStatus: row.before.status,
        afterStatus: row.after.status,
        estimatedMicroUsd: row.before.estimatedMicroUsd + row.after.estimatedMicroUsd,
        actualMicroUsd: pairActualMicroUsd(row.before.actualMicroUsd, row.after.actualMicroUsd),
      }));
  }

  private clipMetaPath(comparisonId: string, side: ComparisonSide): string {
    return path.join(this.dir(comparisonId), `${side}.clip.json`);
  }

  async writeClip(
    comparisonId: string,
    side: ComparisonSide,
    bytes: Buffer,
    mediaType: string,
  ): Promise<void> {
    const file = `${side}.${mediaType === "video/webm" ? "webm" : "mp4"}`;
    // The bytes first. Metadata pointing at a file that is not there is a lie about what
    // was rendered; bytes with no metadata are recoverable by hand.
    await writeFile(path.join(this.dir(comparisonId), file), bytes);
    const meta: ClipMeta = { mediaType, file };
    await writeFile(this.clipMetaPath(comparisonId, side), JSON.stringify(meta), "utf8");
  }

  async readClip(
    comparisonId: string,
    side: ComparisonSide,
  ): Promise<{ bytes: Buffer; mediaType: string } | null> {
    try {
      const meta = JSON.parse(
        await readFile(this.clipMetaPath(comparisonId, side), "utf8"),
      ) as ClipMeta;
      const bytes = await readFile(path.join(this.dir(comparisonId), meta.file));
      return { bytes, mediaType: meta.mediaType };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/store/ComparisonStore.test.ts`
Expected: PASS, every case including the eight-way concurrent claim.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/store/ComparisonStore.ts apps/backend/tests/store/ComparisonStore.test.ts
git commit -m "feat(video): file-backed comparison store, with an atomic submit claim per side

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reading the two descriptions off a stored run

**Files:**
- Create: `apps/backend/src/compare/readSources.ts`
- Test: `apps/backend/tests/compare/readSources.test.ts`

**Interfaces:**
- Consumes: `RunStore` and `RunManifest` from `apps/backend/src/store/RunStore.ts`, `AvatarStore` from `apps/backend/src/store/AvatarStore.ts`, `rebuildRunView` from `apps/backend/src/present/rebuildRunView.ts`, `ComparisonSource` from Task 4.
- Produces, from `apps/backend/src/compare/readSources.ts`:
  - `sha256(text: string): string`
  - `readComparisonSources(deps: { runStore: RunStore; avatarStore: AvatarStore }, args: { runId: string; avatarId: string }): Promise<ComparisonSourcesResult>`
  - `type ComparisonSourcesResult = { ok: true; sources: Record<ComparisonSide, ComparisonSource>; rubricVersion: string; repairerPromptVersion: string | null } | { ok: false; reason: string }`

**Where each side comes from.** `rebuildRunView(manifest, storedPasses)` already returns `originalDescription` and `finalDescription`, derived the same way the live path derives them. Use it. Deriving "the last pass's repair, or its evaluation when it did not repair" a second time in this file is exactly the drift `rebuildRunView`'s own header warns about.

**Why the avatar is checked against the run.** The avatar's sheet is shown beside the two clips as the reference of what the person is supposed to look like, and the comparison is worthless if the run being rendered came from a different avatar. The run store records no avatar id, so the link is established by the only fact that ties them: the run's original description is exactly what `describeImage` wrote onto the avatar record. If they differ, refuse, because a silently mismatched pair would look like a successful comparison.

**A run must have something to compare.** A run whose repaired text is identical to its original — a run that passed on pass 1 — has no "after". Rendering it would spend $0.82 on two identical prompts. Refuse, and say so.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/compare/readSources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readComparisonSources, sha256 } from "../../src/compare/readSources.js";
import type { AvatarRecord, AvatarStore } from "../../src/store/AvatarStore.js";
import type { RunManifest, RunStore, StoredPass } from "../../src/store/RunStore.js";

const ORIGINAL = "A young man with wavy brown hair.";
const REPAIRED = "A young man with chestnut-brown wavy hair, shoulder-length, parted on the left.";

const MANIFEST: RunManifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "improved_still_failing",
  startedAt: "2026-09-12T13:38:30.943Z",
  finishedAt: "2026-09-12T13:39:08.735Z",
  passes: 2,
};

function evaluation(description: string) {
  return {
    description,
    results: [],
    failing: [],
    notEvaluated: [],
    spans: [],
    unverified: [],
    negativeConstraintPresent: true,
  };
}

const PASSES: StoredPass[] = [
  {
    pass: 1,
    evaluation: evaluation(ORIGINAL),
    repair: { from: ORIGINAL, to: REPAIRED, rejected: [] },
  },
  { pass: 2, evaluation: evaluation(REPAIRED) },
];

function stubRunStore(overrides: Partial<RunStore> = {}): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async () => MANIFEST,
    listRuns: async () => [MANIFEST],
    readPasses: async () => PASSES,
    ...overrides,
  };
}

function stubAvatarStore(record: AvatarRecord | null): AvatarStore {
  return {
    save: async () => {
      throw new Error("not used");
    },
    attachDescription: async () => {
      throw new Error("not used");
    },
    list: async () => (record ? [record] : []),
    get: async () => record,
    readImage: async () => null,
  };
}

const AVATAR: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-09-12T13:23:27.890Z",
  source: "generated",
  mediaType: "image/jpeg",
  description: ORIGINAL,
};

describe("sha256", () => {
  it("is 64 lowercase hex characters and differs for different text", () => {
    expect(sha256(ORIGINAL)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(ORIGINAL)).not.toBe(sha256(REPAIRED));
    expect(sha256(ORIGINAL)).toBe(sha256(ORIGINAL));
  });
});

describe("readComparisonSources", () => {
  it("takes before from pass 1 and after from the repaired final text", async () => {
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(AVATAR) },
      { runId: "run-1", avatarId: "avatar-1" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources.before.description).toBe(ORIGINAL);
    expect(result.sources.after.description).toBe(REPAIRED);
    expect(result.sources.before.descriptionSha256).toBe(sha256(ORIGINAL));
    expect(result.sources.after.descriptionSha256).toBe(sha256(REPAIRED));
  });

  it("carries the rubric version off the manifest and a null repairer version", async () => {
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(AVATAR) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rubricVersion).toBe("v1");
    // The manifest has no such field yet. Null means "this run predates the record",
    // which is not the same claim as "v1".
    expect(result.repairerPromptVersion).toBeNull();
  });

  it("reads the repairer prompt version when a manifest records one", async () => {
    const withVersion = { ...MANIFEST, repairerPromptVersion: "v2" } as RunManifest;
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ getRun: async () => withVersion }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repairerPromptVersion).toBe("v2");
  });

  it("refuses a run whose description is not the avatar's", async () => {
    const other = { ...AVATAR, description: "Somebody else entirely." };
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(other) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/avatar/i) });
  });

  it("refuses an avatar with no description read off it yet", async () => {
    const undescribed = { ...AVATAR, description: undefined };
    const result = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(undescribed) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/description/i) });
  });

  it("refuses a run whose text never changed, rather than rendering the same prompt twice", async () => {
    const unrepaired: StoredPass[] = [{ pass: 1, evaluation: evaluation(ORIGINAL) }];
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ readPasses: async () => unrepaired }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/identical|unchanged/i) });
  });

  it("refuses a run with no passes on disk", async () => {
    const result = await readComparisonSources(
      {
        runStore: stubRunStore({ readPasses: async () => [] }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/pass/i) });
  });

  it("refuses a missing avatar and a missing run by name", async () => {
    const noAvatar = await readComparisonSources(
      { runStore: stubRunStore(), avatarStore: stubAvatarStore(null) },
      { runId: "run-1", avatarId: "avatar-1" },
    );
    expect(noAvatar).toEqual({ ok: false, reason: expect.stringContaining("avatar-1") });

    const noRun = await readComparisonSources(
      {
        runStore: stubRunStore({
          getRun: async () => {
            throw new Error("run missing-run not found");
          },
        }),
        avatarStore: stubAvatarStore(AVATAR),
      },
      { runId: "missing-run", avatarId: "avatar-1" },
    );
    expect(noRun).toEqual({ ok: false, reason: expect.stringContaining("missing-run") });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/compare/readSources.test.ts`
Expected: FAIL — cannot resolve `../../src/compare/readSources.js`.

- [ ] **Step 3: Write `apps/backend/src/compare/readSources.ts`**

```ts
import { createHash } from "node:crypto";
import type { ComparisonSide } from "@ai-director/contract";
import { rebuildRunView } from "../present/rebuildRunView.js";
import type { AvatarStore } from "../store/AvatarStore.js";
import type { ComparisonSource } from "../store/ComparisonStore.js";
import type { RunStore } from "../store/RunStore.js";

/**
 * Where the two descriptions come from, and what has to be true before either is rendered.
 *
 * ── Why this goes through `rebuildRunView` ──────────────────────────────────────────
 * "The original text" and "the text as it finished" are already derived there, the same
 * way the live path derives them, and that file's own header explains why a second
 * assembler is worse than none: two derivations drift, and a comparison built on a
 * drifted "after" is a measurement of the drift.
 *
 * ── Why the avatar is checked against the run ───────────────────────────────────────
 * The avatar's sheet is shown beside the two clips as the reference of what the person is
 * meant to look like. If the run came from a different avatar the whole screen is a lie,
 * and nothing about it would look wrong. The run store records no avatar id, so the link
 * is the one fact that ties them: the run's original description is exactly what the
 * describe step wrote onto the avatar record.
 *
 * ── Why an unrepaired run is refused ────────────────────────────────────────────────
 * A run that passed on pass 1 has no "after". Rendering it would spend about $0.82 on two
 * identical prompts and produce two clips whose only difference is the seed.
 */

/** The discriminator that works with no version record at all: two descriptions produced
 *  by two prompt versions hash differently, and the full text is stored beside the hash. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type ComparisonSourcesResult =
  | {
      ok: true;
      sources: Record<ComparisonSide, ComparisonSource>;
      rubricVersion: string;
      repairerPromptVersion: string | null;
    }
  | { ok: false; reason: string };

export type ReadSourcesDeps = {
  runStore: RunStore;
  avatarStore: AvatarStore;
};

export async function readComparisonSources(
  deps: ReadSourcesDeps,
  args: { runId: string; avatarId: string },
): Promise<ComparisonSourcesResult> {
  const avatar = await deps.avatarStore.get(args.avatarId);
  if (!avatar) return { ok: false, reason: `avatar "${args.avatarId}" not found` };
  if (!avatar.description) {
    return {
      ok: false,
      reason: `avatar "${args.avatarId}" has no description read off it yet`,
    };
  }

  let manifest;
  try {
    manifest = await deps.runStore.getRun(args.runId);
  } catch {
    return { ok: false, reason: `run "${args.runId}" not found` };
  }

  const passes = await deps.runStore.readPasses(args.runId);
  if (passes.length === 0) {
    return { ok: false, reason: `run "${args.runId}" has no completed pass on disk` };
  }

  const view = rebuildRunView(manifest, passes);

  if (view.originalDescription !== avatar.description) {
    return {
      ok: false,
      reason: `run "${args.runId}" did not come from avatar "${args.avatarId}": its original description is not the one stored on that avatar`,
    };
  }

  if (view.finalDescription === view.originalDescription) {
    return {
      ok: false,
      reason: `run "${args.runId}" repaired nothing, so its before and after are identical and rendering both would pay twice for one clip`,
    };
  }

  // Off the manifest when it records one, else null. The field does not exist on
  // `RunManifest` yet — it lands with the Repairer prompt v2 work — so this reads it
  // defensively rather than asserting. Null is a real answer: "this run predates the
  // record", which is a different claim from "v1".
  const recorded = (manifest as { repairerPromptVersion?: unknown }).repairerPromptVersion;
  const repairerPromptVersion = typeof recorded === "string" ? recorded : null;

  return {
    ok: true,
    sources: {
      before: {
        description: view.originalDescription,
        descriptionSha256: sha256(view.originalDescription),
      },
      after: {
        description: view.finalDescription,
        descriptionSha256: sha256(view.finalDescription),
      },
    },
    rubricVersion: manifest.rubricVersion,
    repairerPromptVersion,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/compare/readSources.test.ts`
Expected: PASS, every case.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/compare/readSources.ts apps/backend/tests/compare/readSources.test.ts
git commit -m "feat(video): read a run's before and after, and refuse a pair that would not compare

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `runComparison` — claim, submit, stamp, poll, download

**Files:**
- Create: `apps/backend/src/compare/runComparison.ts`
- Test: `apps/backend/tests/compare/runComparison.test.ts`

**Interfaces:**
- Consumes: `ComparisonStore` (Task 4), `VideoTransport` (Task 3), `buildShotPrompt` and `SHOT_PROMPT_VERSION` (Task 2), `estimateMicroUsd`, `SEEDANCE_MODEL`, `isRenderTerminal` (Task 1).
- Produces, from `apps/backend/src/compare/runComparison.ts`:
  - `POLL_INTERVAL_MS = 5_000`, `POLL_DEADLINE_MS = 900_000`
  - `startComparison(deps, args): Promise<ComparisonView>` — creates the row and returns it immediately
  - `driveComparison(deps, comparisonId): Promise<ComparisonView>` — submits both sides, polls both to terminal, downloads the clips
  - `refreshComparison(deps, comparisonId): Promise<ComparisonView>` — one status read per non-terminal side, for a row the process lost
  - `type RunComparisonDeps = { store: ComparisonStore; transport: VideoTransport; sleep?: (ms: number) => Promise<void>; now?: () => number }`

**The order of operations is the whole task.** For each side, in this exact order:

1. `claimSubmit`. If `"already_claimed"` and the row has no `taskId`, settle that side `failed` with `OPENROUTER_UNKNOWN_OUTCOME` and **return without calling the vendor**. If it already has a `taskId`, it is in flight and gets polled, not resubmitted.
2. `transport.submit(...)`.
3. `store.stampTaskId(...)` — before anything waits on it.
4. Poll to terminal.
5. On `succeeded`, `transport.fetchClip` and `store.writeClip`, then patch `clipUrl`.

**Both sides submit before either is polled.** They are one comparison and they must queue at the vendor at the same time; submitting the second only after the first finished would confound the comparison with whatever changed at OpenRouter in between. `Promise.allSettled`, not `Promise.all`: one side failing must not abandon the other, which has already been paid for.

**Time is injected.** `sleep` and `now` are dependencies with real defaults, so the tests exercise the deadline in microseconds rather than fifteen minutes.

**On deadline: `failed`, keep the task id.** The clip may still complete and still bill. `refreshComparison` re-reads it. Nothing deletes a claim and nothing resubmits.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/compare/runComparison.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  driveComparison,
  refreshComparison,
  startComparison,
} from "../../src/compare/runComparison.js";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";
import type { VideoTaskResult, VideoTransport } from "../../src/video/openrouterClient.js";
import { OpenRouterHttpError } from "../../src/video/openrouterClient.js";

const START = {
  avatarId: "avatar-1",
  runId: "run-1",
  seconds: 4,
  size: "480x854",
  rubricVersion: "v1",
  repairerPromptVersion: null,
  sources: {
    before: { description: "The raw description.", descriptionSha256: "a".repeat(64) },
    after: { description: "The repaired description.", descriptionSha256: "b".repeat(64) },
  },
} as const;

function terminal(taskId: string, over: Partial<VideoTaskResult> = {}): VideoTaskResult {
  return {
    taskId,
    status: "succeeded",
    failureCode: null,
    failure: null,
    actualMicroUsd: 410_000,
    ...over,
  };
}

function fakeTransport(over: Partial<VideoTransport> = {}): VideoTransport {
  let submitted = 0;
  return {
    submit: vi.fn(async () => ({ taskId: `task-${++submitted}` })),
    check: vi.fn(async (taskId: string) => terminal(taskId)),
    fetchClip: vi.fn(async () => ({ bytes: Buffer.from([1, 2]), mediaType: "video/mp4" })),
    ...over,
  };
}

async function withStore<T>(fn: (store: FileComparisonStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "compare-run-"));
  try {
    return await fn(new FileComparisonStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const NO_SLEEP = async () => {};

describe("startComparison", () => {
  it("creates the row with the derived estimate and the shot prompt version, and calls nothing", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);

      expect(row.before.estimatedMicroUsd).toBe(411_201);
      expect(row.after.estimatedMicroUsd).toBe(411_201);
      expect(row.model).toBe("bytedance/seedance-2.5");
      expect(row.shotPromptVersion).toBe("v1");
      expect(transport.submit).not.toHaveBeenCalled();
    });
  });
});

describe("driveComparison", () => {
  it("submits both sides with the same wrapper, the same size and the same seconds", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      const calls = (transport.submit as ReturnType<typeof vi.fn>).mock.calls.map(
        ([req]) => req as Record<string, unknown>,
      );
      expect(calls).toHaveLength(2);
      expect(calls[0]?.size).toBe("480x854");
      expect(calls[0]?.duration).toBe(4);
      expect(calls[0]?.generate_audio).toBe(false);
      expect(calls[0]?.model).toBe("bytedance/seedance-2.5");
      expect(calls[0]?.size).toBe(calls[1]?.size);
      expect(calls[0]?.duration).toBe(calls[1]?.duration);

      // The ONLY difference between the two prompts is the description.
      const a = String(calls[0]?.prompt).replace("The raw description.", "");
      const b = String(calls[1]?.prompt).replace("The repaired description.", "");
      expect(a).toBe(b);
      expect(String(calls[0]?.prompt)).toContain("The raw description.");
      expect(String(calls[1]?.prompt)).toContain("The repaired description.");
    });
  });

  it("never sends an image reference", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      for (const [req] of (transport.submit as ReturnType<typeof vi.fn>).mock.calls) {
        expect(JSON.stringify(req)).not.toContain("input_references");
        expect(JSON.stringify(req)).not.toContain("frame_images");
      }
    });
  });

  it("stamps the task id before the first status read", async () => {
    await withStore(async (store) => {
      const seen: Array<string | null> = [];
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => {
          const row = await store.get(rowId);
          seen.push(row?.before.taskId ?? null);
          return terminal(taskId);
        }),
      });
      const created = await startComparison({ store, transport }, START);
      const rowId = created.comparisonId;
      await driveComparison({ store, transport, sleep: NO_SLEEP }, rowId);

      // Not one status read happened before the id was on disk.
      expect(seen.every((id) => id !== null)).toBe(true);
    });
  });

  it("stores the clip bytes and points the row at this server's own path", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("succeeded");
      expect(done.before.clipUrl).toBe(`/compare/${row.comparisonId}/before/clip`);
      expect(done.after.clipUrl).toBe(`/compare/${row.comparisonId}/after/clip`);
      expect(done.before.clipUrl).not.toContain("openrouter.ai");
      expect((await store.readClip(row.comparisonId, "before"))?.mediaType).toBe("video/mp4");
    });
  });

  it("records the vendor's bill without touching the estimate", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => terminal(taskId, { actualMicroUsd: 398_500 })),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.actualMicroUsd).toBe(398_500);
      expect(done.before.estimatedMicroUsd).toBe(411_201);
    });
  });

  it("leaves actualMicroUsd null when the terminal task reported no cost, never zero", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) => terminal(taskId, { actualMicroUsd: null })),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);
      expect(done.before.actualMicroUsd).toBeNull();
    });
  });

  it("counts polls, so the screen can show progress without a spinner", async () => {
    await withStore(async (store) => {
      let reads = 0;
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          ++reads < 6
            ? terminal(taskId, { status: "running", actualMicroUsd: null })
            : terminal(taskId),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);
      expect(done.before.polls).toBeGreaterThan(1);
      expect(done.after.polls).toBeGreaterThan(1);
    });
  });

  it("finishes the losing side even when the other side's submit throws", async () => {
    await withStore(async (store) => {
      let calls = 0;
      const transport = fakeTransport({
        submit: vi.fn(async () => {
          if (++calls === 1) throw new OpenRouterHttpError("size not supported", 400);
          return { taskId: "task-2" };
        }),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("failed");
      expect(done.before.failure).toContain("size not supported");
      expect(done.after.status).toBe("succeeded");
      expect(done.finishedAt).toEqual(expect.any(String));
    });
  });

  it("NEVER resubmits a side whose claim is held with no task id", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);

      // Simulate a process that died between claiming and stamping.
      await store.claimSubmit(row.comparisonId, "before");

      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("failed");
      expect(done.before.failureCode).toBe("OPENROUTER_UNKNOWN_OUTCOME");
      expect(done.before.failure).toMatch(/unknown|resubmit/i);
      expect((transport.submit as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  it("settles a side failed on the deadline but keeps its task id", async () => {
    await withStore(async (store) => {
      let clock = 0;
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          terminal(taskId, { status: "running", actualMicroUsd: null }),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison(
        {
          store,
          transport,
          sleep: async () => {
            clock += 60_000;
          },
          now: () => clock,
        },
        row.comparisonId,
      );

      expect(done.before.status).toBe("failed");
      expect(done.before.failureCode).toBe("OPENROUTER_POLL_TIMEOUT");
      expect(done.before.taskId).toBe("task-1");
    });
  });

  it("does not treat a cancelled clip as a success", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        check: vi.fn(async (taskId: string) =>
          terminal(taskId, { status: "cancelled", actualMicroUsd: null }),
        ),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      expect(done.before.status).toBe("cancelled");
      expect(done.before.clipUrl).toBeNull();
      expect(transport.fetchClip).not.toHaveBeenCalled();
    });
  });

  it("keeps the render succeeded when the clip download fails, and says the clip is missing", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport({
        fetchClip: vi.fn(async () => {
          throw new OpenRouterHttpError("gone", 404);
        }),
      });
      const row = await startComparison({ store, transport }, START);
      const done = await driveComparison({ store, transport, sleep: NO_SLEEP }, row.comparisonId);

      // The render happened and was billed. Calling it failed would misreport the bill.
      expect(done.before.status).toBe("succeeded");
      expect(done.before.clipUrl).toBeNull();
      expect(done.before.failureCode).toBe("CLIP_DOWNLOAD_FAILED");
    });
  });
});

describe("refreshComparison", () => {
  it("takes one status read per unfinished side and leaves finished ones alone", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await store.stampTaskId(row.comparisonId, "before", "task-1");
      await store.patchRender(row.comparisonId, "after", {
        status: "succeeded",
        actualMicroUsd: 410_000,
      });

      const done = await refreshComparison({ store, transport }, row.comparisonId);

      expect((transport.check as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
      expect(done.before.status).toBe("succeeded");
    });
  });

  it("never submits, even for a side that was never claimed", async () => {
    await withStore(async (store) => {
      const transport = fakeTransport();
      const row = await startComparison({ store, transport }, START);
      await refreshComparison({ store, transport }, row.comparisonId);
      expect(transport.submit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/compare/runComparison.test.ts`
Expected: FAIL — cannot resolve `../../src/compare/runComparison.js`.

- [ ] **Step 3: Write `apps/backend/src/compare/runComparison.ts`**

```ts
import {
  estimateMicroUsd,
  isRenderTerminal,
  SEEDANCE_MODEL,
  type ComparisonSide,
  type ComparisonView,
  type VideoSize,
} from "@ai-director/contract";
import type {
  ComparisonSource,
  ComparisonStore,
  RenderPatch,
} from "../store/ComparisonStore.js";
import { buildShotPrompt, SHOT_PROMPT_VERSION } from "../video/shotPrompt/v1.js";
import type { VideoTransport } from "../video/openrouterClient.js";

/**
 * One comparison, driven to two clips.
 *
 * ── The claim discipline, ported from `render-ugc.ts` ───────────────────────────────
 * Verbatim in shape, per side:
 *   1. The submit claim is taken as a compare-and-swap BEFORE the vendor is called, so two
 *      concurrent ticks cannot both submit.
 *   2. If the claim is held and `taskId` is still null, the previous attempt's outcome is
 *      UNKNOWN. OpenRouter has no endpoint that lists tasks by anything we hold, so that id
 *      is unrecoverable. NEVER resubmit: settle failed and say why.
 *   3. The task id is stamped BEFORE anything waits on it. A lost id is a paid render
 *      nobody can find.
 *
 * ── Why both sides submit before either is polled ───────────────────────────────────
 * They are one comparison. Submitting the second only after the first finished would put
 * minutes between them and confound the result with whatever changed at OpenRouter in
 * between — a queue, a region, a silent model update. `allSettled`, not `all`: one side
 * failing must not abandon the other, which has already been paid for.
 *
 * ── Why time is injected ────────────────────────────────────────────────────────────
 * So the deadline is exercised in microseconds rather than fifteen minutes. Both have real
 * defaults; no caller in production passes either.
 */

/** Between status reads. Seedance takes one to three minutes at these sizes, so a tighter
 *  interval buys nothing but requests. */
export const POLL_INTERVAL_MS = 5_000;

/** Fifteen minutes, then the side settles failed WITH ITS TASK ID KEPT — the clip may
 *  still complete and still bill, and `refreshComparison` is how it is picked up. Nothing
 *  here resubmits and nothing deletes a claim. */
export const POLL_DEADLINE_MS = 900_000;

export type RunComparisonDeps = {
  store: ComparisonStore;
  transport: VideoTransport;
  /** Defaults to a real timer. Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Defaults to `Date.now`. */
  now?: () => number;
};

export type StartComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
  rubricVersion: string;
  repairerPromptVersion: string | null;
  sources: Record<ComparisonSide, ComparisonSource>;
};

const SIDES: readonly ComparisonSide[] = ["before", "after"];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** This server's own path for a stored clip. Never OpenRouter's content URL, which is
 *  ephemeral and needs a bearer token the browser must never hold. */
function clipPath(comparisonId: string, side: ComparisonSide): string {
  return `/compare/${comparisonId}/${side}/clip`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Creates the row and returns immediately. Spends nothing: the estimate is derived from
 * the published rate and the vendor is not called.
 */
export async function startComparison(
  deps: RunComparisonDeps,
  args: StartComparisonArgs,
): Promise<ComparisonView> {
  return deps.store.create({
    avatarId: args.avatarId,
    runId: args.runId,
    seconds: args.seconds,
    size: args.size,
    model: SEEDANCE_MODEL,
    shotPromptVersion: SHOT_PROMPT_VERSION,
    rubricVersion: args.rubricVersion,
    repairerPromptVersion: args.repairerPromptVersion,
    estimatedMicroUsd: estimateMicroUsd(args.size, args.seconds),
    sources: args.sources,
  });
}

/**
 * Submits one side, or explains why it will not.
 *
 * Returns the task id to poll, or `null` when this side is already settled.
 */
async function submitSide(
  deps: RunComparisonDeps,
  row: ComparisonView,
  side: ComparisonSide,
): Promise<string | null> {
  const render = row[side];

  // Already in flight from an earlier attempt: poll it, never submit it again.
  if (render.taskId !== null) return render.taskId;

  const claim = await deps.store.claimSubmit(row.comparisonId, side);
  if (claim === "already_claimed") {
    // The claim is held and no id was ever stamped, so a previous attempt reached the
    // point of calling OpenRouter and we do not know what happened. There is no endpoint
    // that can tell us. Resubmitting would risk paying twice for one clip with nobody ever
    // finding out, so this settles rather than retries.
    await deps.store.patchRender(row.comparisonId, side, {
      status: "failed",
      failureCode: "OPENROUTER_UNKNOWN_OUTCOME",
      failure:
        "a previous attempt claimed this submit and never recorded a task id, so its outcome is unknown and it must not be resubmitted",
      finishedAt: new Date().toISOString(),
    });
    return null;
  }

  try {
    const { taskId } = await deps.transport.submit({
      model: row.model,
      prompt: buildShotPrompt(render.description),
      duration: row.seconds,
      size: row.size,
      generate_audio: false,
    });
    // Before anything waits on it.
    await deps.store.stampTaskId(row.comparisonId, side, taskId);
    await deps.store.patchRender(row.comparisonId, side, { status: "running" });
    return taskId;
  } catch (err) {
    await deps.store.patchRender(row.comparisonId, side, {
      status: "failed",
      failureCode: "OPENROUTER_SUBMIT_FAILED",
      failure: errorMessage(err),
      finishedAt: new Date().toISOString(),
    });
    return null;
  }
}

/** Writes one status read onto the row. Returns whether the side is now terminal. */
async function applyCheck(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
  polls: number,
): Promise<boolean> {
  const row = await deps.store.get(comparisonId);
  const taskId = row?.[side].taskId;
  if (!row || !taskId) return true;

  let patch: RenderPatch;
  try {
    const result = await deps.transport.check(taskId);
    patch = {
      status: result.status,
      failureCode: result.failureCode,
      failure: result.failure,
      actualMicroUsd: result.actualMicroUsd,
      polls,
      ...(isRenderTerminal(result.status) ? { finishedAt: new Date().toISOString() } : {}),
    };
  } catch (err) {
    // A status read that throws is not a settled render — the work may well be running.
    // Count the poll, record nothing else, and let the deadline decide.
    await deps.store.patchRender(comparisonId, side, { polls });
    return false;
  }

  const next = await deps.store.patchRender(comparisonId, side, patch);
  return isRenderTerminal(next[side].status);
}

/** Downloads a succeeded clip and points the row at this server's own path. */
async function storeClip(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
): Promise<void> {
  const row = await deps.store.get(comparisonId);
  const taskId = row?.[side].taskId;
  if (!row || !taskId || row[side].status !== "succeeded") return;

  try {
    const clip = await deps.transport.fetchClip(taskId);
    await deps.store.writeClip(comparisonId, side, clip.bytes, clip.mediaType);
    await deps.store.patchRender(comparisonId, side, {
      clipUrl: clipPath(comparisonId, side),
    });
  } catch (err) {
    // The render HAPPENED and was billed. Marking it failed would misreport the money and
    // hide a real, separate problem: the clip could not be fetched. Both facts are kept.
    await deps.store.patchRender(comparisonId, side, {
      failureCode: "CLIP_DOWNLOAD_FAILED",
      failure: `the render succeeded and was billed, but its clip could not be downloaded: ${errorMessage(err)}`,
    });
  }
}

async function driveSide(
  deps: RunComparisonDeps,
  comparisonId: string,
  side: ComparisonSide,
): Promise<void> {
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);
  if (isRenderTerminal(row[side].status)) return;

  const taskId = await submitSide(deps, row, side);
  if (taskId === null) return;

  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let polls = 0;

  for (;;) {
    polls += 1;
    if (await applyCheck(deps, comparisonId, side, polls)) break;

    if (now() - startedAt >= POLL_DEADLINE_MS) {
      // Failed, but the task id STAYS. The clip may still complete and still bill, and a
      // row with no id is a paid render nobody can find.
      await deps.store.patchRender(comparisonId, side, {
        status: "failed",
        failureCode: "OPENROUTER_POLL_TIMEOUT",
        failure: `still unfinished after ${Math.round(POLL_DEADLINE_MS / 1000)}s of polling; the task id is kept, so this can be re-read later`,
        finishedAt: new Date().toISOString(),
        polls,
      });
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await storeClip(deps, comparisonId, side);
}

/**
 * Both sides, all the way. Takes minutes; callers do not await it on a request path.
 */
export async function driveComparison(
  deps: RunComparisonDeps,
  comparisonId: string,
): Promise<ComparisonView> {
  // allSettled, deliberately: one side failing must not abandon the other, which has
  // already been submitted and will be billed whether or not anyone is watching it.
  await Promise.allSettled(SIDES.map((side) => driveSide(deps, comparisonId, side)));
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);
  return row;
}

/**
 * ONE status read per unfinished side, for a row this process lost — a restart under `tsx
 * watch`, a laptop closing, a poll deadline that expired while the clip was still queued.
 * Never submits, whatever state the row is in.
 */
export async function refreshComparison(
  deps: RunComparisonDeps,
  comparisonId: string,
): Promise<ComparisonView> {
  const row = await deps.store.get(comparisonId);
  if (!row) throw new Error(`comparison ${comparisonId} not found`);

  await Promise.allSettled(
    SIDES.filter((side) => row[side].taskId !== null).map(async (side) => {
      if (isRenderTerminal(row[side].status) && row[side].clipUrl !== null) return;
      await applyCheck(deps, comparisonId, side, row[side].polls + 1);
      await storeClip(deps, comparisonId, side);
    }),
  );

  const next = await deps.store.get(comparisonId);
  if (!next) throw new Error(`comparison ${comparisonId} not found`);
  return next;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/compare/runComparison.test.ts`
Expected: PASS, every case. The two that matter most are "NEVER resubmits a side whose claim is held with no task id" and "stamps the task id before the first status read" — if either fails, stop and fix it before continuing, because both are money.

- [ ] **Step 5: Run the whole backend suite**

Run: `npx vitest run && npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/compare/runComparison.ts apps/backend/tests/compare/runComparison.test.ts
git commit -m "feat(video): drive two clips to terminal, with Mentic's claim discipline ported

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Phase 3 — Routes

### Task 7: `/compare` routes, wired into the app and the server

**Files:**
- Create: `apps/backend/src/server/routes/compare.ts`
- Modify: `apps/backend/src/server/app.ts`
- Modify: `apps/backend/src/server/server.ts`
- Modify: `apps/frontend/vite.config.ts`
- Test: `apps/backend/tests/server/compare.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 6.
- Produces: `registerCompareRoutes(app: FastifyInstance, deps: CompareRouteDeps): void` and `type CompareRouteDeps = { store?: ComparisonStore; runStore?: RunStore; avatarStore?: AvatarStore; transport?: VideoTransport; drive?: (comparisonId: string) => void }`, from `apps/backend/src/server/routes/compare.ts`.

The five routes:

| Route | Does |
|---|---|
| `POST /compare` | Validates, reads the two descriptions, creates the row, kicks the drive off unawaited, answers `202` with the row |
| `GET /compare` | The history, newest first |
| `GET /compare/:id` | One row, whole |
| `POST /compare/:id/refresh` | One status read per unfinished side, for a row this process lost |
| `GET /compare/:id/:side/clip` | The stored bytes |

**`POST /compare` spends money and says so.** It is unreachable unless the server was built with a transport, which happens only when `OPENROUTER_API_KEY` is present. Absent the key it answers `503` with a readable reason, exactly as `/avatar/sheet` does — a missing key is a real state, not a misconfiguration to crash on.

**Fire-and-forget, like `POST /runs`.** A comparison takes minutes and the browser needs the id immediately to start polling. Any rejection is already recorded on the row by `driveComparison` itself, so there is nothing left to do with it at this layer.

**The clip route is not immutable-cacheable in the way the avatar image route is.** An avatar's bytes never change once written; a clip's `clipUrl` is null until the download lands, so a 404 must not be cached. Serve the bytes with `Cache-Control: public, max-age=31536000, immutable` only on a hit, and no cache header at all on a miss. Also set `Accept-Ranges: bytes` — a `<video>` element seeks, and without it Chrome refuses to scrub.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/server/compare.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "../../src/server/app.js";
import { loadRubric } from "../../src/rubric/load.js";
import { FileComparisonStore } from "../../src/store/ComparisonStore.js";
import type { CompareRouteDeps } from "../../src/server/routes/compare.js";
import type { AvatarRecord, AvatarStore } from "../../src/store/AvatarStore.js";
import type { RunManifest, RunStore, StoredPass } from "../../src/store/RunStore.js";
import type { VersionStore } from "../../src/store/VersionStore.js";
import type { VideoTransport } from "../../src/video/openrouterClient.js";

const ORIGINAL = "A young man with wavy brown hair.";
const REPAIRED = "A young man with chestnut-brown wavy hair, parted on the left.";

const MANIFEST: RunManifest = {
  runId: "run-1",
  rubricVersion: "v1",
  model: "claude-opus-5",
  status: "improved_still_failing",
  startedAt: "2026-09-12T13:38:30.943Z",
  finishedAt: "2026-09-12T13:39:08.735Z",
  passes: 2,
};

function evaluation(description: string) {
  return {
    description,
    results: [],
    failing: [],
    notEvaluated: [],
    spans: [],
    unverified: [],
    negativeConstraintPresent: true,
  };
}

const PASSES: StoredPass[] = [
  {
    pass: 1,
    evaluation: evaluation(ORIGINAL),
    repair: { from: ORIGINAL, to: REPAIRED, rejected: [] },
  },
  { pass: 2, evaluation: evaluation(REPAIRED) },
];

const AVATAR: AvatarRecord = {
  id: "avatar-1",
  createdAt: "2026-09-12T13:23:27.890Z",
  source: "generated",
  mediaType: "image/jpeg",
  description: ORIGINAL,
};

function runStore(): RunStore {
  return {
    createRun: async () => {},
    writePass: async () => {},
    finishRun: async () => {},
    getRun: async (id) => {
      if (id !== "run-1") throw new Error(`run ${id} not found`);
      return MANIFEST;
    },
    listRuns: async () => [MANIFEST],
    readPasses: async () => PASSES,
  };
}

function avatarStore(): AvatarStore {
  return {
    save: async () => {
      throw new Error("not used");
    },
    attachDescription: async () => {
      throw new Error("not used");
    },
    list: async () => [AVATAR],
    get: async (id) => (id === "avatar-1" ? AVATAR : null),
    readImage: async () => null,
  };
}

const stubVersionStore: VersionStore = {
  list: async () => [],
  get: async () => {
    throw new Error("not used");
  },
  compare: async () => {
    throw new Error("not used");
  },
};

const transport: VideoTransport = {
  submit: async () => ({ taskId: "task-1" }),
  check: async (taskId) => ({
    taskId,
    status: "succeeded",
    failureCode: null,
    failure: null,
    actualMicroUsd: 410_000,
  }),
  fetchClip: async () => ({ bytes: Buffer.from([1, 2, 3]), mediaType: "video/mp4" }),
};

async function appWith(compare: CompareRouteDeps) {
  return buildApp({
    store: runStore(),
    rubric: await loadRubric("v1"),
    startRun: async () => {
      throw new Error("not used");
    },
    versionStore: stubVersionStore,
    compare,
  });
}

async function withDeps<T>(fn: (deps: CompareRouteDeps) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "compare-routes-"));
  try {
    return await fn({
      store: new FileComparisonStore(root),
      runStore: runStore(),
      avatarStore: avatarStore(),
      transport,
      drive: vi.fn(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BODY = { avatarId: "avatar-1", runId: "run-1", seconds: 4, size: "480x854" };

describe("POST /compare", () => {
  it("answers 202 with a queued pair and its estimate, and starts the drive", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.before.status).toBe("queued");
      expect(body.after.status).toBe("queued");
      expect(body.before.estimatedMicroUsd).toBe(411_201);
      expect(body.before.description).toBe(ORIGINAL);
      expect(body.after.description).toBe(REPAIRED);
      expect(deps.drive).toHaveBeenCalledWith(body.comparisonId);
    });
  });

  it("503s with a readable reason when no key built a transport", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({ ...deps, transport: undefined });
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("OPENROUTER_API_KEY");
    });
  });

  it("refuses a size that is not offered, and a duration outside 4..30", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);

      const badSize = await app.inject({
        method: "POST",
        url: "/compare",
        payload: { ...BODY, size: "1920x1080" },
      });
      expect(badSize.statusCode).toBe(400);

      for (const seconds of [3, 31, 4.5]) {
        const res = await app.inject({
          method: "POST",
          url: "/compare",
          payload: { ...BODY, seconds },
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  it("refuses a run that is not the avatar's, with the reason in the body", async () => {
    await withDeps(async (deps) => {
      const app = await appWith({
        ...deps,
        avatarStore: {
          ...avatarStore(),
          get: async () => ({ ...AVATAR, description: "Somebody else." }),
        },
      });
      const res = await app.inject({ method: "POST", url: "/compare", payload: BODY });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/avatar/i);
    });
  });

  it("spends nothing when validation fails", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      await app.inject({ method: "POST", url: "/compare", payload: { ...BODY, seconds: 99 } });
      expect(deps.drive).not.toHaveBeenCalled();
    });
  });
});

describe("GET /compare and /compare/:id", () => {
  it("lists nothing for a fresh store and 404s an unknown id", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      expect((await app.inject({ method: "GET", url: "/compare" })).json()).toEqual([]);

      const missing = await app.inject({ method: "GET", url: "/compare/nope" });
      expect(missing.statusCode).toBe(404);
    });
  });

  it("returns a created row whole", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();

      const res = await app.inject({ method: "GET", url: `/compare/${created.comparisonId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().comparisonId).toBe(created.comparisonId);

      const list = (await app.inject({ method: "GET", url: "/compare" })).json();
      expect(list).toHaveLength(1);
      expect(list[0].estimatedMicroUsd).toBe(822_402);
    });
  });
});

describe("GET /compare/:id/:side/clip", () => {
  it("serves stored bytes with a range header, and 404s a side with no clip", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();
      await deps.store?.writeClip(
        created.comparisonId,
        "before",
        Buffer.from([9, 9]),
        "video/mp4",
      );

      const hit = await app.inject({
        method: "GET",
        url: `/compare/${created.comparisonId}/before/clip`,
      });
      expect(hit.statusCode).toBe(200);
      expect(hit.headers["content-type"]).toBe("video/mp4");
      expect(hit.headers["accept-ranges"]).toBe("bytes");

      const miss = await app.inject({
        method: "GET",
        url: `/compare/${created.comparisonId}/after/clip`,
      });
      expect(miss.statusCode).toBe(404);
      expect(miss.headers["cache-control"]).toBeUndefined();
    });
  });

  it("refuses a side that is not before or after", async () => {
    await withDeps(async (deps) => {
      const app = await appWith(deps);
      const res = await app.inject({ method: "GET", url: "/compare/anything/sideways/clip" });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe("POST /compare/:id/refresh", () => {
  it("re-reads an unfinished side without submitting anything", async () => {
    await withDeps(async (deps) => {
      const submit = vi.fn();
      const app = await appWith({ ...deps, transport: { ...transport, submit } });
      const created = (
        await app.inject({ method: "POST", url: "/compare", payload: BODY })
      ).json();
      await deps.store?.stampTaskId(created.comparisonId, "before", "task-1");

      const res = await app.inject({
        method: "POST",
        url: `/compare/${created.comparisonId}/refresh`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().before.status).toBe("succeeded");
      expect(submit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run apps/backend/tests/server/compare.test.ts`
Expected: FAIL — cannot resolve `../../src/server/routes/compare.js`.

- [ ] **Step 3: Write `apps/backend/src/server/routes/compare.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  COMPARISON_SIDES,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_SIZES,
  type ComparisonSide,
} from "@ai-director/contract";
import { readComparisonSources } from "../../compare/readSources.js";
import { refreshComparison, startComparison } from "../../compare/runComparison.js";
import type { AvatarStore } from "../../store/AvatarStore.js";
import type { ComparisonStore } from "../../store/ComparisonStore.js";
import type { RunStore } from "../../store/RunStore.js";
import type { VideoTransport } from "../../video/openrouterClient.js";

/**
 * The side-by-side comparison.
 *
 * `POST /compare` SPENDS MONEY — about $0.82 for a pair at the default size — and is
 * unreachable unless the server was built with a transport, which happens only when
 * `OPENROUTER_API_KEY` is present. Absent the key it answers 503 with a readable reason
 * rather than pretending, exactly as `/avatar/sheet` does for a missing image key.
 *
 * There is no event stream here. The contract's `EVENT_NAMES` enumerates the nine names
 * spec §6 defines, and `docs/decision-log.md` (2026-09-11) records that adding to that
 * list is a spec change rather than a bug fix. The Compare screen polls `GET /compare/:id`,
 * and every poll that returns is a real state change it may render.
 */
export type CompareRouteDeps = {
  /** Always wired when a store directory exists: a comparison rendered yesterday is worth
   *  listing and serving today, with or without a key. */
  store?: ComparisonStore;
  runStore?: RunStore;
  avatarStore?: AvatarStore;
  /** Absent means no key was configured; `POST /compare` then 503s. */
  transport?: VideoTransport;
  /** Kicks the render off, unawaited. Injected so a route test never starts a real drive. */
  drive?: (comparisonId: string) => void;
};

const CreateBodySchema = z.object({
  avatarId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  seconds: z
    .number()
    .int(`seconds must be a whole number between ${MIN_VIDEO_SECONDS} and ${MAX_VIDEO_SECONDS}`)
    .min(MIN_VIDEO_SECONDS)
    .max(MAX_VIDEO_SECONDS),
  // An enum, not a string: an unprobed size is a paid render finding out.
  size: z.enum(VIDEO_SIZES),
});

function isSide(value: string): value is ComparisonSide {
  return (COMPARISON_SIDES as readonly string[]).includes(value);
}

export function registerCompareRoutes(app: FastifyInstance, deps: CompareRouteDeps): void {
  app.post("/compare", async (request, reply) => {
    if (!deps.store || !deps.runStore || !deps.avatarStore) {
      return reply.code(503).send({ error: "the comparison store is not configured" });
    }
    if (!deps.transport) {
      return reply.code(503).send({
        error:
          "video comparison is not configured: OPENROUTER_API_KEY is required, and every render through it costs money",
      });
    }

    const parsed = CreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
    }

    const sources = await readComparisonSources(
      { runStore: deps.runStore, avatarStore: deps.avatarStore },
      { runId: parsed.data.runId, avatarId: parsed.data.avatarId },
    );
    if (!sources.ok) {
      // A 400 and not a 404: the ids may both exist and still not make a comparison, and
      // the reason is the useful part. Nothing has been submitted at this point.
      return reply.code(400).send({ error: sources.reason });
    }

    const row = await startComparison(
      { store: deps.store, transport: deps.transport },
      {
        avatarId: parsed.data.avatarId,
        runId: parsed.data.runId,
        seconds: parsed.data.seconds,
        size: parsed.data.size,
        rubricVersion: sources.rubricVersion,
        repairerPromptVersion: sources.repairerPromptVersion,
        sources: sources.sources,
      },
    );

    // Fire-and-forget, like `POST /runs`: a pair takes minutes and the browser needs the
    // id now to start polling. Any failure is recorded on the row by `driveComparison`
    // itself, so there is nothing left to do with it here.
    deps.drive?.(row.comparisonId);

    return reply.code(202).send(row);
  });

  app.get("/compare", async (_request, reply) => {
    if (!deps.store) return reply.code(200).send([]);
    return reply.code(200).send(await deps.store.list());
  });

  app.get<{ Params: { id: string } }>("/compare/:id", async (request, reply) => {
    if (!deps.store) return reply.code(404).send({ error: "not found" });
    const row = await deps.store.get(request.params.id);
    if (!row) return reply.code(404).send({ error: `comparison "${request.params.id}" not found` });
    return reply.code(200).send(row);
  });

  app.post<{ Params: { id: string } }>("/compare/:id/refresh", async (request, reply) => {
    if (!deps.store || !deps.transport) {
      return reply.code(503).send({ error: "video comparison is not configured" });
    }
    const existing = await deps.store.get(request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: `comparison "${request.params.id}" not found` });
    }
    // Reads status, never submits — see `refreshComparison`.
    const row = await refreshComparison(
      { store: deps.store, transport: deps.transport },
      request.params.id,
    );
    return reply.code(200).send(row);
  });

  app.get<{ Params: { id: string; side: string } }>(
    "/compare/:id/:side/clip",
    async (request, reply) => {
      const { id, side } = request.params;
      if (!isSide(side)) {
        return reply.code(400).send({ error: `side must be "before" or "after"` });
      }
      if (!deps.store) return reply.code(404).send({ error: "not found" });

      const clip = await deps.store.readClip(id, side);
      // No cache header on a miss: a clip's absence is temporary — the download may not
      // have landed yet — and a cached 404 would outlive it.
      if (!clip) return reply.code(404).send({ error: "not found" });

      return reply
        .code(200)
        .header("Content-Type", clip.mediaType)
        // A clip's bytes never change once written, the same as an avatar's.
        .header("Cache-Control", "public, max-age=31536000, immutable")
        // Without this a <video> element cannot seek: Chrome refuses to scrub a response
        // that does not advertise range support.
        .header("Accept-Ranges", "bytes")
        .send(clip.bytes);
    },
  );
}
```

- [ ] **Step 4: Register the routes in `app.ts`**

Add the import beside the others:

```ts
import { registerCompareRoutes, type CompareRouteDeps } from "./routes/compare.js";
```

Add to `AppDeps`, after `avatar`:

```ts
  /** The video comparison. Optional, and absent is a real state: a server with no
   *  OPENROUTER_API_KEY grades and repairs exactly as before, it simply cannot render, and
   *  `POST /compare` says so with a 503 rather than failing somewhere deeper. */
  compare?: CompareRouteDeps;
```

And the registration, after `registerAvatarRoutes`:

```ts
  registerCompareRoutes(app, deps.compare ?? {});
```

- [ ] **Step 5: Wire the real transport in `server.ts`**

Add the imports:

```ts
import { driveComparison } from "../compare/runComparison.js";
import { FileComparisonStore } from "../store/ComparisonStore.js";
import { createOpenRouterVideoTransport } from "../video/openrouterClient.js";
```

Add the directory constant beside the others:

```ts
const COMPARISONS_DIR = "data/comparisons";
```

And build the deps just before `buildApp`, after the `avatar` block:

```ts
  // The video comparison. Same shape as `avatar` above and for the same reason: the store
  // is always wired, because a pair rendered last week is still worth listing and playing
  // today, while the transport exists only when a key does.
  const comparisonStore = new FileComparisonStore(COMPARISONS_DIR);
  const videoTransport = process.env.OPENROUTER_API_KEY
    ? createOpenRouterVideoTransport()
    : undefined;

  // Assigned immediately below. The `drive` closure reads it lazily rather than closing
  // over a value that does not exist yet: `buildApp` needs `compare`, and `compare` needs
  // somewhere to log a failed drive. The closure only ever runs from inside a request,
  // long after the assignment.
  let app: ReturnType<typeof buildApp>;

  const compare = {
    store: comparisonStore,
    runStore: store,
    avatarStore: avatar.store,
    ...(videoTransport
      ? {
          transport: videoTransport,
          drive: (comparisonId: string) => {
            // Unawaited by design, like `startRun`. `driveComparison` records every outcome
            // on the row, so a rejection here has already been written down; logging it is
            // all that is left to do with it.
            void driveComparison(
              { store: comparisonStore, transport: videoTransport },
              comparisonId,
            ).catch((err: unknown) => {
              app.log.error({ err, comparisonId }, "comparison drive failed");
            });
          },
        }
      : {}),
  };

  app = buildApp({ store, rubric, startRun, bus, versionStore, avatar, compare, logger: true });
```

The existing `const app = buildApp({...})` line is replaced by the assignment above; the rest of `main` (the `listen` call) is unchanged.

- [ ] **Step 6: Add the dev proxy prefix**

In `apps/frontend/vite.config.ts`, add to the `proxy` table, beside `/avatar`:

```ts
      // Every backend route prefix has to be listed here by hand. A missing prefix does not
      // fail loudly: Vite serves the SPA's index.html for it, the JSON parse fails, and the
      // UI reports a bare 404 against a route that exists and is running.
      "/compare": BACKEND_ORIGIN,
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `npx vitest run apps/backend/tests/server/compare.test.ts`
Expected: PASS, every case.

- [ ] **Step 8: Run the whole suite**

Run: `npm test && npm run typecheck`
Expected: green. `app.ts`'s existing tests construct `buildApp` without `compare`; the field is optional, so they must still pass unchanged. If one fails, the field is not optional enough.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/server/routes/compare.ts apps/backend/tests/server/compare.test.ts \
  apps/backend/src/server/app.ts apps/backend/src/server/server.ts apps/frontend/vite.config.ts
git commit -m "feat(video): /compare routes, wired behind an optional OpenRouter transport

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Phase 4 — The Compare screen

**Before starting Phase 4, load the `impeccable`, `ui-ux-pro-max` and `motion` skills.** Spec §9 requires it of the screens, and this is a screen. It is a requirement of the design, not a preference.

The design constraints this screen inherits, and which a reviewer checks against:

- Tokens from `apps/frontend/src/styles/tokens.css`. No Tailwind, no component library, no hardcoded colour.
- Monospace is reserved for the one genuinely code-like thing: the description being compared. Everything else is the UI sans.
- **No success state for a failed or cancelled render.** `isRenderSuccess` from the contract is the only thing allowed to decide, the same way `isSuccess` decides for a run.
- **No spinner, no progress bar, no ambient motion.** Poll count and elapsed time, both moving only when a poll returns.
- The avatar sheet is on screen, labelled as the reference the clips are judged against and explicitly not sent to the model.

### Task 8: `compareApi.ts` and the fourth tab

**Files:**
- Create: `apps/frontend/src/data/compareApi.ts`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/ScreenTabs.tsx`
- Test: `apps/frontend/tests/data/compareApi.test.ts`

**Interfaces:**
- Consumes: `ComparisonView`, `ComparisonSummary`, `VideoSize` from `@ai-director/contract`.
- Produces, from `apps/frontend/src/data/compareApi.ts`: `startComparison`, `getComparison`, `listComparisons`, `refreshComparison`, `formatMicroUsd(microUsd: number | null): string`.
- Produces: `Screen` in `App.tsx` widened to `"run" | "architecture" | "versions" | "compare"`.

**Deliberately not on `RunClient`,** for the reason `avatarApi.ts` gives in its own header: that interface has a fixture implementation so every screen can be built with no backend, and a fake comparison would mean inventing two plausible-looking video clips. This product does not fabricate artefacts. In fixture mode the Compare screen says it needs the real backend.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/tests/data/compareApi.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatMicroUsd,
  getComparison,
  listComparisons,
  refreshComparison,
  startComparison,
} from "../../src/data/compareApi.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("formatMicroUsd", () => {
  it("shows dollars to the cent", () => {
    expect(formatMicroUsd(411_201)).toBe("$0.41");
    expect(formatMicroUsd(822_402)).toBe("$0.82");
    expect(formatMicroUsd(1_848_960)).toBe("$1.85");
  });

  it("says not measured for null, and never renders it as zero", () => {
    expect(formatMicroUsd(null)).toBe("not measured");
    expect(formatMicroUsd(null)).not.toContain("0.00");
  });

  it("shows a real zero as a zero", () => {
    expect(formatMicroUsd(0)).toBe("$0.00");
  });
});

describe("startComparison", () => {
  it("posts the four controls and returns the row", async () => {
    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));

    const row = await startComparison({
      avatarId: "a",
      runId: "r",
      seconds: 4,
      size: "480x854",
    });

    expect(row.comparisonId).toBe("cmp-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/compare");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      avatarId: "a",
      runId: "r",
      seconds: 4,
      size: "480x854",
    });
  });

  it("throws with the server's own reason on a refusal", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "run repaired nothing" }), { status: 400 }),
    );
    await expect(
      startComparison({ avatarId: "a", runId: "r", seconds: 4, size: "480x854" }),
    ).rejects.toThrow("run repaired nothing");
  });
});

describe("the read endpoints", () => {
  it("fetches one row, the history, and a refresh", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await listComparisons();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/compare");

    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));
    await getComparison("cmp-1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/compare/cmp-1");

    fetchMock.mockResolvedValue(ok({ comparisonId: "cmp-1" }));
    await refreshComparison("cmp-1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/compare/cmp-1/refresh");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("POST");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run --config apps/frontend/vitest.config.ts apps/frontend/tests/data/compareApi.test.ts`
Expected: FAIL — cannot resolve `../../src/data/compareApi.js`.

- [ ] **Step 3: Write `apps/frontend/src/data/compareApi.ts`**

```ts
import type {
  ComparisonSummary,
  ComparisonView,
  VideoSize,
} from "@ai-director/contract";

/**
 * The five `/compare` endpoints.
 *
 * Deliberately NOT on `RunClient`, for the reason `avatarApi.ts` states in its own header:
 * that interface has a fixture implementation so every screen can be built with no backend
 * at all, and a fake comparison would mean inventing two plausible-looking video clips. A
 * plausible-looking fake artefact is exactly what this product refuses to produce. So these
 * are plain functions, the Compare screen calls them directly, and in fixture mode it says
 * it needs the real backend instead of pretending.
 *
 * `startComparison` SPENDS MONEY. Nothing calls it unless a person presses the button that
 * does, with the estimate on screen beside it.
 */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const message =
      parsed !== null && typeof parsed === "object" && parsed !== undefined && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `request to ${url} failed with status ${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export type StartComparisonArgs = {
  avatarId: string;
  runId: string;
  seconds: number;
  size: VideoSize;
};

export function startComparison(args: StartComparisonArgs): Promise<ComparisonView> {
  return request<ComparisonView>("/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export function getComparison(comparisonId: string): Promise<ComparisonView> {
  return request<ComparisonView>(`/compare/${comparisonId}`);
}

export function listComparisons(): Promise<ComparisonSummary[]> {
  return request<ComparisonSummary[]>("/compare");
}

/** One status read per unfinished side, for a pair this browser lost track of. */
export function refreshComparison(comparisonId: string): Promise<ComparisonView> {
  return request<ComparisonView>(`/compare/${comparisonId}/refresh`, { method: "POST" });
}

/**
 * Micro-USD as dollars, or the words "not measured".
 *
 * Null and zero are different facts and are rendered differently. Null is "OpenRouter
 * reported no cost on this task"; `$0.00` would be a measurement of free, which is the
 * exact fabrication `StepCost`'s all-optional shape exists to prevent elsewhere in this app.
 */
export function formatMicroUsd(microUsd: number | null): string {
  if (microUsd === null) return "not measured";
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}
```

- [ ] **Step 4: Add the fourth screen to `App.tsx`**

Widen the union and the path table:

```ts
export type Screen = "run" | "architecture" | "versions" | "compare";

const PATH_BY_SCREEN: Record<Screen, string> = {
  run: "/",
  architecture: "/architecture",
  versions: "/versions",
  compare: "/compare",
};

function screenFromPath(pathname: string): Screen {
  if (pathname.startsWith("/architecture")) return "architecture";
  if (pathname.startsWith("/versions")) return "versions";
  if (pathname.startsWith("/compare")) return "compare";
  return "run";
}
```

Add the import and the render branch, after the `versions` branch:

```tsx
          {screen === "compare" ? <CompareScreen live={!client.isFixture} /> : null}
```

with `import { CompareScreen } from "./screens/CompareScreen.js";` beside the other screen imports.

- [ ] **Step 5: Add the fourth tab**

In `apps/frontend/src/components/ScreenTabs.tsx`, extend `TABS`:

```ts
const TABS: ReadonlyArray<{ id: Screen; label: string; path: string }> = [
  { id: "run", label: "Run", path: "/" },
  { id: "architecture", label: "Architecture", path: "/architecture" },
  { id: "versions", label: "Versions", path: "/versions" },
  { id: "compare", label: "Compare", path: "/compare" },
];
```

The failing-check badge stays on RUN only, unchanged: it counts failing rubric checks and the Compare screen has none.

- [ ] **Step 6: Run the test and the frontend suite**

Run: `npm run test:web`
Expected: PASS. `App.test.tsx` and `ScreenTabs`-touching tests may assert three tabs; update those assertions to four, and nothing else.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/data/compareApi.ts apps/frontend/tests/data/compareApi.test.ts \
  apps/frontend/src/App.tsx apps/frontend/src/components/ScreenTabs.tsx apps/frontend/tests
git commit -m "feat(video): compare API client and the fourth tab

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `ClipPair` — the two players, their statuses and their costs

**Files:**
- Create: `apps/frontend/src/components/ClipPair.tsx`
- Create: `apps/frontend/src/components/CostReadout.tsx`
- Create: `apps/frontend/src/styles/compare-screen.css`
- Test: `apps/frontend/tests/components/ClipPair.test.tsx`

**Interfaces:**
- Consumes: `ComparisonView`, `RenderView`, `isRenderSuccess`, `isRenderTerminal` from `@ai-director/contract`; `formatMicroUsd` from Task 8.
- Produces: `ClipPair({ comparison }: { comparison: ComparisonView })` and `CostReadout({ estimatedMicroUsd, actualMicroUsd }: { estimatedMicroUsd: number; actualMicroUsd: number | null })`.

**Built before the screen that uses it**, so the rules it has to obey are proven in isolation before any picker or fetch exists around them.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/tests/components/ClipPair.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ComparisonView, RenderStatus, RenderView } from "@ai-director/contract";
import { ClipPair } from "../../src/components/ClipPair.js";

function renderView(side: "before" | "after", over: Partial<RenderView> = {}): RenderView {
  return {
    side,
    status: "succeeded",
    taskId: `task-${side}`,
    submittedAt: "2026-09-16T10:00:00.000Z",
    finishedAt: "2026-09-16T10:02:00.000Z",
    failureCode: null,
    failure: null,
    estimatedMicroUsd: 411_201,
    actualMicroUsd: 410_000,
    clipUrl: `/compare/cmp-1/${side}/clip`,
    description: side === "before" ? "The raw text." : "The repaired text.",
    descriptionSha256: (side === "before" ? "a" : "b").repeat(64),
    rubricVersion: "v1",
    repairerPromptVersion: null,
    polls: 24,
    ...over,
  };
}

function comparison(over: Partial<ComparisonView> = {}): ComparisonView {
  return {
    comparisonId: "cmp-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    finishedAt: "2026-09-16T10:02:00.000Z",
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    before: renderView("before"),
    after: renderView("after"),
    ...over,
  };
}

describe("ClipPair", () => {
  it("plays both clips from this server's own paths, never the vendor's", () => {
    render(<ClipPair comparison={comparison()} />);
    const players = screen.getAllByTestId("clip-player");
    expect(players).toHaveLength(2);
    expect(players[0]?.getAttribute("src")).toBe("/compare/cmp-1/before/clip");
    expect(players[1]?.getAttribute("src")).toBe("/compare/cmp-1/after/clip");
    for (const player of players) {
      expect(player.getAttribute("src")).not.toContain("openrouter.ai");
    }
  });

  it("shows each side's own description, and its hash, so the two are never confused", () => {
    render(<ClipPair comparison={comparison()} />);
    expect(screen.getByText("The raw text.")).toBeInTheDocument();
    expect(screen.getByText("The repaired text.")).toBeInTheDocument();
    expect(screen.getByText(/aaaaaaaa/)).toBeInTheDocument();
    expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument();
  });

  it("states what is held identical between the two sides", () => {
    render(<ClipPair comparison={comparison()} />);
    const shared = screen.getByTestId("held-constant");
    expect(within(shared).getByText(/480x854/)).toBeInTheDocument();
    expect(within(shared).getByText(/4 s/)).toBeInTheDocument();
    expect(within(shared).getByText(/bytedance\/seedance-2\.5/)).toBeInTheDocument();
    expect(within(shared).getByText(/shot prompt v1/i)).toBeInTheDocument();
  });

  it("shows the estimate and the bill as two separate figures", () => {
    // Two different values on purpose: if the component ever rendered the estimate in the
    // billed slot, identical numbers would hide it.
    render(
      <ClipPair
        comparison={comparison({ before: renderView("before", { actualMicroUsd: 398_500 }) })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText(/estimated/i)).toBeInTheDocument();
    expect(within(before).getByText("$0.41")).toBeInTheDocument();
    expect(within(before).getByText(/billed/i)).toBeInTheDocument();
    expect(within(before).getByText("$0.40")).toBeInTheDocument();
  });

  it("says not measured rather than zero when the vendor reported no cost", () => {
    render(
      <ClipPair
        comparison={comparison({ before: renderView("before", { actualMicroUsd: null }) })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText("not measured")).toBeInTheDocument();
    expect(within(before).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("never shows a success state for a failed or cancelled render", () => {
    for (const status of ["failed", "cancelled"] as RenderStatus[]) {
      const { unmount } = render(
        <ClipPair
          comparison={comparison({
            before: renderView("before", {
              status,
              clipUrl: null,
              failure: "refused",
              failureCode: "CONTENT_POLICY",
            }),
          })}
        />,
      );
      const before = screen.getByTestId("render-before");
      expect(before.getAttribute("data-success")).toBeNull();
      expect(within(before).getByText(status)).toBeInTheDocument();
      expect(within(before).getByText(/refused/)).toBeInTheDocument();
      expect(within(before).queryByTestId("clip-player")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("reports a billed render whose clip could not be downloaded as both facts at once", () => {
    render(
      <ClipPair
        comparison={comparison({
          before: renderView("before", {
            status: "succeeded",
            clipUrl: null,
            failureCode: "CLIP_DOWNLOAD_FAILED",
            failure: "the render succeeded and was billed, but its clip could not be downloaded",
          }),
        })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText(/billed/i)).toBeInTheDocument();
    expect(within(before).getByText(/could not be downloaded/)).toBeInTheDocument();
    expect(within(before).queryByTestId("clip-player")).not.toBeInTheDocument();
  });

  it("reports progress as poll count, with no spinner and no progress bar", () => {
    const { container } = render(
      <ClipPair
        comparison={comparison({
          finishedAt: null,
          before: renderView("before", {
            status: "running",
            clipUrl: null,
            finishedAt: null,
            actualMicroUsd: null,
            polls: 7,
          }),
        })}
      />,
    );
    const before = screen.getByTestId("render-before");
    expect(within(before).getByText(/7 status reads/i)).toBeInTheDocument();
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    expect(container.querySelector(".spinner")).toBeNull();
  });

  it("labels which prompt versions produced each side", () => {
    render(
      <ClipPair
        comparison={comparison({
          after: renderView("after", { repairerPromptVersion: "v2" }),
        })}
      />,
    );
    expect(within(screen.getByTestId("render-after")).getByText(/repairer v2/i)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("render-before")).getByText(/repairer version not recorded/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run --config apps/frontend/vitest.config.ts apps/frontend/tests/components/ClipPair.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/ClipPair.js`.

- [ ] **Step 3: Write `apps/frontend/src/components/CostReadout.tsx`**

```tsx
import { formatMicroUsd } from "../data/compareApi.js";

/**
 * Two figures, never one.
 *
 * The estimate is a property of the REQUEST, computed from OpenRouter's published rate
 * before anything was submitted. The bill is a property of the OUTCOME, reported by
 * OpenRouter on the terminal task. Collapsing them into a single "cost" would make the
 * estimate look like a measurement on every render that has not billed yet — and on this
 * screen, whose entire job is showing what something cost, that is the one number that
 * must not be guessed.
 */
export function CostReadout({
  estimatedMicroUsd,
  actualMicroUsd,
}: {
  estimatedMicroUsd: number;
  actualMicroUsd: number | null;
}): React.JSX.Element {
  return (
    <dl className="cost-readout">
      <div className="cost-readout__row">
        <dt>Estimated</dt>
        <dd className="tnum">{formatMicroUsd(estimatedMicroUsd)}</dd>
      </div>
      <div className="cost-readout__row">
        <dt>Billed</dt>
        <dd className="tnum" data-unmeasured={actualMicroUsd === null || undefined}>
          {formatMicroUsd(actualMicroUsd)}
        </dd>
      </div>
    </dl>
  );
}
```

- [ ] **Step 4: Write `apps/frontend/src/components/ClipPair.tsx`**

```tsx
import {
  isRenderSuccess,
  isRenderTerminal,
  type ComparisonView,
  type RenderView,
} from "@ai-director/contract";
import { CostReadout } from "./CostReadout.js";
import "../styles/compare-screen.css";

/**
 * Two clips from one avatar, where the only variable is the description.
 *
 * ── Why the shared settings are printed on screen ───────────────────────────────────
 * The comparison's whole claim is "everything but the description is identical." A claim
 * a reader cannot check is decoration, so the size, the seconds, the model and the shot
 * prompt version are written out once, above both clips, as the thing being held constant.
 *
 * ── Why there is no spinner ─────────────────────────────────────────────────────────
 * Motion is tied to real state changes only, and OpenRouter reports no numeric progress —
 * only a status. A spinner would be ambient motion; a percentage bar would be a number
 * nobody measured. What is real is that a status read came back, so that is what is
 * counted and shown.
 *
 * ── Why a succeeded render with no clip still says "billed" ─────────────────────────
 * Because it was. A render that completed and whose clip could not be downloaded is two
 * separate facts, and folding it into "failed" would misreport the money.
 */

function SideLabel({ side }: { side: "before" | "after" }): React.JSX.Element {
  return (
    <div className="clip-side__label">
      <span className="clip-side__side">{side}</span>
      <span className="clip-side__gloss">
        {side === "before"
          ? "the description as the describe step wrote it"
          : "the description after the repair passes"}
      </span>
    </div>
  );
}

function ClipSide({ render }: { render: RenderView }): React.JSX.Element {
  const success = isRenderSuccess(render.status);
  const settled = isRenderTerminal(render.status);

  return (
    <section
      className="clip-side"
      data-testid={`render-${render.side}`}
      // Only `succeeded` sets this. `cancelled` is terminal and is not a win, exactly as
      // `improved_still_failing` is terminal and is not a win for a run.
      data-success={success || undefined}
      data-status={render.status}
    >
      <SideLabel side={render.side} />

      {render.clipUrl ? (
        <video
          data-testid="clip-player"
          className="clip-side__player"
          src={render.clipUrl}
          controls
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="clip-side__no-clip">
          <span className="clip-side__status">{render.status}</span>
          {!settled ? (
            // A poll returning is a real state change; this number moves only when one does.
            <span className="clip-side__polls tnum">{render.polls} status reads</span>
          ) : null}
        </div>
      )}

      {render.failure ? (
        <p className="clip-side__failure">
          {render.failureCode ? <code>{render.failureCode}</code> : null} {render.failure}
        </p>
      ) : null}

      <CostReadout
        estimatedMicroUsd={render.estimatedMicroUsd}
        actualMicroUsd={render.actualMicroUsd}
      />

      <p className="clip-side__description">{render.description}</p>

      <p className="clip-side__provenance">
        <span>rubric {render.rubricVersion}</span>
        <span>
          {render.repairerPromptVersion
            ? `repairer ${render.repairerPromptVersion}`
            : "repairer version not recorded"}
        </span>
        <span className="clip-side__hash" title={render.descriptionSha256}>
          {render.descriptionSha256.slice(0, 12)}
        </span>
      </p>
    </section>
  );
}

export function ClipPair({ comparison }: { comparison: ComparisonView }): React.JSX.Element {
  return (
    <div className="clip-pair">
      <p className="clip-pair__constant" data-testid="held-constant">
        Identical across both clips: <span>{comparison.size}</span>
        <span>{comparison.seconds} s</span>
        <span>{comparison.model}</span>
        <span>shot prompt {comparison.shotPromptVersion}</span>
        <span>no image sent</span>
      </p>
      <div className="clip-pair__grid">
        <ClipSide render={comparison.before} />
        <ClipSide render={comparison.after} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `apps/frontend/src/styles/compare-screen.css`**

Every value a token from `tokens.css`; no hardcoded colour. The grid is two equal columns above 900px and stacks below it, because two vertical 9:16 clips side by side on a phone are two clips nobody can see.

```css
/*
 * The Compare screen.
 *
 * Two vertical clips, side by side, which is the one layout the whole screen exists for:
 * the comparison only works if both are in the eye at once. Below 900px they stack, because
 * two 9:16 players in half a phone width are two players nobody can see.
 *
 * No animation in this file. The screen's only moving parts are a poll counter and an
 * elapsed time, and both move because a network response arrived.
 */

.compare-screen {
  display: grid;
  gap: var(--space-5, 24px);
  padding: var(--space-5, 24px);
}

.clip-pair__constant {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 8px);
  align-items: baseline;
  color: var(--ink-3);
  font-size: 0.8125rem;
}

.clip-pair__constant span {
  padding: 2px 8px;
  border: 1px solid var(--ln);
  border-radius: var(--radius-sm, 4px);
  color: var(--ink-2);
}

.clip-pair__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-5, 24px);
}

@media (min-width: 900px) {
  .clip-pair__grid {
    grid-template-columns: 1fr 1fr;
  }
}

.clip-side {
  display: grid;
  gap: var(--space-3, 12px);
  padding: var(--space-4, 16px);
  background: var(--sf-panel);
  border: 1px solid var(--ln);
  border-radius: var(--radius-md, 8px);
}

/* The one place a border colour carries meaning, and it never carries it alone: the status
   word is always printed beside the clip. */
.clip-side[data-success] {
  border-color: var(--band-4);
}

.clip-side[data-status="failed"],
.clip-side[data-status="cancelled"] {
  border-color: var(--band-1);
}

.clip-side__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.clip-side__side {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
  color: var(--ink);
}

.clip-side__gloss {
  color: var(--ink-3);
  font-size: 0.8125rem;
}

.clip-side__player {
  width: 100%;
  aspect-ratio: 9 / 16;
  background: var(--sf-field);
  border-radius: var(--radius-sm, 4px);
}

.clip-side__no-clip {
  display: grid;
  place-content: center;
  gap: var(--space-2, 8px);
  aspect-ratio: 9 / 16;
  background: var(--sf-field);
  border: 1px dashed var(--ln-strong);
  border-radius: var(--radius-sm, 4px);
  text-align: center;
}

.clip-side__status {
  color: var(--ink-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.75rem;
}

.clip-side__polls {
  color: var(--ink-3);
  font-size: 0.8125rem;
}

.clip-side__failure {
  margin: 0;
  color: var(--ink-2);
  font-size: 0.8125rem;
}

.clip-side__failure code {
  color: var(--band-1);
}

/* The description is the one genuinely code-like thing on this screen, and the only thing
   set in monospace — the same rule the tokens file states for the graded description. */
.clip-side__description {
  margin: 0;
  padding: var(--space-3, 12px);
  background: var(--sf-field);
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--ink);
}

.clip-side__provenance {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2, 8px);
  margin: 0;
  color: var(--ink-3);
  font-size: 0.75rem;
}

.clip-side__hash {
  font-family: var(--font-mono);
}

.cost-readout {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px var(--space-3, 12px);
  margin: 0;
}

.cost-readout__row {
  display: contents;
}

.cost-readout dt {
  color: var(--ink-3);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.cost-readout dd {
  margin: 0;
  color: var(--ink);
  font-size: 0.875rem;
  text-align: right;
}

.cost-readout dd[data-unmeasured] {
  color: var(--ink-3);
  font-style: italic;
}
```

If `--space-*`, `--radius-*` or `--font-mono` are not the names `tokens.css` actually uses, read that file and use its names. Do not invent a token and do not leave a fallback standing in for one that exists.

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run --config apps/frontend/vitest.config.ts apps/frontend/tests/components/ClipPair.test.tsx`
Expected: PASS, every case.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/ClipPair.tsx apps/frontend/src/components/CostReadout.tsx \
  apps/frontend/src/styles/compare-screen.css apps/frontend/tests/components/ClipPair.test.tsx
git commit -m "feat(video): the two-clip pair, with the estimate and the bill kept apart

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `CompareScreen` — pick, estimate, submit, poll

**Files:**
- Create: `apps/frontend/src/screens/CompareScreen.tsx`
- Test: `apps/frontend/tests/screens/CompareScreen.test.tsx`

**Interfaces:**
- Consumes: `compareApi` (Task 8), `ClipPair` (Task 9), `listAvatars` and `avatarImageUrl` from `apps/frontend/src/data/avatarApi.ts`, `estimateMicroUsd`, `VIDEO_SIZES`, `DEFAULT_VIDEO_SIZE`, `DEFAULT_VIDEO_SECONDS`, `MIN_VIDEO_SECONDS`, `MAX_VIDEO_SECONDS`, `ComparisonView`, `RunSummary`, `VideoSize` from `@ai-director/contract`, and `GET /runs` through a plain fetch (not `RunClient` — see `compareApi`'s header).
- Produces: `CompareScreen({ live }: { live: boolean })`.

**The screen's shape, top to bottom:** the avatar picker (a strip of stored sheets); the run picker, filtered to runs that came from the selected avatar; seconds and size; the estimate for the pair with an explicit note that submitting spends it; the submit button; then the pair, and under it the history.

**The submit button is the only thing on this screen that spends money**, and the estimate sits next to it before it is pressed. It is disabled until an avatar and a run are both chosen, and while a comparison is in flight.

**Polling.** While a comparison is on screen and not finished, `getComparison` every `POLL_MS` (4000). The interval is cleared when both sides are terminal, when the component unmounts, and when the screen is left. No `setInterval` outlives the component.

**In fixture mode it says so and offers no button.** Same rule as the Pipeline tab: a fake video is exactly the artefact this product refuses to fabricate.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/tests/screens/CompareScreen.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompareScreen } from "../../src/screens/CompareScreen.js";

const AVATARS = [
  {
    id: "avatar-1",
    createdAt: "2026-09-12T13:23:27.890Z",
    source: "generated" as const,
    mediaType: "image/jpeg",
    description: "A young man with wavy brown hair.",
  },
];

const RUNS = [
  {
    runId: "run-1",
    rubricVersion: "v1",
    model: "claude-opus-5",
    status: "improved_still_failing",
    startedAt: "2026-09-12T13:38:30.943Z",
    finishedAt: "2026-09-12T13:39:08.735Z",
    passes: 3,
  },
];

function row(over: Record<string, unknown> = {}) {
  const side = (s: "before" | "after", o: Record<string, unknown> = {}) => ({
    side: s,
    status: "queued",
    taskId: null,
    submittedAt: null,
    finishedAt: null,
    failureCode: null,
    failure: null,
    estimatedMicroUsd: 411_201,
    actualMicroUsd: null,
    clipUrl: null,
    description: s === "before" ? "raw" : "repaired",
    descriptionSha256: (s === "before" ? "a" : "b").repeat(64),
    rubricVersion: "v1",
    repairerPromptVersion: null,
    polls: 0,
    ...o,
  });
  return {
    comparisonId: "cmp-1",
    createdAt: "2026-09-16T10:00:00.000Z",
    finishedAt: null,
    avatarId: "avatar-1",
    runId: "run-1",
    seconds: 4,
    size: "480x854",
    model: "bytedance/seedance-2.5",
    shotPromptVersion: "v1",
    before: side("before"),
    after: side("after"),
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function routeFetch(handlers: Record<string, () => Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected request: ${key}`);
    return handler();
  });
}

beforeEach(() => {
  fetchMock = routeFetch({
    "GET /avatar": () => json({ avatars: AVATARS }),
    "GET /runs": () => json(RUNS),
    "GET /compare": () => json([]),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CompareScreen", () => {
  it("shows the pair estimate before anything is submitted, derived from the controls", async () => {
    render(<CompareScreen live />);
    await screen.findByText(/A young man with wavy brown hair\./);

    // Default: 480x854 at 4 seconds, two clips.
    expect(await screen.findByTestId("pair-estimate")).toHaveTextContent("$0.82");
  });

  it("re-derives the estimate when the size changes, and never hardcodes it", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    await screen.findByTestId("pair-estimate");

    await user.selectOptions(screen.getByLabelText(/size/i), "720x1280");
    await waitFor(() => expect(screen.getByTestId("pair-estimate")).toHaveTextContent("$1.85"));
  });

  it("keeps submit disabled until an avatar and a run are both chosen", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    const button = await screen.findByRole("button", { name: /render both/i });
    expect(button).toBeDisabled();

    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("submits the four controls and renders the returned pair", async () => {
    const user = userEvent.setup();
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => json(row()),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    await waitFor(() => expect(screen.getByTestId("render-before")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({
      avatarId: "avatar-1",
      runId: "run-1",
      seconds: 4,
      size: "480x854",
    });
  });

  it("shows the server's refusal instead of a pair, and spends nothing further", async () => {
    const user = userEvent.setup();
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json({ error: "run \"run-1\" repaired nothing" }, 400),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    expect(await screen.findByText(/repaired nothing/)).toBeInTheDocument();
    expect(screen.queryByTestId("render-before")).not.toBeInTheDocument();
  });

  it("shows the avatar sheet and says it is never sent to the video model", async () => {
    const user = userEvent.setup();
    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));

    const sheet = await screen.findByAltText(/character sheet/i);
    expect(sheet.getAttribute("src")).toBe("/avatar/avatar-1/image");
    expect(screen.getByText(/never sent to the video model/i)).toBeInTheDocument();
  });

  it("polls an unfinished pair and stops once both sides are terminal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let reads = 0;
    fetchMock = routeFetch({
      "GET /avatar": () => json({ avatars: AVATARS }),
      "GET /runs": () => json(RUNS),
      "GET /compare": () => json([]),
      "POST /compare": () => json(row(), 202),
      "GET /compare/cmp-1": () => {
        reads += 1;
        if (reads < 2) return json(row());
        return json(
          row({
            finishedAt: "2026-09-16T10:02:00.000Z",
            before: { ...row().before, status: "succeeded", clipUrl: "/compare/cmp-1/before/clip" },
            after: { ...row().after, status: "succeeded", clipUrl: "/compare/cmp-1/after/clip" },
          }),
        );
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompareScreen live />);
    await user.click(await screen.findByRole("radio", { name: /avatar-1/i }));
    await user.selectOptions(await screen.findByLabelText(/run/i), "run-1");
    await user.click(screen.getByRole("button", { name: /render both/i }));

    await vi.advanceTimersByTimeAsync(20_000);
    const settled = reads;
    await vi.advanceTimersByTimeAsync(20_000);
    // Both sides terminal, so the interval was cleared and no further read happened.
    expect(reads).toBe(settled);
  });

  it("offers no render button at all in fixture mode", async () => {
    render(<CompareScreen live={false} />);
    expect(await screen.findByText(/needs the real backend/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /render both/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run --config apps/frontend/vitest.config.ts apps/frontend/tests/screens/CompareScreen.test.tsx`
Expected: FAIL — cannot resolve `../../src/screens/CompareScreen.js`.

- [ ] **Step 3: Write `apps/frontend/src/screens/CompareScreen.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_SIZES,
  type ComparisonView,
  type RunSummary,
  type VideoSize,
} from "@ai-director/contract";
import { avatarImageUrl, listAvatars, type AvatarRecord } from "../data/avatarApi.js";
import {
  formatMicroUsd,
  getComparison,
  startComparison,
} from "../data/compareApi.js";
import { ClipPair } from "../components/ClipPair.js";
import { EmptyState } from "../components/EmptyState.js";
import { SectionLabel } from "../components/SectionLabel.js";
import "../styles/compare-screen.css";

/**
 * The fourth screen: the same avatar, rendered twice, where the only variable is the
 * description.
 *
 * ── What it is for ──────────────────────────────────────────────────────────────────
 * The pre-registered failure condition's clause 2 asks whether a repaired description
 * actually reduces identity drift, and no amount of scoring text can answer it. Two clips
 * from one avatar — one from the raw describe output, one from the repaired text, with the
 * size, the seconds, the model and the shot wrapper held identical — is the smallest thing
 * that can.
 *
 * ── The sheet is a reference, not an input ──────────────────────────────────────────
 * The avatar's character sheet is on screen so the eye has something to judge the two
 * clips against. It is never sent to the video model, and the screen says so, because a
 * human likeness in an input image is refused (nine probe calls, 2026-08-25). The person
 * reaches the model as prose and nothing else, which is the whole reason this repo exists.
 *
 * ── Why it polls, and why nothing spins ─────────────────────────────────────────────
 * The run stream carries the nine events spec §6 defines and adding to that list is a spec
 * change, so this screen polls instead. OpenRouter reports no progress fraction, so there
 * is nothing honest to fill a bar with. What is real is that a status read came back: the
 * count of those is what moves.
 */

/** Between reads of an unfinished pair. */
const POLL_MS = 4_000;

async function fetchRuns(): Promise<RunSummary[]> {
  const res = await fetch("/runs");
  if (!res.ok) throw new Error(`could not list runs (status ${res.status})`);
  return (await res.json()) as RunSummary[];
}

export function CompareScreen({ live }: { live: boolean }): React.JSX.Element {
  const [avatars, setAvatars] = useState<AvatarRecord[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(DEFAULT_VIDEO_SECONDS);
  const [size, setSize] = useState<VideoSize>(DEFAULT_VIDEO_SIZE);
  const [comparison, setComparison] = useState<ComparisonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void Promise.all([listAvatars(), fetchRuns()])
      .then(([a, r]) => {
        if (cancelled) return;
        // Only avatars with a description have anything to compare: the description IS the
        // thing under test, and one that was never read off the sheet cannot be rendered.
        setAvatars(a.filter((record) => Boolean(record.description)));
        setRuns(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [live]);

  const avatar = useMemo(
    () => avatars.find((record) => record.id === avatarId) ?? null,
    [avatars, avatarId],
  );

  // A run belongs to the selected avatar when it graded that avatar's description. The run
  // store records no avatar id; this is the only fact that ties them, and the server checks
  // it again before spending anything.
  const runsForAvatar = useMemo(() => (avatar ? runs : []), [avatar, runs]);

  const pairEstimate = useMemo(() => estimateMicroUsd(size, seconds) * 2, [size, seconds]);

  const unfinished = comparison !== null && comparison.finishedAt === null;

  useEffect(() => {
    if (!unfinished || comparison === null) return;
    const id = comparison.comparisonId;
    const timer = setInterval(() => {
      void getComparison(id)
        .then(setComparison)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, POLL_MS);
    // Cleared when both sides settle, when the screen is left, and on unmount. No interval
    // outlives this component.
    return () => clearInterval(timer);
  }, [unfinished, comparison?.comparisonId]);

  const submit = useCallback(async () => {
    if (!avatarId || !runId) return;
    setError(null);
    setSubmitting(true);
    try {
      setComparison(await startComparison({ avatarId, runId, seconds, size }));
    } catch (err) {
      setComparison(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [avatarId, runId, seconds, size]);

  if (!live) {
    return (
      <div className="compare-screen">
        <EmptyState
          title="Compare needs the real backend"
          body="Both clips are paid renders. There is no fixture for them, because a plausible-looking fake video is exactly the artefact this tool refuses to produce. Start the server with OPENROUTER_API_KEY set."
        />
      </div>
    );
  }

  return (
    <div className="compare-screen">
      <SectionLabel>Avatar</SectionLabel>
      <div className="compare-screen__avatars" role="radiogroup" aria-label="Avatar">
        {avatars.map((record) => (
          <button
            key={record.id}
            type="button"
            role="radio"
            aria-checked={record.id === avatarId}
            aria-label={record.id}
            className="compare-screen__avatar"
            data-selected={record.id === avatarId || undefined}
            onClick={() => setAvatarId(record.id)}
          >
            <img src={avatarImageUrl(record.id)} alt={`${record.id} character sheet`} />
            <span>{record.description}</span>
          </button>
        ))}
      </div>

      {avatar ? (
        <p className="compare-screen__sheet-note">
          The sheet above is the reference your eye judges the two clips against. It is{" "}
          <strong>never sent to the video model</strong>: a human likeness in an input image
          is refused, so the person reaches the render as prose and nothing else.
        </p>
      ) : null}

      <SectionLabel>Run</SectionLabel>
      <label className="compare-screen__field">
        <span>Run</span>
        <select
          value={runId ?? ""}
          onChange={(event) => setRunId(event.target.value || null)}
          disabled={!avatar}
        >
          <option value="">Choose a run</option>
          {runsForAvatar.map((run) => (
            <option key={run.runId} value={run.runId}>
              {run.runId.slice(0, 8)} — {run.status}, {run.passes} passes
            </option>
          ))}
        </select>
      </label>

      <div className="compare-screen__controls">
        <label className="compare-screen__field">
          <span>Seconds</span>
          <input
            type="number"
            min={MIN_VIDEO_SECONDS}
            max={MAX_VIDEO_SECONDS}
            step={1}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
          />
        </label>
        <label className="compare-screen__field">
          <span>Size</span>
          <select value={size} onChange={(event) => setSize(event.target.value as VideoSize)}>
            {VIDEO_SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="compare-screen__estimate">
        Two clips, estimated <strong className="tnum" data-testid="pair-estimate">
          {formatMicroUsd(pairEstimate)}
        </strong>
        . Pressing the button spends it. What OpenRouter actually bills appears on each clip
        when it finishes.
      </p>

      <button
        type="button"
        className="compare-screen__submit"
        disabled={!avatarId || !runId || submitting || unfinished}
        onClick={() => void submit()}
      >
        Render both
      </button>

      {/* Not `ErrorPanel`: that component's copy is about a RUN ("this run can resume from
          where it stopped"), which is the wrong claim here — a refused comparison has
          submitted nothing and a failed one must never be resumed. */}
      {error ? (
        <p className="compare-screen__error" role="alert">
          {error}
        </p>
      ) : null}

      {comparison ? <ClipPair comparison={comparison} /> : null}
    </div>
  );
}
```

`EmptyState` and `SectionLabel` already exist in `apps/frontend/src/components/`. `EmptyState` takes `{ title, body, action? }`, which is what is used above; `SectionLabel` takes children. Neither is modified. `ErrorPanel` is deliberately not reused — see the comment in the JSX.

Add the error style to `compare-screen.css`:

```css
.compare-screen__error {
  margin: 0;
  padding: var(--space-3, 12px);
  border: 1px solid var(--band-1);
  border-radius: var(--radius-sm, 4px);
  color: var(--ink);
  font-size: 0.8125rem;
}
```

- [ ] **Step 4: Add the screen's own control styles**

Append to `apps/frontend/src/styles/compare-screen.css`:

```css
.compare-screen__avatars {
  display: flex;
  gap: var(--space-3, 12px);
  overflow-x: auto;
  padding-bottom: var(--space-2, 8px);
}

.compare-screen__avatar {
  display: grid;
  gap: var(--space-2, 8px);
  width: 220px;
  flex: 0 0 auto;
  padding: var(--space-2, 8px);
  background: var(--sf-panel);
  border: 1px solid var(--ln);
  border-radius: var(--radius-md, 8px);
  color: var(--ink-2);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.compare-screen__avatar[data-selected] {
  border-color: var(--brand-edge);
  background: var(--brand-tint);
  color: var(--ink);
}

.compare-screen__avatar img {
  width: 100%;
  border-radius: var(--radius-sm, 4px);
}

.compare-screen__sheet-note,
.compare-screen__estimate {
  margin: 0;
  color: var(--ink-2);
  font-size: 0.8125rem;
  max-width: 62ch;
}

.compare-screen__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4, 16px);
}

.compare-screen__field {
  display: grid;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.compare-screen__field select,
.compare-screen__field input {
  padding: 6px 8px;
  background: var(--sf-field);
  border: 1px solid var(--ln);
  border-radius: var(--radius-sm, 4px);
  color: var(--ink);
  font: inherit;
  text-transform: none;
  letter-spacing: normal;
}

.compare-screen__submit {
  justify-self: start;
  padding: 8px 16px;
  background: var(--brand);
  border: 0;
  border-radius: var(--radius-sm, 4px);
  color: var(--brand-ink);
  font-weight: 600;
  cursor: pointer;
}

.compare-screen__submit:disabled {
  background: var(--sf-hover);
  color: var(--ink-3);
  cursor: not-allowed;
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run --config apps/frontend/vitest.config.ts apps/frontend/tests/screens/CompareScreen.test.tsx`
Expected: PASS, every case.

- [ ] **Step 6: Run the whole suite and look at the screen**

Run: `npm test && npm run typecheck`
Expected: green.

Then `npm run dev` and open `http://localhost:5173/compare`. With no `OPENROUTER_API_KEY` set, the screen renders, the avatars load, and pressing the button returns the 503 reason. **Do not set the key yet.** Task 11 is where money is spent, deliberately and once.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/screens/CompareScreen.tsx apps/frontend/src/styles/compare-screen.css \
  apps/frontend/tests/screens/CompareScreen.test.tsx
git commit -m "feat(video): the Compare screen — pick, estimate, submit, poll

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# Phase 5 — The comparison CLI, built for the owner to run

### Task 11: `npm run compare`, one pair at 480x854 x 4s, and the decision log

**Files:**
- Create: `apps/backend/src/cli/compare.ts`
- Modify: `package.json`
- Modify: `docs/architecture.md`
- Modify: `docs/decision-log.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run compare -- --avatar <id> --run <id> [--seconds 4] [--size 480x854]`.

**Running this CLI costs about $0.82, and the owner is the one who runs it. The implementing agent never does.** It is gated the way `cli/bias.ts` is gated, and for the same reason recorded in the decision log: so it cannot run by accident. It requires **both** `RUN_LIVE_API=1` **and** `OPENROUTER_API_KEY`, prints the estimate, and does not submit until the operator types `yes`.

**Who runs it.** The standing instruction in this project is that the owner runs the paid calls. The agent implementing this task writes the CLI, proves it with a dry run that submits nothing, and stops. The owner runs the real one and hands back the numbers.

- [ ] **Step 1: Write `apps/backend/src/cli/compare.ts`**

```ts
import { createInterface } from "node:readline/promises";
import {
  DEFAULT_VIDEO_SECONDS,
  DEFAULT_VIDEO_SIZE,
  estimateMicroUsd,
  isValidVideoSeconds,
  VIDEO_SIZES,
  type VideoSize,
} from "@ai-director/contract";
import { readComparisonSources } from "../compare/readSources.js";
import { driveComparison, startComparison } from "../compare/runComparison.js";
import { FileAvatarStore } from "../store/AvatarStore.js";
import { FileComparisonStore } from "../store/ComparisonStore.js";
import { FileRunStore } from "../store/FileRunStore.js";
import {
  createOpenRouterVideoTransport,
  openrouterContentUrl,
  submitProvablyUnbilled,
} from "../video/openrouterClient.js";

/**
 * One real pair, from the command line.
 *
 * ── Gated twice, on purpose ─────────────────────────────────────────────────────────
 * `RUN_LIVE_API=1` AND `OPENROUTER_API_KEY`, exactly as `cli/bias.ts` is gated and for the
 * reason the decision log gives: so it cannot run by accident. Then a typed confirmation,
 * because this one spends about $0.82 rather than reading a file.
 *
 * ── --dry-run ───────────────────────────────────────────────────────────────────────
 * Resolves the two descriptions, prints the estimate and the prompts, and exits without
 * calling OpenRouter. This is what proves the CLI works before the real one is run.
 */

try {
  process.loadEnvFile();
} catch {
  // No .env file; environment variables are expected to be set some other way.
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

async function main(): Promise<void> {
  const avatarId = arg("avatar");
  const runId = arg("run");
  const dryRun = process.argv.includes("--dry-run");
  const seconds = Number(arg("seconds") ?? DEFAULT_VIDEO_SECONDS);
  const size = (arg("size") ?? DEFAULT_VIDEO_SIZE) as VideoSize;

  if (!avatarId || !runId) {
    throw new Error(
      "usage: npm run compare -- --avatar <avatarId> --run <runId> [--seconds 4] [--size 480x854] [--dry-run]",
    );
  }
  if (!isValidVideoSeconds(seconds)) throw new Error(`seconds must be a whole number 4..30`);
  if (!(VIDEO_SIZES as readonly string[]).includes(size)) {
    throw new Error(`size must be one of ${VIDEO_SIZES.join(", ")}`);
  }

  const sources = await readComparisonSources(
    { runStore: new FileRunStore("data/runs"), avatarStore: new FileAvatarStore("data/avatars") },
    { runId, avatarId },
  );
  if (!sources.ok) throw new Error(sources.reason);

  const perClip = estimateMicroUsd(size, seconds);
  console.log(`before: ${sources.sources.before.description}`);
  console.log(`after:  ${sources.sources.after.description}`);
  console.log(`\n${size} x ${seconds}s, two clips: about ${usd(perClip * 2)} in total.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing was submitted and nothing was billed.");
    return;
  }

  if (process.env.RUN_LIVE_API !== "1") {
    throw new Error("refusing to spend: set RUN_LIVE_API=1 to make real renders");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("refusing to spend: OPENROUTER_API_KEY is not set");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Submit two paid renders for ${usd(perClip * 2)}? type yes: `);
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("nothing submitted.");
    return;
  }

  const store = new FileComparisonStore("data/comparisons");
  const transport = createOpenRouterVideoTransport();
  const created = await startComparison(
    { store, transport },
    {
      avatarId,
      runId,
      seconds,
      size,
      rubricVersion: sources.rubricVersion,
      repairerPromptVersion: sources.repairerPromptVersion,
      sources: sources.sources,
    },
  );
  console.log(`comparison ${created.comparisonId}, polling...`);

  const done = await driveComparison({ store, transport }, created.comparisonId);

  for (const side of ["before", "after"] as const) {
    const render = done[side];
    console.log(
      `\n${side}: ${render.status}` +
        `\n  task    ${render.taskId ?? "none"}` +
        `\n  content ${render.taskId ? openrouterContentUrl(render.taskId) : "none"}` +
        `\n  clip    ${render.clipUrl ?? "not downloaded"}` +
        `\n  polls   ${render.polls}` +
        `\n  est     ${usd(render.estimatedMicroUsd)}` +
        `\n  billed  ${render.actualMicroUsd === null ? "not reported" : usd(render.actualMicroUsd)}` +
        (render.failure ? `\n  failure ${render.failureCode}: ${render.failure}` : ""),
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Whether a failed submit can safely be retried anywhere is a money question, so it is
  // printed rather than inferred by whoever reads the error.
  const safe = submitProvablyUnbilled(err);
  console.error(`compare: ${message}`);
  console.error(safe ? "nothing was billed by this failure." : "this failure MAY have been billed; do not resubmit.");
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In the root `package.json`, beside `"agree"`:

```json
    "compare": "tsx apps/backend/src/cli/compare.ts",
```

- [ ] **Step 3: Prove it with a dry run, which spends nothing**

Run, against the run and avatar already on disk:

```bash
npm run compare -- \
  --avatar eaa18108-4b38-408f-b683-2fc897ce2537 \
  --run bee3bcd6-3f0d-4b43-9a86-efc03a58b051 \
  --dry-run
```

Expected: it prints the pass-1 description ("A young man in his mid-twenties with wavy brown hair, green eyes, light stubble and fair skin, of average build and medium height, wearing a black crewneck sweater, dark jeans and black leather shoes."), the pass-3 description (the one with the mole, the scar and the silver ring), and `480x854 x 4s, two clips: about $0.82 in total.` No network call is made.

- [ ] **Step 4: Run the whole suite and commit the CLI**

Run: `npm test && npm run typecheck`
Expected: green.

```bash
git add apps/backend/src/cli/compare.ts package.json
git commit -m "feat(video): npm run compare, gated on RUN_LIVE_API and a typed confirmation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: STOP. The owner runs the paid one.**

Hand over exactly this, and do not run it yourself:

```bash
RUN_LIVE_API=1 npm run compare -- \
  --avatar eaa18108-4b38-408f-b683-2fc897ce2537 \
  --run bee3bcd6-3f0d-4b43-9a86-efc03a58b051
```

with `OPENROUTER_API_KEY` in `.env`. It asks for a typed `yes` before it submits. Expect about $0.82 and two to six minutes.

What to bring back: the two billed figures, the two task ids, whether either side was refused, and — the actual question — whether the "after" clip looks more like the character sheet than the "before" one does.

- [ ] **Step 6: Write down what it measured**

Append to `docs/decision-log.md`, filling in only figures the run actually produced. If a number is not in hand, leave it out; do not estimate into this entry.

```markdown
## 2026-09-16 — First render comparison: <n> clips, <$x.xx> billed

<Fill from the run.> Estimated $0.82 for the pair at 480x854 for four seconds; OpenRouter
billed <before> and <after>, which is <a figure or "within/above/below"> the published rate
of 10.7 micro-USD per video token.

The two descriptions were the pass-1 and pass-3 text of run `bee3bcd6`, rendered with the
same size, the same duration, the same model and the same shot prompt v1. No image was sent
on either side.

What the clips showed: <the honest answer, including "no visible difference" if that is it>.

This is one pair. It is not a drift measurement and it must not be quoted as one: a drift
metric needs the same description rendered repeatedly, which is item 4 of
`docs/superpowers/plans/2026-09-13-what-is-left.md` and has not been done. What this closes
is narrower — that the render comparison failure-condition clause 2 asks for is now
runnable at all, which the 2026-09-11 entry recorded as unbuildable.
```

- [ ] **Step 7: Add the two rows to `docs/architecture.md`**

In the §3 screens table, add:

```
| Compare | `apps/frontend/src/screens/CompareScreen.tsx` | The same avatar rendered twice, before and after the repair passes, with everything but the description held identical. The only screen that spends a render credit, and it grades nothing |
```

In the §5 "Mentic / Here / Copied how" table, add:

```
| `lib/openrouter/seedance-pricing.ts` | `packages/contract/src/video.ts` | Formula and both constants, near-verbatim |
| `lib/openrouter/video-client.ts` | `apps/backend/src/video/openrouterClient.ts` | Same endpoints and status map; the result type narrowed, since there is no second transport to unify with |
| `lib/video-lab/render-ugc.ts` claim discipline | `apps/backend/src/compare/runComparison.ts` | Same three rules; the compare-and-swap is an atomic `wx` file rather than a Prisma predicate |
```

And in §5's "What is deliberately not reproduced" paragraph, append: *"Mentic's provider setting and its two-transport routing (`lib/video-lab/ugc-provider.ts`) are also absent: there is one transport here, so a setting that could select between two would be machinery for a choice nobody can make. What survives from that file is its rule — the provider is decided at submit and every later read dispatches on what the row records, never on a setting that may have changed since."*

- [ ] **Step 8: Commit**

```bash
git add docs/decision-log.md docs/architecture.md
git commit -m "docs: record the first render comparison, and what it does not prove

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes for the executor

Three things that are easy to get wrong and are checked at review:

1. **The two prompts must differ only in the description.** Task 6's test asserts this by stripping each description out and comparing what is left. If that assertion is ever weakened, the screen stops measuring anything.
2. **`actualMicroUsd` is never written from `estimateMicroUsd`.** Grep for it before committing Phase 2: the estimate appears only in `startComparison`, and the bill only in `applyCheck`.
3. **No side is ever submitted twice.** The claim is taken before `transport.submit` and never released, and `driveComparison`'s "NEVER resubmits" test is the one that proves it. If that test needs changing to accommodate an implementation, the implementation is wrong.
