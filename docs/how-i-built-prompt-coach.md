# How I built Prompt Coach

**Date:** 11 September 2026
**What got built:** Prompt Coach v1. It scores a character description for an AI video model against a nine-check rubric, quotes the exact words that failed, and rewrites only those words.

One session. 24 planned tasks, all finished. 65 commits, 312 automated tests, 12 browser tests.

The agents wrote the code. I directed them, and this document is about how that worked.

---

## 1. The agents thing

I used Claude Code with a subagent setup. The short version:

- One lead agent holds the plan and makes decisions. It was the only thing I talked to.
- For each task it spawns a fresh worker that sees only that one task, not the whole project.
- When the worker finishes, a separate reviewer reads the change and tries to find what is wrong with it.
- If the reviewer finds something, the lead decides what to do about it, the worker fixes it, and the reviewer checks the fix.

About 70 of these ran over the session, and they caught roughly 25 real defects before I saw any of them.

Why bother instead of one agent doing everything? The agent that writes the code is a bad judge of it. A separate reviewer that never saw the work being written finds things the author is blind to, which is also true of people. A fresh worker per task also stays focused, because it cannot get tangled in nine tasks of history it does not need.

The cost is that the lead has to decide things. Reviewers disagree with workers and somebody has to rule. That was the lead, and when the question was about my project rather than about code, it asked me.

---

## 2. The prompting that mattered

Most of my messages were short. Five changed the outcome.

**"where is the ui broo"**
The original plan was backend only, with the interface listed as "later, by design." I asked where it was. That question caused the whole plan to be rewritten as one 24-task plan covering everything.

**Choosing the build order.**
It offered three orders and I picked: engine first, then the screens running on fake data, then wire them to the real backend. That choice is why the screens were finished and reviewed before any network code existed, and when the real wiring happened it took a single line. A different order would have meant rewriting them.

**"Don't spend money. I will test it, not you."**
It had permission to make real API calls. I stopped that. The consequence is written down plainly: four things are built but not yet measured, and I run those myself. That is better than a number nobody checked.

**"use Playwright, the one that uses fewer tokens"**
It had been testing the interface by taking screenshots, which was expensive and gave contradictory answers. I told it to use Playwright, which drives a real browser and measures the page directly. That instruction found the worst bug in the project.

**"don't stop for anything"**
Near the end I told it to work without checking in. It did, and it logged every decision it made on my behalf, so I can read them back and reverse any I disagree with.

None of these prompts were clever. They were decisions about what to build, in what order, and under what limits. The agent executes well and has no idea what I want, so telling it what I want is the job.

---

## 3. What the reviews caught

This is the evidence that the method earns its cost.

One line of CSS made the entire app unclickable. An invisible element covered the whole screen and swallowed every mouse click: the tabs, the Run button, all of it.

312 automated tests passed anyway, and so did every review. They all test the page in a simulated browser that does not calculate layout, so nothing ever asked what was actually sitting on top of a given pixel. Playwright asked, in a real browser, and found it in seconds.

I had seen the evidence earlier and dismissed it. The lead ran a probe that pointed straight at the offending element, decided the tooling was unreliable, and moved on. It wrote that mistake into its own log instead of quietly fixing it, which is why it is in this document.

The other recurring find, five separate times, was a missing measurement dressed up as a real one. A cost that was never measured showing as `$0.00`. A pipeline step showing "done" for work it never did. A statistic computed from three data points displayed identically to one computed from forty.

The fix was the same idea every time: if you did not measure it, say so. The tool now says "not measured" in about a dozen places where showing a zero would have been easier.

---

## 4. Learning outcomes this covers

The four demands are hands-on, defensible, documented, refined.

**Designing (3).** The design was written before the code and revised five times during the build, each time because a review proved part of it wrong. Every revision is dated in the git history. A design with no revisions reads as one nobody tested.

**Realising (7).** Working software, 65 commits with messages saying why, and the struggle recorded rather than hidden. The outcome explicitly asks for what did not work, so the click bug, my own dismissal of the evidence, and the five repeats of the same mistake are all written down.

**Managing & Controlling (4).** The scoring system watches itself. Rubric versions are append-only, every version needs a written reason for changing, and the agreement study exists to check whether the scores mean anything.

**Professional Standard (6).** The failure condition is pre-registered, written before any result exists so it cannot be quietly adjusted afterwards to fit. It is in `docs/decision-log.md`, and it names one clause that cannot currently be tested, because saying so is the point of pre-registering.

**Personal Leadership (5).** The judgement calls were mine: scope, order, spending, tools. The agent executed and flagged problems. It did not decide what the project was.

---

## 5. What I approved

| | |
|---|---|
| Scope | Build all 24 tasks, not only the engine |
| Order | Engine, then screens on fake data, then real wiring |
| Spending | No API calls at all. I run those myself |
| UI testing | Playwright instead of screenshots |
| Final review | Cancelled. The per-task reviews were enough |
| Fake data | Must be visibly labelled on screen as fake |

That last one is worth a line. The Versions screen shows five rubric versions and four of them are invented sample data. They now carry a visible "Sample data, not a real run" label, because a screenshot of invented research history is not something I want near an assessment.

---

## 6. Next steps

Four things are finished and waiting on me. Each is one command.

1. **Run the live tests.** `RUN_LIVE_API=1 npx vitest run apps/backend/tests/live`, about €0.50. Proves the whole thing works against the real model, and that a failing run really does read as a failure.
2. **Mark the gold set.** 30 to 50 descriptions in `data/agreement/gold-set.json`, scored by hand, before looking at what the tool says. This is the one thing I cannot delegate, because its entire value is that a human marked it independently. Then `npm run agree` gives the agreement score.
3. **Run the bias check.** `npm run bias` scores the same descriptions through OpenAI as a control, since an AI grading its own kind of output tends to be generous about it.
4. **Look at it myself.** `npm run dev`, then click around.

After that, rubric v2, informed by whichever checks the agreement study shows are unreliable. That is the feedback cycle the Versions screen exists to make visible.

---

Three hours of directing produced a working tool, a test suite, and a written record of every decision including the wrong ones. What I contributed was judgement: what to build, in what order, what not to spend, which tool to test with, and where honesty mattered more than a clean-looking result.

The most useful instruction I gave was to test in a real browser. It cost one sentence and caught a bug that would have shipped an application nobody could click.
