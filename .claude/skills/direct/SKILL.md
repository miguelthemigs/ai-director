---
name: direct
description: "Run one ad brief through the architecture lab: sequential, coordinator or swarm. Text only: it ends at a checked shot list and prompt, never a picture or a video."
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

Ask the owner which architecture (AskUserQuestion: sequential, coordinator, swarm).

- **Sequential:** any session works. The recipe calls the model through the API with `ANTHROPIC_API_KEY` from `.env`; each run spends a little text-model money, so say so before starting.
- **Coordinator:** this session must have been started with
  `claude --model claude-opus-5-5 --effort high`
  Ask the owner to run `/effort status` and confirm it says high and the model is Opus 5.5. If not, explain how to restart the session that way and stop.
- **Swarm:** this session must have been started inside iTerm2 or tmux with
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --model claude-opus-5-5 --effort high --teammate-mode tmux`
  Check with Bash that `echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` prints `1` and that `$TMUX` or `$ITERM_SESSION_ID` is set, and ask the owner to confirm `/effort status`. If any of it is missing, explain how to start the session and stop: in-process teammates get a different system prompt, so the swarm only runs in split panes.

## 2. Start the run

Ask for the brief and, optionally, a website. Then:

```bash
npm run -s lab -- new --arch <architecture> --brief "<brief>" [--url <url>]
```

Keep the printed `runId`. Tell the owner the run folder: `data/lab-runs/<runId>/`.

## 3a. Sequential — code decides every step

Say first: "In this architecture I only pass messages; the code decides every step."

1. `npm run -s lab -- sequential ask <runId>` prints the Interrogator's questions.
2. Ask them with AskUserQuestion, one question each, the first option labelled "You decide: <ifYouDecide>". Save the answers exactly as given (`you decide` for that option):
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
- **Only you talk to the owner.** When the Interrogator has saved questions, ask them with AskUserQuestion (first option "You decide: …") and save the answers with `--by owner`, then call the Interrogator again to fill the brief.
- Never write an agent's output yourself, never run `lab save` for a plan, cameras, questions or brief, and never give a subagent a `name` (named subagents can message each other, which belongs to the swarm).
- After each subagent returns, check the run with `npm run -s lab -- show <runId>` before deciding the next step.
- `lab assemble` is yours to run once both checks pass: `npm run -s lab -- assemble <runId> --by lead`.

## 3c. Swarm — the team hands work to each other

You run on Opus 5.5 at high effort, but **you are only the doorman**: you pass messages between
the owner and the team. You never plan, route, order or fix anyone's work.

1. Spawn three teammates from the agent types `lab-interrogator`, `lab-director`, `lab-cinematographer`, named exactly `interrogator`, `director`, `cinematographer`. Give each the run id, the names of the other two, and one line: "You are a teammate in a swarm; follow your file's swarm rules."
2. Send `interrogator` the brief: "Run <runId>: ask the owner's questions."
3. When the Interrogator sends questions, ask the owner with AskUserQuestion (first option "You decide: …"), save the answers with `--by owner`, log it (`npm run -s lab -- log <runId> --from lead --to interrogator "answers saved"`), and tell `interrogator` the answers are saved.
4. Then wait. The teammates hand off among themselves. You only relay anything one of them addresses to the owner, and wait for "done" or "stopped".
5. Tell the owner not to message teammates directly during the run (watch them in their panes instead).

## 4. End (every architecture)

1. `npm run -s lab -- report <runId>`.
2. If the run is `done`, show `npm run -s lab -- show <runId> shotlist.md`.
3. If it is `stopped`, `failed`, or still running, say so in the first line with the reason, and **never call it a success**.
4. Coordinator and swarm: collect the transcripts. This session's id is the newest file in `~/.claude/projects/$(pwd | tr / -)/` (`ls -t ~/.claude/projects/$(pwd | tr / -)/*.jsonl | head -5`); in a swarm, the teammates' sessions are the other files written since the run started. Then:
   ```bash
   npm run -s lab -- collect <runId> <this-session-id> [<teammate-session-id> ...]
   ```
   Remind the owner to read `data/lab-runs/<runId>/transcript.jsonl` before committing it.
5. Offer `npm run -s lab -- rate <runId> <1-5> "<note>"`, and `npm run -s lab -- compare` to see every run side by side.
