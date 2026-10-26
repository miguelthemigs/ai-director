# AI Director — Requirements and Advice

**Date:** 11 October 2026 · **Learning outcome:** Advising · **Based on:**
`docs/ai-director-research.md` (cited as [R§n]) · **Next:** the design document (architecture,
workflow and an end-to-end example), written after this one is agreed.

---

## 1. What this is

These are the advice and requirements for Part 4 of the project, the **AI Director**. It takes a
one-line brief and produces a one-take cinematic ad, through a workflow of several AI agents
connected in code.

The point of this sprint is **the orchestration**: how the agents are split, in which order they run,
what they hand to each other, where they run in parallel, where a person approves, and how a problem
is sent back to the right agent. The video at the end is the proof that the workflow runs end to end.
It is not the thing being graded. [R§1]

No new grading is built. The Prompt Coach (v1 and v2) is finished and is reused as one step inside
the workflow, for the character description only.

## 2. Stakeholders

- **Me, as owner.** I write the brief, choose the length, approve the plan, and press render.
- **Fontys assessor.** Judges how the workflow was designed and why, and whether each decision traces
  back to the research.
- **A future operator.** Wants to type a brief, approve a plan and get one video, without reading the
  internals.

## 3. Constraints

These are facts already established, not choices.

- **Seedance refuses human faces as input,** so the character can only be sent as text. [SQ3]
- **Two generations give two different people,** so the whole ad is one generation. [SQ3]
- **Products, locations and props are accepted as reference images.** [SQ3, R§2]
- **Seedance 2.5 runs 4–30 seconds.** I choose the length per ad, as in a normal ad tool. The cost
  is the seconds times the rate: on OpenRouter about $0.231 a second at 720p, so a 15-second ad is
  about $3.50. [decision log, 2026-09-16]
- **Seedance works best with labelled shots, no timestamps, one camera move per shot, and at most four
  to five references, each with a role.** [R§3]
- **The text side costs cents. The render costs dollars.** Nothing renders without a person.

## 4. The advice: the workflow

A fixed graph in code, with specialist agents at its nodes. It is not an LLM deciding at run time
who to call. [R§4]

```
                 ┌──────────────┐
  brief ───────▶ │ 1 Interrogator│ ──▶  GATE A: I answer what only I can decide
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ 2 Director   │  Higgsfield shotlist skill, adapted for one Seedance 2.5 take
                 └──────┬───────┘  → style prefix, asset list with @handles, shots in order
                        │
     ┌──────────────┬──┴───────────┬─────────────────────┐        (parallel)
     ▼              ▼              ▼                     ▼
┌────────────┐ ┌────────────┐ ┌────────────────────┐ ┌─────────────────────┐
│ 3a Product │ │ 3b Location│ │ 3c Character       │ │ 4 Cinematographer   │
│   picture  │ │  picture   │ │ avatar → describe →│ │ ONE call, all shots │
│ (image)    │ │ (image)    │ │ Prompt Coach       │ │ in order: framing,  │
│            │ │            │ │ (reused)           │ │ lens, ONE move from │
│            │ │            │ │                    │ │ a closed list, light│
└─────┬──────┘ └─────┬──────┘ └─────────┬──────────┘ └──────────┬──────────┘
      └──────────────┴────────┬─────────┴───────────────────────┘
                              ▼
                 ┌──────────────┐
                 │ 5 Assembler  │  code: builds the Seedance prompt FROM the approved plan
                 │   + checks   │  code: references ≤ 5, every shot present, length fits
                 └──────┬───────┘
          failure ──────┘ routed back to the owning agent (max 2 retries)
                        ▼
              GATE B: I approve the plan, the images and the final prompt
                        ▼
              GATE C: I see the price for the seconds I chose, and press render
                        ▼
                 ┌──────────────┐
                 │ 6 Seedance   │  one take, audio included
                 └──────────────┘
```

Why this shape:

- **A chain of specialists.** Each agent makes one kind of decision: what the brief means, what
  happens, what it looks like, where the camera is. FilmAgent's team of roles beat a single stronger
  model. [R§4]
- **Parallel where nothing depends on anything else.** The three asset branches do not need each
  other, and the Cinematographer needs only the Director's plan, so it runs alongside them. The
  shots themselves are not split: one call writes all of them in order. Parallel here means text
  and reference images only, and there is still exactly one Seedance generation. [R§4]
- **The final prompt is assembled by code, from the approved plan.** No model rewrites it at the end,
  so what I approved is what renders. This removes the most likely silent failure. [R§6]
- **Routing instead of a grader.** A check that fails in code is sent to the agent that owns that
  part: a bad camera move to the Cinematographer, a missing asset to the Director. Only that part
  is redone. It is the same idea as "the Repairer only sees failing fragments", applied across
  agents. [R§4]
- **Three gates, and only a person spends.** This is the same rule as Higgsfield's *"Claude never
  triggers generation directly."* [R§2]

## 5. Functional requirements

**Workflow**
- **FR-1.** The workflow is a graph defined in code. Each node is an agent or a code step, and every
  node declares its input and output types in `packages/contract`. [R§4]
- **FR-2.** Independent nodes run in parallel: the three asset branches, and the Cinematographer,
  which needs only the Director's plan. [R§4]
- **FR-3.** The workflow stops at three gates (brief answers, plan approval, render) and resumes from
  where it stopped. Nothing is generated twice because of a pause. [R§4]
- **FR-4.** A failed check is routed back to the node that owns the failing part, with the failure
  attached, at most twice. If it still fails, the run stops and shows why. [R§4, R§6]

**Agents**
- **FR-5. Interrogator.** Turns the brief into a filled brief: product, audience, tone, setting and
  character. It asks me only what is mine to decide (the product, the length, what must not appear)
  and decides craft questions itself.
- **FR-6. Director.** Uses the Higgsfield `seedance-shotlist-director` skill as its instructions,
  adapted for one Seedance 2.5 take. It returns:
  - a style prefix;
  - an asset list, each asset with an @handle and a one-line description;
  - the shots in order, each with the action written as visible beats and a relative weight
    (short, normal or long).

  The adaptations are no timestamps, no music-in-the-edit, and one take instead of 15-second
  blocks. [R§2, R§3]
- **FR-7. Asset branches.**
  - The product sheet (front and three-quarter view) and the location (three-quarter angle) are
    generated with Nano Banana Pro, the image model the avatar pipeline already uses.
  - The character is made by the existing avatar pipeline, and its description passes through the
    Prompt Coach. [R§2]
- **FR-8. Cinematographer.** One call writes the camera for all shots, in order, because each shot
  continues from the one before. For each shot it gives framing, lens, exactly one camera move from a
  closed list, and the light sources with their direction. [R§2, R§3]

**Assembly**
- **FR-9.** Code assembles the final prompt from the approved plan, in the order: reference roles,
  style prefix, character block, scene, `Shot 1…N`, audio in Seedance syntax, closing constraints.
  The style prefix and the character block are inserted byte-identical. [R§2, R§3]
- **FR-10.** Code checks the assembled prompt before Gate B:
  - every approved shot is present;
  - there are at most five references, each with a role;
  - every camera move is on the list;
  - the shot weights fit the length I chose. [R§3, R§6]

**Screen**
- **FR-11.** A new **Director** tab shows the whole workflow as a graph.
  - Nodes light up as they run, and parallel branches are visible side by side.
  - Each node opens to show what it produced: the brief, the plan, the images, the shots and the
    final prompt.
  - The gates are buttons on the graph.
  - The price for the chosen length is shown next to the render button.

## 6. Non-functional requirements

- **NFR-1. Agents where judgement is needed, code where exactness is needed.** The order of steps,
  assembly, checks, routing and cost are code. [R§4]
- **NFR-2. Every node logs its input, output, model, tokens, cost and time,** so a run can be
  replayed and explained step by step. This is how "how we did it" becomes visible.
- **NFR-3. The text side of one run stays under two minutes and costs a small fraction of the
  render.** [R§6]
- **NFR-4. The three new agents and the Prompt Coach use `claude-opus-5`.** The describe step stays
  on `claude-sonnet-5` (decision log, 2026-10-26). Prompt files are append-only and versioned, as in
  the rest of the repo.
- **NFR-5. Motion on the Director tab follows real state changes only,** the same rule as the other
  screens.
- **NFR-6. No key is committed,** and no test can spend money.

## 7. Trade-offs

| Decision | What it costs | Why anyway |
|----------|---------------|-----------|
| Fixed graph in code, not an LLM orchestrator | Less flexible; a new kind of ad needs a code change | The steps are known in advance, and a film plan is shared context, which is where autonomous orchestration does worst [R§4] |
| Final prompt assembled by code, not written by a model | Less free prose at the very end | What I approved is exactly what renders [R§6] |
| Several specialist agents, not one | More calls, more tokens | Specialised roles beat a stronger single model in FilmAgent; still cents next to a render [R§4] |
| Routing failures to the owner, not a grading agent | Checks only what code can check | No new grader to validate; self-grading is biased anyway [R§4] |
| One take | No cutting between generations | Two generations give two faces [SQ3] |
| Using the Higgsfield skill instead of writing my own | Needs adapting for Seedance 2.5 and one take | It is the tool the reference workflow actually uses [R§2] |

## 8. What "done" means

1. Running a one-line brief goes through every node, stops at all three gates, and ends in a
   rendered video, with every step visible on the Director tab.
2. The asset branches and the single Cinematographer call are shown running in parallel in the
   log, not one after another.
3. At least one routed failure is shown: a check fails, the right agent fixes its own part, and the
   run continues.
4. The final prompt matches the approved plan: every shot is there, and the style prefix and
   character block are byte-identical.
5. **Final result:** two different briefs rendered at the length I choose. For each, I note by hand
   whether every planned shot and camera move appears and whether the product is where it was
   planned. The workflow is what is assessed, and this is how its output is shown.
6. A short write-up of how it was built and what went wrong, in the same style as the earlier docs.

## 9. Out of scope

- Grading or scoring the shot prompts. The Prompt Coach is reused for the character only.
- UGC ads.
- Cutting several generations together.
- Face references of any kind.
- Automatic re-rendering. A render is always a person's decision.

## 10. Ethics and risk

- No real person's likeness enters the workflow. The character is a generated avatar, sent as text.
- No brand or franchise names in prompts. Props are made *"STRICTLY NO branding"*, as in Higgsfield.
- The generated person is synthetic and is labelled as such anywhere the video is shown.
- Where AI designed or wrote parts of this, it is recorded, including where it was wrong.

## 11. Delivery order

1. **Contract and orchestrator.** Node types in `packages/contract`, and a graph runner with
   parallel branches, gates, resume and routing. It is tested with fake agents first, so it costs
   nothing.
2. **Interrogator and Director.** The Higgsfield skill adapted into a versioned prompt file.
3. **Asset branches.** Product and location images, plus the character through the existing avatar
   pipeline and Prompt Coach.
4. **Cinematographer, Assembler and checks,** including the routing back.
5. **Director tab.** The live graph, the artefacts and the gates.
6. **Two briefs, rendered,** and the write-up.

## 12. Learning outcome — Advising

- **Every requirement traces back to a finding** in the research ([R§n]), so the advice can be
  checked against its source rather than taken on trust.
- **The trade-offs are stated,** including what each decision costs, not only why it was made.
- **The advice says what not to build:** no new grader, no LLM orchestrator, no multi-generation
  cutting, each with a reason.
- **Advice from outside was adapted, not copied.** The Higgsfield skill is used, but changed where
  the research showed Seedance 2.5 and the one-take constraint need something different.

---

*Made with Claude Code (Claude Opus 5.5) at my direction. Based on `docs/ai-director-research.md`.*
