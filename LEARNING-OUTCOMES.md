# MA-AAI Learning Outcomes — Working Reference

**Track: GenAI Engineer.** Read this before writing any deliverable.
Project: *Prompt Coach + Face Loop* (Mentic Video Lab, cinematic ads).

---

## How grading works

- **7 outcomes**, each scored **0–4**.
- **Mastery = 3 (Proficient).** That is the bar. 4 is a reach, not a requirement.
- Each outcome is a **weighted average, 65% / 35%**, across two assessment
  moments. *Confirm with your teacher which moment carries the 65%* — plan the
  heavier one to land after the Face Loop measurements exist.

| Score | Label |
|---|---|
| 4 | Outstanding / Advanced |
| 3 | **Proficient ← target** |
| 2 | Beginning |
| 1 | Orienting |
| 0 | Undefined |

---

## The four words that decide every grade

Every outcome is written around the same four demands. Miss one and the
outcome caps at 2, no matter how good the work is.

1. **Hands-on** — working code, real experiments, real numbers. Not reading
   about options. Not a comparison table you wrote from documentation.
2. **Defensible** — you can be challenged on it and hold your ground with
   evidence. "It felt better" is a 1. "Nine probe calls, here is the table,
   here is what it cost" is a 3.
3. **Documented** — the reasoning is written down *at the time*, including the
   criteria you used and how you weighed trade-offs. Reconstructed later is
   worth less.
4. **Refined as you learn** — the trail shows you changed your mind and why.
   A design with no revisions reads as a design nobody tested.

---

## The 7 outcomes, in plain language

### 1. Advising
**Asks:** guide stakeholders to informed decisions about GenAI. Adapt to who
you are talking to. Draw traceable conclusions. Turn trade-offs into something
they can act on. Connect every choice to the organisation — including ethics.
Stakeholders have different priorities and may react unexpectedly.

**Engineer version:** you advise on *technical* choices — which model, what it
can't do, what quality costs. The hard part is translating technical reality
into language a non-engineer can act on.

**Proves it here:** a written recommendation on *why Runway, not Higgsfield*,
aimed at a non-technical reader, with the cost consequence stated in money and
days — not in API fields. Plus an honest "here is what this pipeline cannot do"
section.

---

### 2. Analysing
**Asks:** given a realistic, incompletely-specified organisational context,
investigate the current GenAI landscape, analyse the existing workflow, and
find where GenAI adds value. Explore options **hands-on**. Explain why this
option fits *this* context, given resources, risks and benefits. Reasoning
documented and defensible, showing your investigation process, your criteria,
and how you weighed the trade-offs.

**Engineer version:** technical feasibility — models, APIs, integration
patterns, performance. **Hands-on means working code, benchmarks and
experiments, not just reading about options.**

**Proves it here:** the provider probe runs. Real API calls, dated, with the
result and the cost per call, and the finding written as a claim that can be
falsified. Criteria named *before* the comparison, not after.

---

### 3. Designing
**Asks:** design how the solution will work, so the design guides
implementation and prevents wasted effort on the wrong thing. Deliberate
choices, reasoning shown, defensible when challenged, refined as you learn.

**Engineer version:** architecture diagrams, C4 models, sequence diagrams, API
specifications. **Another engineer should be able to implement from your design
without needing you.**

**Proves it here:** the agent architecture — what each agent is for, what it
reads, what it writes, where it can fail, and what happens when it does. Plus
the sequence of one full run from brief to finished film.

---

### 4. Managing & Controlling
**Asks:** for as long as you're responsible, own what you built. Keep it doing
what it was meant to do. Track performance, spot problems early, improve it
when needed, and act on opportunities *before being asked*.

**Engineer version:** tests passing, services running, model performance. Also
watching the landscape for new models and techniques and acting first.

**Proves it here:** the grading score is itself the monitoring signal — track
it over runs. Track moderation-refusal rate and cost per usable shot. Record
one instance of acting unprompted on a new model or a discovered failure mode.

---

### 5. Personal Leadership
**Asks:** know your own strengths and weaknesses, in ICT and personally. Choose
actions in line with your values to grow. Develop a learning attitude.

- *Aware of:* use tools to identify strengths and weaknesses.
- *Personal growth:* do things that fix weaknesses and exploit strengths.
- *Learning attitude:* plan your learning proactively, **formulate feedback
  questions**, request and process feedback from teachers and classmates,
  choose a specialisation.

**Proves it here:** a short reflection log with dated entries. The highest-value
habit: write the *feedback question* before each session with a teacher, and
write what you did with the answer. That single artefact covers most of this
outcome.

---

### 6. Professional Standard
**Asks:** individually and in teams, apply a real professional methodology to
set goals, involve stakeholders, do applied research, advise, decide and
report — while keeping ethics, intercultural and sustainability aspects in view.

- *Methodology:* know agile methods and their principles; pick the one that
  fits the context and say why.
- *Stakeholders:* actively ask for feedback, apply it, and advise on the best
  option.
- *Applied research:* conduct and document research to justify decisions, using
  named research methods and strategies.
- *Ethical:* analyse ethics using an **ethical analysis tool** and advise on the
  challenges and possible solutions.
- *Intercultural:* apply a theoretical framework on cultural difference to adapt
  how you communicate and work.
- *Sustainable:* know sustainable software principles, reflect, apply.

**Proves it here:** the applied research document (DOT framework, named methods
per subquestion). An ethics section using a *named* tool — not opinions. A
sustainability note that is real for this project: generated video is
compute-heavy, so *the grading step exists partly to avoid wasted renders*.
That is a genuine sustainability argument, not a bolt-on.

---

### 7. Realising
**Asks:** build the final solution with tools appropriate to the context, and
refine it as you learn — **including what didn't work, what you struggled with,
and how you moved forward.** Visible building process. Test that it does what
was intended. Choices defensible and maintainable.

**Engineer version:** working code, deployed, resources connected. **Your git
history tells the story.** When you use AI coding tools, be transparent — the
code is yours to defend.

**Proves it here:** the working pipeline and the finished film. Commit
regularly with messages that say *why*. Keep a failure log — the failures are
explicitly asked for, so a clean-looking project with no recorded struggle
scores *worse*.

---

## What to keep, from day one

Five running logs. All plain markdown, all dated, all appended to as you go —
never reconstructed at the end.

| Log | What goes in | Feeds outcome |
|---|---|---|
| `decision-log.md` | Every choice: options, criteria, what you picked, why | 1, 2, 3, 6 |
| `prompt-log.md` | Every prompt iteration: version, what changed, what happened | 2, 7 |
| `experiment-log.md` | Every API probe/render: date, inputs, result, cost | 2, 4, 6 |
| `failure-log.md` | Every failure mode: what broke, why, what you did | 7 |
| `reflection-log.md` | Feedback questions asked, answers, what you changed | 5 |

**Rule:** if it isn't in a log with a date, it didn't happen. The outcomes
reward the trail, not the artefact.

---

## Fast self-check before submitting anything

- Did I try it, or did I read about it? *(hands-on)*
- Could I survive being challenged on this with evidence? *(defensible)*
- Is the reasoning written down, with the criteria I used? *(documented)*
- Does the trail show me changing my mind? *(refined)*
- Did I name the ethical, intercultural and sustainability angle? *(outcome 6)*
- Did I say what didn't work? *(outcome 7)*
