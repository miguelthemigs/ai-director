---
name: direct
description: "Run one ad brief through the architecture lab: sequential, coordinator or swarm. Text only: it ends at a checked shot list and prompt, never a picture or a video."
when_to_use: "When the owner names an architecture (sequential, coordinator or swarm) and an ad idea, like \"coordinator, an ad for Apple\"."
model: claude-opus-5-5
effort: high
---

# /direct — the architecture lab

One brief, three ways to wire the same three agents (Interrogator, Director, Cinematographer).
Every architecture uses the same toolbox, `npm run -s lab -- <command>`, which owns every rule in
code: what a valid output is, the checks, two retries per agent, three refused saves in a row
fails the run, and the final assembly. Design: `docs/superpowers/specs/2026-10-28-agent-architectures-lab-design.md`.

**Never call a generation API**, render, or use any image or video tool. Never edit files in
`data/lab-runs/` by hand. Never set `CLAUDE_CODE_EFFORT_LEVEL`: it would override the agents' own
effort.

## 1. Before anything

The owner says which architecture in plain words ("coordinator, an ad for Apple"); if they did
not, ask (AskUserQuestion: sequential, coordinator, swarm). They never type a start command:
this skill already runs you on Opus 5.5 at high effort.

- **Sequential:** the recipe calls the model through the API with `ANTHROPIC_API_KEY` from `.env`; each run spends a little text-model money, so say so before starting.
- **Coordinator:** nothing to check.
- **Swarm:** `.claude/settings.json` switches agent teams on. Check with Bash that `echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` prints `1`. If it does not, this session started before the setting existed: tell the owner to close Claude Code and open it again in this folder (no flags), then stop. Teammates run inside this terminal; tell the owner to watch one with the arrow keys in the agent panel below the prompt and Enter.

## 2. Start the run

Ask for the brief and, optionally, a website. Then:

```bash
npm run -s lab -- new --arch <architecture> --brief "<brief>" [--url <url>]
```

Keep the printed `runId`. Tell the owner the run folder: `data/lab-runs/<runId>/`.

## 3a. Sequential — code decides every step

Say first: "In this architecture I only pass messages; the code decides every step."

1. `npm run -s lab -- sequential ask <runId>` prints the Interrogator's questions.
2. Ask them with AskUserQuestion: at most 4 questions per AskUserQuestion call (there can be up to 6, so use two calls), each with a short first option labelled "You decide" whose description is the question's `ifYouDecide`, plus one or two concrete alternatives; the owner can always type their own answer. Save the answers exactly as given (`you decide` for that option):
   ```bash
   npm run -s lab -- save <runId> answers --by owner <<'JSON'
   {"answers": [{"id": "q1", "answer": "..."}]}
   JSON
   ```
   With no questions, the answers are already saved; go on.
3. `npm run -s lab -- sequential finish <runId>`. Its progress lines show each step as it happens (`[director] plan 1`, `[checks] plan: 5 of 5 passed`, `[route] redo …`), then the metrics.

## 3b. Coordinator — you are the lead

You run on Opus 5.5 at high effort. Your goal: an assembled shot list that passes every check, by
calling three specialists as subagents: `lab-interrogator`, `lab-director`, `lab-cinematographer`.

- **You decide** whom to call, in what order, with what instructions, whether to re-call one after a failed check and what to tell it, and when to give up (`npm run -s lab -- stop <runId> --by lead "<why>"`). Nobody gives you the order; choosing it is the point of this architecture.
- Every subagent starts empty: give it the run id and what you want. It can read the run itself (`lab show`).
- **Only you talk to the owner.** When the Interrogator has saved questions, ask them as in 3a step 2 (at most 4 per AskUserQuestion call, "You decide" first) and save the answers with `--by owner`, then call the Interrogator again to fill the brief. With no questions there is nothing to ask or save.
- Never write an agent's output yourself, never run `lab save` for a plan, cameras, questions or brief, and never give a subagent a `name` (named subagents can message each other, which belongs to the swarm).
- After each subagent returns, check the run with `npm run -s lab -- show <runId>` before deciding the next step.
- `lab assemble` is yours to run once both checks pass: `npm run -s lab -- assemble <runId> --by lead`.

## 3c. Swarm — the team hands work to each other

You run on Opus 5.5 at high effort, but **you are only the doorman**: you pass messages between
the owner and the team. You never plan, route, order or fix anyone's work.

1. Find your own name in the team: `cat ~/.claude/teams/session-${CLAUDE_CODE_SESSION_ID:0:8}/config.json` and take the `name` of the member whose agent type is `team-lead`.
2. Spawn three teammates from the agent types `lab-interrogator`, `lab-director`, `lab-cinematographer`, named exactly `interrogator`, `director`, `cinematographer`. Give each the run id, the names of the other two, the line "The lead's name is `<your name>`.", and one line: "You are a teammate in a swarm; follow your file's swarm rules."
3. Send `interrogator` the brief: "Run <runId>: ask the owner's questions."
4. When the Interrogator sends questions, ask the owner as in 3a step 2 (at most 4 per AskUserQuestion call, "You decide" first), save the answers with `--by owner`, log it (`npm run -s lab -- log <runId> --from lead --to interrogator "answers saved"`), and tell `interrogator` the answers are saved.
5. Then wait. The teammates hand off among themselves. You only relay anything one of them addresses to the owner, and wait for "done" or "stopped".
6. Tell the owner not to message teammates directly during the run (watch them in the agent panel instead).

## 4. End (every architecture)

1. `npm run -s lab -- report <runId>`.
2. If the run is `done`, show `npm run -s lab -- show <runId> shotlist.md`.
3. If it is `stopped`, `failed`, or still running, say so in the first line with the reason, and **never call it a success**.
4. Coordinator and swarm: collect the transcripts. This session's id is in `$CLAUDE_CODE_SESSION_ID` (`echo $CLAUDE_CODE_SESSION_ID`). Teammates in this terminal are saved with this session. If any other session file mentions the run (`grep -l <runId> ~/.claude/projects/$(pwd | tr / -)/*.jsonl`), add its id too. `lab collect` refuses any session that never mentions the run, so another Claude Code window open on this project is never swept in. Then:
   ```bash
   npm run -s lab -- collect <runId> $CLAUDE_CODE_SESSION_ID [<teammate-session-id> ...]
   ```
   Remind the owner to read `data/lab-runs/<runId>/transcript.jsonl` before committing it.
5. Offer `npm run -s lab -- rate <runId> <1-5> "<note>"`, and `npm run -s lab -- compare` to see every run side by side.
