# How I built Prompt Coach

**Date:** 12 September 2026
**What got built:** Prompt Coach v1. It scores a character description for an AI video model against a nine-check rubric, quotes the exact words that failed, and rewrites only those words.

68 commits, 341 automated tests, 23 browser tests.

The agents wrote the code. I directed them, and this document is about how that worked.

---

## 1. The agents thing

I used Claude Code with a subagent setup. One lead agent holds the plan and was the only thing I talked to. For each task it spawns a fresh worker that sees only that task, then a separate reviewer that reads the change and tries to find what is wrong with it. If the reviewer finds something, the lead rules on it, the worker fixes it, and the reviewer checks the fix.

About 70 of these ran, and they caught roughly 25 real defects before I saw any of them.

Why not one agent doing everything? The agent that writes the code is a bad judge of it, and a reviewer that never saw the work being written finds what the author is blind to. That is also true of people. A fresh worker per task stays focused because it cannot get tangled in nine tasks of history it does not need.

The cost is that the lead has to decide things. Reviewers disagree with workers and somebody has to rule. That was the lead, and when the question was about my project rather than about code, it asked me.

---

## 2. How I worked through it

**Brainstorming first.** I started with the Superpowers brainstorming skill rather than describing a feature and asking for code. It makes the agent interview you one question at a time instead of guessing, so the first stretch was me answering: what counts as a good character description, where the nine checks come from, what happens when one fails, how many repair attempts are reasonable. What comes out is an understanding rather than a file, and it is why the rest of the session had something to argue against.

**Then the spec and the plan.** The brainstorm produced two documents. The spec is the design: nine checks in three groups, five bands, the rule that a failing check must quote the exact words, and three terminal states of which only one is a pass. The plan is that spec broken into tasks, each naming the files it touches and the test it has to pass. The spec is the authority, so when the plan and the code disagree later, the spec settles it.

**I had it explained back before agreeing to anything.** I asked for a walkthrough in plain terms so I could review the plan without reading all of it. That is where I caught that it had no interface in it at all, which I would not have seen from a task list.

**More brainstorming, and changes.** Reviewing produced more questions, so we went back and forth on what the screens are, what order to build in, and what the interface has to prove. The plan was rewritten as one plan covering everything instead of a backend plan with the rest deferred.

**Then the details.** Interface, API and the rest, specified rather than described: real file paths, real types, real test cases. A vague plan produces a worker that invents its own answer, and then the review argues with the invention instead of the work.

**Then the perspectives.** I had the agent read the plan back as an architect, as an interface designer, and as the developer who would implement it, and explain how the agent pipeline works end to end. Three readings of the same plan find different problems, and the explanation is what let me sign off.

**Then I asked for it subagent-based**, which is the setup in section 1, and the tasks ran.

**Last, the part that connects it to my own product.** I asked the agent to read how we actually make an avatar in Mentic and build the same thing here, so the description being graded is produced the way the product produces it. It aimed at the wrong paragraph first. Mentic has two: one creates the avatar image, the other describes the person to the video model. The second is the one that matters, because the video model never sees the picture. I said so, it rebuilt, and that is what shipped.

None of this was clever prompting. It was deciding what to build, in what order, under what limits, and checking before agreeing.

---

## 3. What the reviews caught

This is the evidence that the method earns its cost.

One line of CSS made the entire app unclickable. An invisible element covered the whole screen and swallowed every mouse click, the tabs and the Run button included. Every automated test passed anyway, and so did every review, because they all test the page in a simulated browser that does not calculate layout. Nothing ever asked what was sitting on top of a given pixel. Playwright asked, in a real browser, and found it in seconds.

I had seen that evidence earlier and dismissed it. The lead ran a probe that pointed straight at the offending element, decided the tooling was unreliable, and moved on. It wrote the mistake into its own log rather than quietly fixing it, which is why it is in this document.

The other recurring find, five separate times, was a missing measurement dressed up as a real one: a cost that was never measured showing as `$0.00`, a pipeline step showing "done" for work it never did, a statistic from three data points displayed identically to one from forty. The fix was the same idea every time. If you did not measure it, say so. The tool now says "not measured" in about a dozen places where a zero would have been easier.

---

## 4. Learning outcomes this covers

**Designing (3).** Written before the code and revised several times during the build, each time because a review proved part of it wrong. Every revision is dated in the git history. A design with no revisions reads as one nobody tested.

**Realising (7).** Working software, 68 commits with messages saying why, and the struggle recorded rather than hidden. The click bug, my own dismissal of the evidence, and the five repeats of the same mistake are all written down.

**Managing & Controlling (4).** The scoring system watches itself. Rubric versions are append-only, every version needs a written reason for changing, and the agreement study checks whether the scores mean anything.

**Professional Standard (6).** The failure condition is pre-registered in `docs/decision-log.md`, written before any result exists so it cannot be adjusted afterwards to fit. It names one clause that cannot currently be tested, because saying so is the point of pre-registering.

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
| Avatar form | Copy Mentic's, and grade the video description rather than the image brief |

The fake data row is worth a line. The Versions screen shows five rubric versions, four of them invented. They now carry a visible "Sample data, not a real run" label, because a screenshot of invented research history is not something I want near an assessment.

---

## 6. Next steps

Four things are finished and waiting on me. Each is one command.

1. **Run the live tests.** `RUN_LIVE_API=1 npx vitest run apps/backend/tests/live`, about €0.50. Proves it works against the real model, and that a failing run reads as a failure.
2. **Mark the gold set.** 30 to 50 descriptions in `data/agreement/gold-set.json`, scored by hand before looking at what the tool says. The one thing I cannot delegate, because its whole value is that a human marked it independently. Then `npm run agree` gives the agreement score.
3. **Run the bias check.** `npm run bias` scores the same descriptions through OpenAI as a control, since an AI grading its own kind of output tends to be generous about it.
4. **Grade real Mentic descriptions.** The avatar form is built, so the next run can use descriptions produced the way Mentic produces them rather than retyped by hand.

After that, rubric v2, informed by whichever checks the agreement study shows are unreliable. That is the feedback cycle the Versions screen exists to make visible.

---

What I contributed was judgement: what to build, in what order, what not to spend, which tool to test with, and where honesty mattered more than a clean-looking result. The most useful instruction I gave was to test in a real browser. It cost one sentence and caught a bug that would have shipped an application nobody could click.
