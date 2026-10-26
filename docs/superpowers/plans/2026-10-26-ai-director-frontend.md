# AI Director, Part 2: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Director tab where the owner types a brief, answers Gate A, approves the plan at Gate B, watches four steps run at once, reviews the final prompt and price at Gate C, renders, and sees the ad. Every state on the board, including the failures, is a real screen.

**Architecture:** One screen, `DirectorScreen`, at `/director?drun=<id>`. It loads a run's `DirectorRunView` once, then applies each SSE event with the same pure `applyDirectorEvent` the backend uses, so the screen and the server can never disagree. The left column is the run graph; the right panel shows the selected node's output or, when the run is waiting, that gate's form. Everything is built against a `FixtureDirectorClient` first and swapped to HTTP in one line, as the coach screens were.

**Tech Stack:** React 19, Vite 8, `motion`, vitest + Testing Library (jsdom), Playwright for one end-to-end walk.

**Spec:** The UI board, https://claude.ai/artifact/LGaV9nbrJet93jH8VMkgAX ("All screens" page: S01–S06, S01b, S03b, F1–F4, and the screen flow page). Backend contract and routes: `docs/superpowers/plans/2026-10-26-ai-director-backend.md` Tasks 1, 2 and 12. Design: `docs/ai-director-design.html`.

**Depends on:** Part 1 Tasks 1 and 2 (contract) before any task here; Part 1 Task 12 (routes) before Task 10 here.

---

## Global Constraints

- Every rule in `CLAUDE.md`, in particular: **motion only on real state changes, no ambient or looping animation**. A running node shows elapsed seconds as text; no spinner, no pulse.
- **The UI never shows a success state for a non-success.** Only `rendered` gets the green word and the brand fill. `rejected`, `stopped`, `render_failed`, `failed` and a character that did not pass are never green.
- The alarm fill (`--sig-alarm-*`) is reserved for terminal failure (F2, F3), as in `tokens.css`.
- **Nothing spends money without a button that says the price.** The only spend is Gate C's `Render <n> s · $<price>` (and F3's `Render again · …`). Label beside it: "Pressing this spends it." Both disable permanently on press.
- **Nothing in the plan or prompt is editable in the UI.** What was approved is what renders.
- Copy rules from the board, verbatim where quoted below. Sentence case. No emoji.
- Price: `formatMicroUsd(estimateMicroUsd(DIRECTOR_VIDEO_SIZE, seconds))` (`apps/frontend/src/data/compareApi.ts`, `packages/contract/src/video.ts`).
- Check labels come from `DIRECTOR_CHECK_LABELS` in the contract, never retyped.
- Types that cross the network come from `@ai-director/contract` only.
- Commits go on `main`. No branches.

## Review Focus

1. **Reload at any gate** restores the same screen, including Gate A's typed but unsent text (kept in `sessionStorage`, wrapped in try/catch). Test in Task 3.
2. **SSE drops mid-run**: the hook reconnects with `Last-Event-ID` and does not apply an event twice (seq guard). Test in Task 3.
3. **Double click on Render** sends one request; the button is disabled from the first click until the run leaves Gate C. Test in Task 8.
4. **A product photo over 6 MB or not an image** is refused in the browser with the reason, before upload. Test in Task 5.
5. **Narrow window (<1024 px)**: the graph becomes a list (the existing `StageList` pattern) and the panel stacks below it. Test in Task 4.

---

## File structure

```
apps/frontend/src/
  App.tsx, components/ScreenTabs.tsx        + "director" screen, tab, gate pip
  vite.config.ts                            + "/director" proxy (apiProxy, which already bypasses page navigations)
  data/DirectorClient.ts                    interface
  data/HttpDirectorClient.ts                fetch + EventSource
  data/FixtureDirectorClient.ts             replays fixture event logs
  data/directorFixtures.ts                  event logs for every board state
  hooks/useDirectorRun.ts                   snapshot + SSE, folded with applyDirectorEvent
  domain/directorDerive.ts                  graph node props, timeline rows, log rows, gate copy (pure)
  screens/DirectorScreen.tsx
  styles/director-screen.css
  components/director/
    BriefBar.tsx  DirectorGraph.tsx  DirectorNode.tsx  GateBar.tsx  StageListDirector.tsx
    DirectorRunList.tsx  ArtefactPanel.tsx
    GateAForm.tsx  ProductPhotoField.tsx  LengthField.tsx  CastChoice.tsx
    PlanView.tsx  ChecksList.tsx  GateBActions.tsx  RejectDialog.tsx
    CharacterArtefact.tsx  ImageArtefact.tsx  DirectorTimeline.tsx  DirectorEventLog.tsx
    AttemptHistory.tsx  StopBanner.tsx
    GateCReview.tsx  FinalPromptView.tsx  RenderButton.tsx  AcceptNotPassed.tsx
    RenderingPanel.tsx  RenderedPanel.tsx  RenderFailedPanel.tsx
apps/frontend/tests/  mirrors src;  apps/frontend/e2e/director.spec.ts
docs/how-i-built-the-ai-director.md
```

Components live under `components/director/` because there are many and they change together; every other convention (one component per file, CSS in `styles/<screen>.css`, tests under `tests/components/`) follows the existing app.

---

### Task 1: A Director tab that opens a screen

**Files:**
- Modify: `apps/frontend/src/App.tsx`, `apps/frontend/src/components/ScreenTabs.tsx`, `apps/frontend/vite.config.ts`
- Create: `apps/frontend/src/screens/DirectorScreen.tsx` (placeholder body), `apps/frontend/src/styles/director-screen.css`
- Test: `apps/frontend/tests/App.test.tsx`, `apps/frontend/tests/components/ScreenTabs.test.tsx`

**Interfaces:**
- Produces: `Screen` gains `"director"`; `PATH_BY_SCREEN.director = "/director"`; `screenFromPath` maps `/director*`; `ScreenTabs` prop `gateWaiting: GateId | null` renders a pip with the letter and `aria-label="gate <X> is waiting for you"`.

- [ ] **Step 1: Write the failing tests**: clicking "Director" navigates to `/director` and renders the Director screen heading; `ScreenTabs` with `gateWaiting="B"` shows a pip reading "B" with that aria-label; the other four tabs are unchanged.
- [ ] **Step 2: Run** `npm run test:web -- tests/App.test.tsx tests/components/ScreenTabs.test.tsx` → FAIL.
- [ ] **Step 3: Implement**; add `"/director": apiProxy()` to the proxy map (its navigation bypass is what keeps a reload at `/director` from hitting Fastify, see the comment at the top of `vite.config.ts`).
- [ ] **Step 4: Run** → PASS, `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): a Director tab"`

---

### Task 2: The data layer and fixtures for every board state

**Files:**
- Create: `apps/frontend/src/data/DirectorClient.ts`, `HttpDirectorClient.ts`, `FixtureDirectorClient.ts`, `directorFixtures.ts`
- Test: `apps/frontend/tests/data/HttpDirectorClient.test.ts`, `FixtureDirectorClient.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DirectorClient {
  readonly isFixture: boolean;
  start(brief: string): Promise<{ id: string }>;
  list(): Promise<DirectorRunSummary[]>;
  get(id: string): Promise<DirectorRunView>;
  subscribe(id: string, afterSeq: number, onEvent: (ev: DirectorEvent) => void, onError: (e: Error) => void): () => void;
  output<T>(id: string, ref: string): Promise<T>;
  assetUrl(id: string, ref: string): string;
  clipUrl(id: string, attempt: number): string;
  answerA(id: string, body: { photo: { imageBase64: string; mediaType: string }; productKind: string; seconds: number;
    mustNotAppear: string[]; cast: CastChoice }): Promise<void>;
  answerB(id: string, body: { decision: "approve" } | { decision: "reject"; reason: string }): Promise<void>;
  answerC(id: string, body: { decision: "render"; acceptNotPassed?: boolean } | { decision: "reject"; reason: string }): Promise<void>;
  renderAgain(id: string): Promise<void>;
}
export class DirectorHttpError extends Error { constructor(message: string, readonly status: number) }
```

- `HttpDirectorClient(baseUrl = "")` maps each method to the Part 1 Task 12 route; non-2xx → `DirectorHttpError` carrying the server's `error` text. `subscribe` uses `EventSource` on `/director/runs/:id/events` (the browser sends `Last-Event-ID` on reconnect itself).
- `directorFixtures.ts` exports `DIRECTOR_FIXTURES: Record<DirectorScenario, DirectorEvent[]>` and node outputs, with `DirectorScenario = "start" | "gateA" | "routedBack" | "gateB" | "parallel" | "gateC" | "gateCNotPassed" | "rendering" | "rendered" | "stopped" | "renderFailed" | "rejected"`, one per board screen. Product-specific text uses the board's placeholders (`[PRODUCT]`), no invented product.
- `FixtureDirectorClient({ scenario, speedMs })` replays the scenario's events on a timer; gate answers append the next scenario's events, so the e2e walk can click through S01 → S06.

- [ ] **Step 1: Write the failing tests**: HTTP client posts the right body to the right path (stub `fetch`); 409 body becomes `DirectorHttpError` with status 409; fixture client replays `gateB` and ends with `waitingAt === "B"` after folding with `reduceDirectorEvents`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): a client for the Director routes, and fixtures for every screen"`

---

### Task 3: `useDirectorRun`: snapshot, then live

**Files:**
- Create: `apps/frontend/src/hooks/useDirectorRun.ts`
- Modify: `apps/frontend/src/App.tsx` (own the hook, as it owns `useRunStream`, so the tab pip works on every screen)
- Test: `apps/frontend/tests/hooks/useDirectorRun.test.ts`

**Interfaces:**
- Produces: `useDirectorRun(client: DirectorClient, runId: string | null): { view: DirectorRunView | null; events: DirectorEvent[]; error: Error | null; connection: "idle" | "live" | "reconnecting" | "closed" }`.

Behaviour: `get` once, then `subscribe(afterSeq = view.lastSeq)`; each event with `seq <= lastSeq` is dropped (guard against replay overlap), else `applyDirectorEvent`. Terminal status closes the stream. `events` is kept for the log and timeline. The run id lives in the URL as `?drun=`, written with `history.replaceState` like `writeRunParam` in `App.tsx`.

- [ ] **Step 1: Write the failing tests**: replays and live events fold to the same view as `reduceDirectorEvents(all)`; an event delivered twice is applied once; `onError` → `connection: "reconnecting"` then back to `"live"`; terminal → `"closed"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): a run's view loads once, then follows its events"`

---

### Task 4: The run graph (board component "Run graph")

**Files:**
- Create: `components/director/DirectorGraph.tsx`, `DirectorNode.tsx`, `GateBar.tsx`, `StageListDirector.tsx`, `apps/frontend/src/domain/directorDerive.ts`
- Test: `apps/frontend/tests/components/director/DirectorGraph.test.tsx`, `apps/frontend/tests/domain/directorDerive.test.ts`

**Interfaces:**
- Produces: `deriveGraph(view: DirectorRunView): GraphRow[]` (pure) and `<DirectorGraph view selected onSelect />`.

Layout and copy are the board's `Graph.dc.html`: rows Interrogator · Gate A · Director, Plan checks, Router · Gate B · a dashed band "In parallel · started together" holding Product picture, Location picture, Character, 3 · Cinematographer · Assembler, Prompt checks, Router · Gate C · Seedance 2.5. Each node shows its kind line ("Agent · new", "Code", "Image model", "Prompt Coach · reused", "Video model"), label, state word and one note. State words: Queued, Running, Done, Done with a warning, Sent back, Stopped, Not reached, Skipped; gates: Locked, Your turn, Done, Not reached. Router nodes are derived from `route.sent` events (no node id of their own). A node that was routed shows "Retry n of 2". A running node shows elapsed seconds as text, updated once a second (a real state change; no animation). Reuse the `.node` look from `architecture-screen.css` by moving the shared rules to a `node.css` both screens import.

- [ ] **Step 1: Write the failing tests**: `deriveGraph` on the `gateB`, `parallel`, `routedBack` and `stopped` fixtures gives the board's words for every node; a character whose outcome did not pass reads "Done with a warning", never "Done"; the four branch nodes render inside one element with the text "In parallel"; at 900 px wide (`matchMedia` stub) the list renders instead of the graph.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): the run graph, with the parallel band and gates on it"`

---

### Task 5: S01 Start, S01b Past runs, S02 Gate A

**Files:**
- Create: `components/director/BriefBar.tsx`, `DirectorRunList.tsx`, `GateAForm.tsx`, `ProductPhotoField.tsx`, `LengthField.tsx`, `CastChoice.tsx`
- Modify: `apps/frontend/src/screens/DirectorScreen.tsx`
- Test: `apps/frontend/tests/components/director/{BriefBar,DirectorRunList,GateAForm}.test.tsx`

**Interfaces:**
- `BriefBar`: before a run, label "Your brief", input, `Start run`, `Past runs`; during a run, the read-only strip: brief, status pill ("Waiting for you at Gate A/B/C", "Running · 4 steps at once", "Rendering", "Rendered", "Stopped", "Render failed", "Rejected"), Length, Render estimate, Text so far, Elapsed.
- `DirectorRunList`: columns Brief · Started · Where it is · Length · Text cost · Render billed · Open. "Where it is" uses the status words above; only `rendered` gets `chip--pass`.
- `GateAForm` (S02): "Decided for you" table from the Interrogator output (Audience, Tone, Setting, Character); then the four numbered fields in the board's order and copy:
  1. "Your product photo": drop zone + "Choose a file"; hint "The product on its own. No people in the photo. JPEG, PNG or WebP, up to 6 MB." Reuse the FileReader / `splitDataUrl` pattern from `SheetPipeline.tsx`. Refuse other types or > 6 MB inline, before sending.
  2. "Length in seconds": number 4–30 (`isValidVideoSeconds`), prefilled from `suggestedSeconds` or 15; live line "About $X at 720×1280 for N s. Charged only if you press Render at Gate C."
  3. "What must not appear (optional)": textarea, split on commas and new lines.
  4. "Who plays the character": "One of my avatars" (default; reuse `AvatarPicker`, only avatars with a description, each with its last coach result chip) or "Cast a new one from the brief" with hint "Slower. Makes one avatar sheet, then runs the Prompt Coach on it."
  Product kind is a small text input under the photo, prefilled from the Interrogator's `productKind`. Submit: "Continue to the Director". Unsent values persist in `sessionStorage` per run id.

- [ ] **Step 1: Write the failing tests**: Start posts the brief and writes `?drun=`; Past runs row for a `stopped` run is not green; a 7 MB file shows the refusal and `answerA` is not called; length 3 is refused with "4 to 30 seconds"; the price line updates when length changes; reload restores typed Gate A text.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): start a run, see past runs, answer Gate A"`

---

### Task 6: S03 Gate B, S03b Reject, F1 Sent back

**Files:**
- Create: `components/director/PlanView.tsx`, `ChecksList.tsx`, `GateBActions.tsx`, `RejectDialog.tsx`, `AttemptHistory.tsx`
- Test: `apps/frontend/tests/components/director/{PlanView,GateBActions,RejectDialog,AttemptHistory}.test.tsx`

**Interfaces:**
- `PlanView({ plan, seconds })`: "Style line, pasted word for word into the prompt" (mono box); Assets table (Handle · Kind · Role · Sent as, where product and location read "Reference image n" and the character "Text only"); note "n of at most 5 reference images. The character is never sent as a picture: Seedance refuses faces."; Shots table (# · Action · Weight · ≈ s · Sound); note "Short is 2 s, normal 3 s, long 4 s. These add up to N s, the length you chose."
- `ChecksList({ outcomes, title })`: one row per outcome, label from `DIRECTOR_CHECK_LABELS`, Pass/Fail chip, `detail` under it, header chip "k of n passed".
- `GateBActions`: `Reject…` (opens `RejectDialog`) and "Free. Starts the pictures, the character and the camera." + `Approve plan`.
- `RejectDialog`: a real dialog (`role="dialog"`, `aria-modal`, focus trapped, Escape closes): title "Reject this plan?", text "The run ends here. Nothing has been generated, so nothing has been spent on pictures or video.", required textarea "Why are you rejecting it?", buttons "Keep reviewing" / "Reject and end the run". At Gate C the second sentence reads "The pictures are kept; no video has been made."
- `AttemptHistory({ node, attempts })`: for a routed node, each attempt with its failure, and a word diff of only the patched shots using `diffWords` (`domain/diffWords.ts`); the line "Shots a, b and c: identical to attempt n."

- [ ] **Step 1: Write the failing tests**: Approve calls `answerB({decision:"approve"})` once; Reject with an empty reason is disabled; the routed-back fixture shows "Retry 1 of 2" and a diff containing the removed "(2–4s)"; check labels match the contract's.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): review and approve the plan, or reject it with a reason"`

---

### Task 7: S04 In parallel, and the evidence of it

**Files:**
- Create: `components/director/ArtefactPanel.tsx`, `CharacterArtefact.tsx`, `ImageArtefact.tsx`, `DirectorTimeline.tsx`, `DirectorEventLog.tsx`
- Test: `apps/frontend/tests/components/director/{DirectorTimeline,CharacterArtefact,ArtefactPanel}.test.tsx`

**Interfaces:**
- `ArtefactPanel({ view, node })`: the selected node's output (loaded with `client.output`), calls (model · tokens · cost · latency, one `MetricRow` per `CallLog`) and a raw input/output toggle using `PayloadViewer` (NFR-2).
- `CharacterArtefact`: avatar sheet thumbnail, coach pass "Pass k of 3", the four step chips, the coach's terminal word via `verdictWord`, and a link "Open this pass on the Run screen" to `/?run=<coachRunId>`.
- `DirectorTimeline({ events })`: one bar per node attempt on a shared time axis from `node.started` to `node.completed`/`failed`; gates as grey bars; a caption "Bars that start on the same line ran at the same time." This is done-criterion 2's evidence.
- `DirectorEventLog({ events })`: `+mm:ss.s · type · node · attempt · tokens · cost`, newest at the bottom, `route.sent` rows in the warning colour.

- [ ] **Step 1: Write the failing tests**: on the `parallel` fixture the four branch bars share one start x; the character link points at the coach run id; a `CallLog` with `microUsd: null` shows "not measured", never "$0.00".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): what each step made, and a timeline that shows them running together"`

---

### Task 8: S05 Gate C and F4, the only button that spends

**Files:**
- Create: `components/director/GateCReview.tsx`, `FinalPromptView.tsx`, `RenderButton.tsx`, `AcceptNotPassed.tsx`
- Test: `apps/frontend/tests/components/director/{GateCReview,FinalPromptView,RenderButton}.test.tsx`

**Interfaces:**
- `GateCReview`: "Reference images · n of at most 5" (the owner's photo, then each reference image with its "Reference image n · @handle" chip, loaded with `client.assetUrl`); "Character · sent as text" with the coach chip; "Final prompt" via `FinalPromptView`; the prompt `ChecksList`; the price box "Seedance 2.5 · N s · 720×1280 · with sound" + price + "An estimate from the published rate. What OpenRouter actually bills is shown after the render."; `Reject…` and `RenderButton`.
- `FinalPromptView({ text, styleLine, characterDescription })`: mono, `white-space: pre-wrap`; the style line and character description wrapped in `<mark>` found with `indexOf` (never by model offsets), legend "Marked = pasted from the plan, byte for byte".
- `RenderButton({ seconds, disabled, onRender })`: label `Render N s · $X`, hint "Pressing this spends it."; disables on first click until the run's status changes; a 409 from the server shows "A render for this run has already started."
- `AcceptNotPassed` (F4): amber box "The character description did not pass", the coach's still-failing checks with their quotes, link to the Run screen, and the checkbox "I accept a character description that did not pass" with hint "Required before Render works. Saved with the run." `RenderButton` is disabled until it is ticked, and the request carries `acceptNotPassed: true`.

- [ ] **Step 1: Write the failing tests**: double click → `answerC` once; a character not passed → Render disabled until the box is ticked, then the request has `acceptNotPassed: true`; marks wrap exactly the style line and character text; price for 15 s reads `$3.47`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): Gate C shows exactly what will render and what it costs"`

---

### Task 9: S05b Rendering, S06 Rendered, F2 Stopped, F3 Render failed

**Files:**
- Create: `components/director/RenderingPanel.tsx`, `RenderedPanel.tsx`, `RenderFailedPanel.tsx`, `StopBanner.tsx`
- Test: `apps/frontend/tests/components/director/{RenderingPanel,RenderedPanel,RenderFailedPanel,StopBanner}.test.tsx`

**Interfaces:**
- `RenderingPanel`: "Rendering your ad"; status from OpenRouter, elapsed (text), "Checked every 5 s · n times", task id; "You can close this tab. The render keeps going on OpenRouter, and this page picks it up when you come back. It is never sent twice."; "What was sent" table (model, length · size, reference images, prompt sha256, estimated cost).
- `RenderedPanel`: banner "Rendered"; `<video controls>` with no autoplay and no loop (markup from `ClipPair`), caption "Synthetic person, AI-generated."; `CostReadout` (Estimated / Billed) plus text cost; the three hand checkboxes "Every planned shot appears, in order", "Each shot has its planned camera move", "The product is where the plan put it" (kept in the run's `sessionStorage` only; the write-up records them); `Download` and `New run`.
- `RenderFailedPanel`: alarm banner "Render failed" + "The plan, pictures and prompt are all kept. Only the video is missing."; OpenRouter's message verbatim; one billing line by `billing`: `not_billed` "Refused before it ran", `billed` "It ran and failed", `unknown` "No answer came back. It may have run. Check OpenRouter before rendering again. This page never retries by itself."; `New run from this brief` and `Render again · N s · $X` with "A new press, a new charge."
- `StopBanner` (F2): alarm banner "Stopped", the reason, the attempts list for the check that stopped it, "The plan you approved, the pictures and the character are kept. A new run from this brief starts with them already filled in.", `New run from this brief`. No render button exists in this state (test).

- [ ] **Step 1: Write the failing tests**: `stopped` fixture has no element with name /render/i; `renderFailed` with `billing: "unknown"` shows the "may have run" copy; `rendered` shows billed amount and the video has no `autoplay` or `loop` attribute.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(director): rendering, the result, and the two ways a run can end badly"`

---

### Task 10: Go live, and the Architecture screen stops promising the Director

**Files:**
- Modify: `apps/frontend/src/main.tsx` (construct `HttpDirectorClient("")`, or `FixtureDirectorClient` under `?fixture=director-<scenario>`), `packages/contract/src/pipeline.ts`, `apps/frontend/src/screens/ArchitectureScreen.tsx`
- Test: `apps/frontend/tests/screens/ArchitectureScreen.test.tsx`, `packages/contract/tests/contract.test.ts`, `apps/frontend/tests/App.test.tsx`

- [ ] **Step 1: Write the failing tests**: `PIPELINE_NODES` no longer contains `interrogator` or `director` (Identity Meter stays planned); the Architecture screen shows a link "The Director's own graph is on the Director tab" that navigates there; `App.test.tsx` line 77 (`node-interrogator` planned) is updated to the new expectation.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` and `npm run typecheck` → all PASS.
- [ ] **Step 5: Manual check against the real backend:** `npm run dev`, open `/director`, start a run with your own brief, stop at Gate B. Compare each screen with the board.
- [ ] **Step 6: Commit** — `git commit -m "feat(director): the tab talks to the real server; Architecture points to it"`

---

### Task 11: One end-to-end walk in a real browser

**Files:**
- Create: `apps/frontend/e2e/director.spec.ts`
- Test: itself

- [ ] **Step 1: Write the spec** using `?fixture=director-start&fixtureSpeed=10`: type a brief → Start run → Gate A appears → fill length 15, a small PNG from `e2e/fixtures/`, pick the first avatar → Continue → Gate B → Approve plan → the timeline shows four bars starting together → Gate C → Render → Rendered with a `<video>`. Second test: `?fixture=director-stopped` shows "Stopped" and no Render button. Third: reload at Gate B returns to Gate B.
- [ ] **Step 2: Run** `npm run test:e2e -- director.spec.ts` → PASS.
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): walk the Director from brief to rendered ad in a browser"`

---

### Task 12: The write-up: how the AI Director was built

**Files:**
- Create: `docs/how-i-built-the-ai-director.md`, `docs/images/ai-director/*.png` (screenshots of the real tab, taken with the same Playwright approach as the board's)

Same style as `docs/how-i-built-prompt-coach.md` and `docs/repairer-v1-vs-v2-results.md`: short sections, plain sentences, real code, honest about what went wrong. Sections, in order:

1. **What was built.** One paragraph and a screenshot of each gate.
2. **How the work was split with the AI.** The real sequence, with dates: research (Part 5) with four research agents in parallel; requirements and design (Part 7) reviewed in conversation, including the Cinematographer change; then on 26 Oct, three reviewer agents (UX, technical architecture, devil's advocate) read the design against the code before any plan was written; the four decisions they forced (gate order, references the Mentic way, character from an existing avatar, one brief); the UI board built and corrected twice ("I wanted to see the UI, not the workflow"); the two plans; subagent-driven implementation with a reviewer per task. Quote the owner's own messages where they changed the direction.
3. **The orchestration, with code.** Snippets, each 5–20 lines, copied from the final code: the recipe edges (`DIRECTOR_RECIPE_EDGES`); the runner's ready-set loop with `Promise.race`; `route()`; the claim before `submit`; `applyDirectorEvent` shared by server and browser.
4. **Evidence for each "done" item.** Done 1: the event log of the real run. Done 2: the timeline screenshot with four bars starting together. Done 3: a routed failure from a real run (or, if none occurred naturally, say so and show the test that injects one; do not stage one and present it as natural). Done 4: the final prompt with the `indexOf` checks. The owner's hand checklist from S06.
5. **What went wrong.** Each defect found in review or testing, what it would have cost, and the fix. Include the two found before any code: the Architecture screen losing a finished run's events on restart, and the requirements contradicting the design on the Cinematographer.
6. **Costs.** Text cost per run from the logs, the render's estimate and billed amount.
7. **Limits.** One brief, one render, not blind, the Cinematographer cannot see the generated location.
8. **Learning outcomes.** Which section shows which outcome.

Footer, as in the earlier docs: "Made with Claude Code (Claude Opus 5.5) at my direction."

- [ ] **Step 1:** Take the screenshots from the real run (Task 10 Step 5 and the owner's render).
- [ ] **Step 2:** Write the document. Every code snippet is copied from the committed code, with its path; every number comes from a file in `data/director-runs/`.
- [ ] **Step 3:** Commit — `git commit -m "docs: how the AI Director was built, and how I worked with the AI on it"`
