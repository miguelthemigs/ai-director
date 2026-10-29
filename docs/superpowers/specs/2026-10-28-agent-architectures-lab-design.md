# Design: the architecture lab — one brief, three ways to wire the agents

Date: 2026-10-28
Owner: Miguel Roale
Status: approved by the owner 2026-10-29, ready for implementation planning
Extends: `docs/architecture.md` section 7 (the Director), `docs/decision-log.md` (2026-10-26 entries)

## 1. Why this exists

The owner's teacher asked for an exercise in system design for AI: take the agents we already
have, wire them up in different ways, run them, and explain which wiring fits this job and why.
The point is learning, not shipping. There is no UI. What gets handed in is a document that
explains each architecture, the decisions behind it, and what actually happened when it ran.

The Director already exists and is one architecture: a fixed recipe in code
(`apps/backend/src/orchestrate/director/recipe.ts`, `runner.ts`, `router.ts`). Code decides the
order; models only do the steps; failed checks are routed back to their owner by code. The lab
adds two more wirings of the same three agents and compares all three on the same briefs:

| Architecture | Who decides what happens next | Where it runs |
|---|---|---|
| **Sequential (the recipe)** | Code | A TypeScript CLI, driven from Claude Code or a terminal |
| **Coordinator** (Anthropic: orchestrator-workers) | One lead agent, calling specialists as tools | Claude Code: the main session plus subagents |
| **Swarm** (OpenAI Swarm / LangGraph swarm: handoffs) | Each agent, handing off to a peer | Claude Code agent teams: teammates messaging each other |

Going in, the guess is: the recipe wins on reliability and cost because brief → plan → shots is
a chain of dependent steps; the coordinator earns its cost only when briefs vary a lot; the swarm
is mostly worth building to see how it drifts. The lab exists to test that guess, not to
confirm it.

### What the research says (to be expanded in the final document)

- Anthropic, *Building effective agents*: workflows (prompt chaining, routing, parallelization,
  orchestrator-workers, evaluator-optimizer) versus agents. "Finding the simplest solution
  possible, and only increasing complexity when needed." Start with the API directly, not a
  framework. https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *How we built our multi-agent research system*: the orchestrator-worker setup beat a
  single agent by 90.2% on breadth-first research, at about 15× the tokens of a chat. It fits
  badly with "tasks that require all agents to share the same context or involve many
  dependencies between agents". https://www.anthropic.com/engineering/multi-agent-research-system
- Cognition, *Don't Build Multi-Agents* (June 2025): share full context, and "actions carry
  implicit decisions"; parallel writers drift apart. The April 2026 follow-up keeps that for
  parallel-writer swarms but finds that many agents contributing ideas while writes stay
  single-threaded works. https://cognition.ai/blog/dont-build-multi-agents,
  https://cognition.com/blog/multi-agents-working
- OpenAI Swarm: routines and handoffs, where a handoff is a function that returns another agent.
  Educational only; the Agents SDK replaced it. LangGraph's swarm and supervisor libraries are the
  same two ideas as graph libraries.
- Claude Code: subagents report back to the caller only; agent teams message each other directly
  and share a task list. Teams are experimental, cost more tokens, and are "less effective" for
  sequential work with many dependencies. https://code.claude.com/docs/en/sub-agents,
  https://code.claude.com/docs/en/agent-teams

## 2. What a run does (the same for all three)

1. **Brief in.** The owner gives a brief, and a website if they have one: "an ad for Apple",
   optionally with `https://www.apple.com`.
2. **Scrape.** If there is a URL, a simple scraper reads that one page and keeps the text (see
   section 5). No browser, no crawling.
3. **Interrogate.** The Interrogator reads the brief, the scrape and the list of saved avatars,
   and asks only about what is missing: the product, the website if none was given, the
   location, the avatar, the length, what must not appear. Every question carries the choice it
   will make if the owner answers "you decide". The owner answers once, in chat.
4. **Fill.** The Interrogator turns brief, scrape and answers into a filled brief.
5. **Plan.** The Director writes the plan: style line, scene, assets (product, location,
   character) and shots, using the existing `Plan` type.
6. **Plan checks.** Code runs the existing five plan checks (`runPlanChecks`). A failure goes back
   to the Director, at most `MAX_RETRIES_PER_OWNER` (2) times.
7. **Shots.** The Cinematographer writes one camera per shot, using the existing `Camera` type.
8. **Shot checks.** Code runs the existing two prompt checks (`runPromptChecks`). A failure goes
   back to the Cinematographer, at most 2 times.
9. **Assemble.** Code writes the final text prompt and a readable shot list.

What changes between architectures is only steps 3-8: who calls whom, who sees what, who decides
to retry. The inputs, the prompts, the checks, the retry cap and the output files are identical.

**What "the same prompts" means** (*my call*). The **system prompt** of each agent is identical
in all three. The **request** (what the agent is asked this time, and with what context) is the
thing being tested. In the recipe, code renders it (`renderDirectorRequest` and the others). In
the coordinator, the lead writes it. In the swarm, the previous agent writes it. Every agent in
every architecture may also read the run folder (`lab show`), so nobody is starved of the
brief; what differs is who decides what to ask and what to stress. The teaching document says
exactly this, because it is the "context engineering" question Cognition and Anthropic both
write about.

**The rules every architecture plays by** (*my call*), all enforced by the `lab` commands:

- **Invalid output.** A save that `lab save` refuses (bad JSON, wrong shape, a patch that changes
  assets) is recorded. The third refused save in a row for the same step ends the run `failed`.
  The recipe follows the same rule: it re-asks the model up to three times instead of failing on
  the first bad answer, as the Director app does.
- **Every plan after the first is a patch.** It may change descriptions, actions, sounds, weights
  and the style line, never the assets' handles, kinds, count or order. Each new plan counts as one
  Director retry, whatever triggered it. A new plan makes the existing cameras stale: plan checks
  must pass again, and the Cinematographer must save cameras for the new plan before shot checks
  can run.
- **Every camera set after the first is a reshoot.** After a shot check routes a `redo` for shots
  S, a new camera set must keep every camera outside S byte-identical, or `lab save` refuses it.
  Each new camera set counts as one Cinematographer retry.
- **Giving up.** `lab stop <runId> "<reason>"` ends a run `stopped`. A run with no terminal state
  when `lab report` runs is reported `abandoned`, never `done`.
- `lab assemble` needs passing plan checks on the latest plan, and passing shot checks on cameras
  saved for that plan.

**Terminal states:** `done` (every check passed and the prompt is assembled), `stopped` (a check
still failed after its owner's 2 retries, or the architecture gave up), `failed` (a defect: a
crash, invalid output that could not be saved). Only `done` is a success, and nothing anywhere
may present `stopped` or `failed` as one.

**Not in a run:** no product picture, no location picture, no avatar picture, no video, no Prompt
Coach grading, and no Gate B or C. The one human checkpoint is the Interrogator's questions
(*my call*: the owner did not pick a plan approval when asked twice; one checkpoint keeps the
three architectures comparable. Adding a plan approval is the first extension if wanted).

## 3. Goals, non-goals, anti-goals

Goals:

- One command in Claude Code (`/direct`) that asks which architecture, then the brief, then runs
  it with the owner watching the agents work.
- The same brief can be run through all three, and every run leaves the same set of files so the
  runs can be compared side by side.
- A teaching document, `docs/agent-architectures.md`, written after real runs: each
  architecture, why it is built that way, what happened, and which one fits this job.

Non-goals:

- No UI, no screen, no server route. The Director app is not changed in behaviour.
- No image or video generation of any kind, and no call to any generation API.
- No agent framework (LangGraph, CrewAI, the Agent SDK). Claude Code is the host for the two
  model-led architectures; the recipe stays plain TypeScript.
- No crawler. One page per URL.

Anti-goals (would be a failure even if it runs):

- The three architectures using different prompts, models or checks, so a difference comes from
  the setup and not the wiring.
- A "swarm" that is secretly run step by step by a boss, without the document saying so.
- Declaring a winner without the measured numbers next to the claim.
- Showing a stopped run as a success, anywhere.
- A model checking its own output instead of code.

## 4. The pieces

### 4.1 The run folder (shared by all three)

`data/lab-runs/<runId>/`, committed like every other run. `runId` is
`<YYYYMMDD-HHMMSS>-<arch>`.

| File | Written by | What it holds |
|---|---|---|
| `run.json` | `lab new` | arch, brief, url, startedAt, status, finishedAt, retries per owner |
| `scrape.json` | `lab new` / `lab scrape` | url, final url, title, meta description, headings, text (capped) |
| `questions.json` | Interrogator, via `lab save` | the questions, each with its "you decide" choice |
| `answers.json` | the owner's answers, via `lab save` | one answer per question; "you decide" allowed |
| `brief.json` | Interrogator, via `lab save` | the filled brief (section 4.4) |
| `plan.<n>.json` | Director, via `lab save` | the plan, attempt n |
| `cameras.<n>.json` | Cinematographer, via `lab save` | the cameras, attempt n |
| `checks.plan.<n>.json`, `checks.shots.<n>.json` | `lab check` | the check outcomes and the route |
| `prompt.txt` | `lab assemble` | the final Seedance prompt text |
| `shotlist.md` | `lab assemble` | the shot list for a person to read |
| `trace.jsonl` | every `lab` command, and `lab log` | one line per step or handoff: at, actor, kind, text |
| `metrics.json` | `lab report` | the numbers in section 6 |

### 4.2 The `lab` commands: the shared toolbox

One CLI, `npm run lab -- <command>`, in `apps/backend/src/lab/`. Every architecture uses the same
commands; the Claude Code agents call them through Bash. Every command prints JSON to stdout, so
an agent can read the result, and appends a line to `trace.jsonl`.

- `lab new --arch <sequential|coordinator|swarm> --brief "<text>" [--url <url>]` creates the run
  folder, scrapes if there is a URL, prints the run id.
- `lab scrape <runId> <url>` scrapes later, when the owner gave the site as an answer.
- `lab avatars` lists saved avatars (`data/avatars/`) with id and stored description.
- `lab save <runId> <questions|answers|brief|plan|cameras> <file> --by <agent>` validates the
  file against its zod schema and the same shape rules the agents' `run.ts` enforce
  (`assertPlanShape`, lens check, handle lower-casing), then writes it as the next attempt. An
  invalid file is refused with the reason, and nothing is written. A plan patch that changes
  asset handles, kinds, count or order is refused, as in the Director today.
- `lab check <runId> <plan|shots>` runs `runPlanChecks` or `runPromptChecks` on the latest
  attempt, then runs the existing `route()` with the run's retry counts and prints the outcomes
  and the route: `pass`, `redo` (owner, failing checks, shots) or `stop`. Retries are counted
  when a new plan or camera set is saved (section 2), not when a check routes. A `stop` sets the
  run `stopped`. This is how the retry cap and the routing
  rule stay in code for the two model-led architectures: the agents may ignore the route, but
  they cannot get past `lab assemble` without passing checks.
- `lab assemble <runId>` refuses unless the latest plan and shot checks both passed and the run
  is not stopped; otherwise writes `prompt.txt` and `shotlist.md` and sets the run `done`.
- `lab log <runId> --from <agent> --to <agent> "<text>"` records a handoff or a message, so the
  trace shows who talked to whom. Best effort for Claude Code agents (they are told to; the
  Claude Code transcript is the full record).
- `lab report <runId>` writes `metrics.json`. `lab compare [runIds...]` prints a markdown table
  of runs side by side.
- `lab rate <runId> <1-5> "<note>"` records the owner's own judgement of the shot list.
- `lab show <runId> [file]` prints the run's files (or one), so any agent can read the brief,
  scrape, latest plan and cameras without the lead pasting them.
- `lab stop <runId> "<reason>"` ends the run `stopped` (section 2).
- `lab collect <runId> <sessionId...>` copies the Claude Code transcripts of that session, lead and
  every subagent or teammate, into `transcript.jsonl` in the run folder, keeping only
  agent, role, text and usage, with anything that looks like a key or token replaced by
  `[redacted]`. The owner reads it before committing (*my call*: the document quotes evidence a
  fresh clone must be able to open; the raw files hold more than the lesson needs).

### 4.3 The prompts (append-only, one source)

All three architectures use the same prompt text. The sources are the existing versioned prompt
files; Claude Code agent files are generated from them, never written by hand.

- **Interrogator v2** (new, `agents/interrogator/prompt-v2.ts`). v1 never asks a question, because
  Gate A asked the fixed ones. v2 has two calls: *ask* (brief + scrape + avatar list in, a list
  of questions out, each naming what it will choose on "you decide", and asking nothing the brief
  or scrape already answers) and *fill* (brief + scrape + answers in, the filled brief out). v1's
  rules stay: no brand names, logos or slogans in any field; English; things a camera can show.
- **Director v2** (new, `agents/director/prompt-v2.ts`). v1 tells the Director that the owner's
  photo carries the product's look, so its product description must say only the kind. With no
  photo, v2 lets the product description name its visible shape and materials from the scrape,
  still with no brand name, logo, lettering or label text. The location description no longer
  mentions a picture. Everything else is v1. The patch prompt gets the same change.
- **Cinematographer v1**, unchanged. Its one line about the location picture ("painted from that
  description") still reads true enough with text only. *My call*; if the builder finds v1
  depends on the picture anywhere else, it becomes v2 by the same rule.
- **Assembler, text-only** (new, `orchestrate/director/assemblePrompt/v2.ts`). v1 names the
  product and location as reference images. v2 writes them as text lines instead
  (`Product (@handle): <description>.`, `Location (@handle): <description>.`), then the style
  line, the hero line, the scene, the shots and the closing line exactly as v1. The same
  invariants hold: the style line and the character text are byte-identical in the output, every
  `Shot n:` appears once, the 15,000-character cap.

**The character.** If the owner picks a saved avatar, its stored description is the character
text, byte-identical, and the Director is told to use it as is. Otherwise the plan's character
asset description is the character text. No grading.

**Model**, by the owner's decision (2026-10-29):

| | Specialists (Interrogator, Director, Cinematographer) | Whoever decides what happens next |
|---|---|---|
| Sequential | `claude-sonnet-5-5` | code |
| Coordinator | `claude-sonnet-5-5` | the lead: `claude-opus-5-5` |
| Swarm | `claude-sonnet-5-5` | the agents themselves; the lead, which only relays, is `claude-opus-5-5` |

The specialists are the same model everywhere: the recipe's API transport
(`createAnthropicTransport("claude-sonnet-5-5")`, same adaptive thinking and `effort: "high"`), and
`model: claude-sonnet-5-5` with `effort: high` in each generated Claude Code agent file.

**Every Opus 5.5 lead runs at high effort** (owner's decision, 2026-10-29). Opus 5.5 defaults to
`medium` in Claude Code, so this has to be set, not assumed. *Amended 2026-10-29 (owner: no start commands):* `/direct`
carries `model: claude-opus-5-5` and `effort: high` in its frontmatter, so the lead runs that way in
any session. In-process teammates apply their agent file's `effort: high`, so the swarm's Sonnet
teammates run at `high` too, matching the other two. Do not
set `CLAUDE_CODE_EFFORT_LEVEL`: it would override the agent files' own `effort`.

The
coordinator's lead is Opus on purpose: it mirrors Anthropic's research system (an Opus lead with
Sonnet subagents), where the planning model is the stronger one. That means the coordinator
differs from the others in its lead's model as well as its wiring, and the teaching document
says so next to every coordinator number. `/direct` tells the owner which `/model` to set before
each model-led architecture (`claude-opus-5-5` for the coordinator and the swarm), and
records which model the session reported.

This is an exception to the project rule that the agents use `claude-opus-5`, scoped to the lab
only: the Director app and Prompt Coach keep `claude-opus-5` and `DEFAULT_MODEL` is unchanged. It
goes in `docs/decision-log.md` as its own entry.

The existing agent code reads its v1 prompt by import. *Builder's call* how to let it take v2
(a prompt argument with v1 as default is the obvious way), on one condition: the Director app's
behaviour and its tests are unchanged, and no validation logic is copied.

### 4.4 Lab types

The lab's own types (questions, answers, the filled lab brief, the run record, metrics) never
cross the network, so they live in `apps/backend/src/lab/types.ts`, not in the contract. They
reuse `FilledBrief`, `Plan`, `Camera`, `CheckOutcome` from `@ai-director/contract` and never
redefine them. The filled lab brief is `FilledBrief` plus `seconds` (chosen or decided, 4-30),
`mustNotAppear: string[]`, `product: string` (what the product is and looks like, from the scrape
and answers) and `character: { avatarId: string; description: string } | null`. The Director v2
request is rendered from it in place of `GateAAnswers`.

### 4.5 Sequential: the recipe

`npm run lab -- sequential ask <runId>` runs the Interrogator's *ask* call and prints the
questions. `npm run lab -- sequential finish <runId>` (after answers are saved) runs, in fixed
order: *fill*, Director, plan checks with the route/patch loop, Cinematographer, shot checks with
the reshoot loop, assemble, report. It calls the existing agent functions (`direct`, `patchPlan`,
`shootAll`, `reshoot`) through the metered transport, and the same `lab` command functions the
other two architectures call. It prints each step as it happens, with the agent's name, a one-line
summary and the check results.

It does not reuse `runner.ts`: that runner's nodes are the Director app's (pictures, gates,
render), defined in the contract. The lab's recipe is a small fixed loop that follows the same
rules: fixed order, failures routed by `route()`, the same retry cap. The final document says so.

Two steps, not one interactive prompt, so that Claude Code can drive it (Claude Code's Bash has no
stdin): `/direct` runs *ask*, shows the questions, collects the answers with the question tool,
saves them, runs *finish*. In this architecture Claude Code only relays messages; it decides
nothing, and `/direct` says so on screen.

### 4.6 Coordinator: one lead, specialists as tools

Three subagent files, `.claude/agents/lab-interrogator.md`, `lab-director.md`,
`lab-cinematographer.md`, generated by `npm run lab -- export-agents` from the prompt files. Each
body is a short lab header (the run folder, the `lab` commands it may use, "save your output with
`lab save`, never edit files by hand", "you cannot talk to the owner") followed by the prompt
text. Tools: `Bash` and `Read` only. Subagents cannot spawn others (no `Agent` tool).

The lead is the main Claude Code session, following the coordinator section of `/direct`. It is
given the goal (a passing, assembled shot list), the specialists, the `lab` commands and the
rules (the retry cap, only the lead talks to the owner, never write an agent's output itself). It
is **not** given the order. It decides whom to call, with what brief, when to re-call after a
failed check and what to tell them, and when to give up. The owner sees each subagent call as a
row and can open any subagent's transcript from the agent panel. Each subagent starts fresh with
only what the lead puts in its brief: that context hand-off is one of the things the document
examines.

### 4.7 Swarm: peers handing off

*Amended 2026-10-29 (owner: no start commands):* agent teams are on in `.claude/settings.json`,
and the teammates run in-process, in the same terminal, watched from the agent panel. With teams
on, a named subagent becomes a teammate, so the coordinator never names its subagents. `/direct`
checks the variable and, if a session started before the setting existed, asks the owner to reopen
Claude Code once.

The lead spawns three teammates from the same three agent files and gives the Interrogator the
run id. The lead then only relays between the owner and the team (Claude Code always has a lead,
and only the lead reaches the owner's questions). It does not plan, route or order anyone. The
handoff rules live in each agent's header:

- The Interrogator writes its questions and sends them to the lead for the owner. On answers, it
  fills the brief and hands off to the Director.
- The Director plans, runs `lab check plan` itself, fixes and re-checks if told `redo`, and hands
  off to the Cinematographer when it passes. It may ask the Interrogator about the brief.
- The Cinematographer shoots, runs `lab check shots`, fixes if told `redo`, may ask the Director
  about a shot, and when checks pass, runs `lab assemble` and tells the lead it is done.
- Anyone who gets `stop` tells the lead the run stopped and why.
- Every handoff and question goes through `lab log` as well as the message.

That a pure leaderless swarm is not possible in Claude Code (one lead, fixed for the session) is
a finding for the document, not something to hide.

**Split panes, on purpose.** In split-pane mode a teammate's system prompt *is* the agent file's
body, as a subagent's is. In in-process mode the body is added on top of Claude Code's own prompt,
which would change the prompt between architectures. So the swarm runs in split panes, and
`/direct` refuses to start it otherwise. During a run the owner does not message teammates
directly (`/direct` says so); in the coordinator, the lead is told not to name its subagents, so
they cannot message each other.

### 4.8 `/direct`

A project skill, `.claude/skills/direct/SKILL.md`. It asks which architecture, then the brief and
website, runs `lab new`, then follows that architecture's section. It ends by printing the shot
list, the status, and `lab report`. It never calls a generation API and never presents a run that
is not `done` as a success.

## 5. The scraper

`apps/backend/src/lab/scrape.ts`. One GET with Node `fetch`, a browser-like user agent, a 15 s
timeout, redirects followed. From the HTML: `<title>`, meta description, Open Graph title and
description, `h1`-`h3` text, and the visible body text with `script`, `style`, `nav` and `footer`
removed, collapsed and capped at 6,000 characters. No JavaScript rendering, so a site that builds
its page in the browser yields little; that is recorded, not worked around. A failed fetch
records the error in `scrape.json` and the run goes on; the Interrogator then asks about the
product. Tests use saved HTML, never the network.

A brand name only ("an ad for Apple") is not looked up. The Interrogator asks for the website and
suggests one; the answer is scraped with `lab scrape` before *fill*.

## 6. What gets measured

Per run, in `metrics.json`:

- status (`done`, `stopped`, `failed`, `abandoned`) and reason
- wall time from `lab new` to the terminal state
- **agent invocations** per agent: a recipe call, a subagent call, or a teammate turn that
  received a message. **API requests**: every model request, the lead's included (exact for the
  recipe, from the transcripts for the other two). Both are reported, because a Claude Code
  agent invocation is a loop of several requests.
- retries per owner, refused saves per step
- first-try pass: the result of the **first `lab check`** for plans and for shots (not the first
  save)
- questions asked of the owner
- input and output tokens, total and per agent, including the lead's. Exact for the recipe (the
  metered transport's `CallLog`). For the two Claude Code architectures, from the transcripts
  `lab collect` gathered; that total includes Claude Code's own system prompt and the lead's
  relaying, and the document says so rather than subtracting a guess. If they cannot be read
  reliably, the field is `null` and the document says "not measured". Never estimated.
- the owner's rating and note, from `lab rate`

The comparison: the same three briefs through each architecture, nine runs in all. *My call* on
the briefs, the owner may swap them: (1) "an ad for Apple" with no URL, (2) a specific product
page URL with a one-line brief, (3) a detailed brief that already names location, avatar and
length, to see who asks needless questions.

**What the build covers** (*my call*). The plan builds the tools, the agent files and `/direct`,
proves them with tests and one recipe run on a fake transport, and ends there. The nine live runs
need the owner at the keyboard (answering questions, the tmux session, the ratings) and spend real
text-model money, so they are a checklist the owner works through, and the teaching document is
written after them.

## 7. The teaching document

`docs/agent-architectures.md`, written after the nine runs, from the run folders. For each
architecture: a diagram of who talks to whom, how it is built here and why, what the trace shows
(quoted from `trace.jsonl` and the transcripts), the numbers, and where it broke. Then the
comparison table, the verdict against the guess in section 1, and what would change the verdict
(for example: briefs that vary much more, a human approval in the middle, many products at once).
It cites the sources in section 1. It names what was not measured.

## 8. Testing

`npm test` covers the lab with fakes only: every `lab` command against a temporary run folder;
`save` refusing bad files; `check` routing and stopping at the cap; `assemble` refusing before
checks pass; the v2 assembler's invariants; the scraper on saved HTML; the recipe end to end with
a fake transport (pass, redo then pass, stop); and a drift test that the generated agent files'
prompt sections equal the prompt functions' output. Interrogator v2 and Director v2 get the same
kind of prompt tests v1 has. No live API call in any test. The Claude Code architectures are not
unit-tested; their tools are.

## 9. Constraints that carry over

- The lab runs its specialists on `claude-sonnet-5-5` and the coordinator's lead on
  `claude-opus-5-5` (section 4.3); the rest of the repo keeps `claude-opus-5`.
  Never a date-suffixed variant.
- Prompt and assembler files are append-only: v2 is a new file, v1 is untouched.
- Checks are code; no model grades another model's output or its own.
- No image, video or other generation API call; no external host; everything in `data/`.
- Never commit a key.
- No ambient animation applies trivially: there is no UI.

## 10. Left to the builder

- How the agent `run.ts` files accept a v2 prompt (section 4.3), under the stated condition.
- The trace line format, beyond at, actor, kind and text.
- How tokens are read from Claude Code transcripts, or that they cannot be (section 6).
- The exact wording of the lab headers in the generated agent files and of `/direct`, within the
  rules in sections 4.6-4.8.
- How `lab compare` lays out its table.
