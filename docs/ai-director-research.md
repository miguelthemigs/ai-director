# Applied Research: The AI Director

**Focus:** how several AI agents, orchestrated into one workflow, turn a vague brief into a one-take
cinematic ad.

## 1. Why this research

The main research question has two halves:

> How can a set of AI agents turn a vague brief into a good cinematic video prompt, and prove the
> prompt is good before any money is spent on rendering?

Sprints 1 to 2 covered the second half. The Prompt Coach grades a character description, quotes what
failed, and repairs only that. Repairer v2 saw the character sheet, stopped inventing details, and the
renders confirmed it. Good enough to build on.

This sprint covers the first half: the AI director (Part 4 of the plan).

The hard part is not any single agent. It is **orchestration**: specialist agents running in the right
order or in parallel, handing structured work over without losing it, and pausing where a person
should decide. So the sprint is judged on how the workflow was built and why, before what the video
looks like.

**Scope, set before the research:**

- **One take.** SQ3 showed two generations give two different people. The ad is one Seedance 2.5
  generation (4 to 30 seconds) with several shots inside.
- Product and location go in as reference images. The character goes in as text, because faces are
  refused.

**Methods (DOT framework).**

| Method | Strategy | Used for |
|--------|----------|----------|
| Best good and bad practices | Library | Higgsfield's ad workflow and its Claude skill (§2) |
| Available product analysis | Library | Higgsfield Cinema Studio, Popcorn, Camera Controls, Soul ID (§2) |
| Competitive analysis | Library | Seedance vs Veo 3.1, Sora 2, Kling, Runway Gen-4 (§3) |
| Literature study | Library | Multi-agent film systems and orchestration (§4) |
| Design pattern research | Library | Chaining, routing, parallelisation, orchestrator-workers, evaluator-optimizer (§4) |
| SWOT analysis | Showroom | What the project already has and what is missing (§5) |

## 2. How Higgsfield directs a cinematic ad

Higgsfield's headphones ad is the most complete public example, and was already the main reference of
SQ1. This time I read it as a workflow.

**The tools.** GPT Image 2 makes product sheets and schematic maps. Soul Cinema and Cinematic Locations
make the character and location stills. Seedance 2.0 makes the scenes. A Claude skill
(`seedance-shotlist-director`) writes the prompts. It is already an orchestration of several AI
systems, just done by hand.

**Step 1: make every asset first.** *"Locking them up front is what keeps everything consistent once
the camera starts moving."*

- **Product sheet:** front and 3/4 views from one real photo, so the product is identical in every cut.
- **Character sheet:** face close-up and full body on plain grey, one face only (more faces make the
  model drift). One sheet per state (`@hero`, `@s_hero_wet`).
- **Locations:** 3/4 angle, giving the camera depth to move through.
- **Props:** clean studio shot, no branding.
- **Schematic:** a top-down map. *"Text can't hold a location down; a map can."*

**Step 2: name every asset.** Each gets an @handle, used in both the asset store and the brief to
Claude. The handle is the contract between steps: the writer only needs the name and a one-line
description.

**Step 3: the Claude skill writes the shotlist.** Every prompt has four parts:

1. **Style prefix**, identical in every prompt: lighting, lens, acting, continuity (*"No identity
   drift"*), 24fps, audio.
2. **Characters:** handle plus full text description, repeated every time.
3. **Scene:** location handle plus where people stand.
4. **Cuts:** `CUT n — framing, lens, camera move (seconds): action and performance`.

Conventions: cuts of 2–3 seconds, lens in mm, performance spelled out beat by beat (*"'he dances'
alone gives generic flailing"*), emotion shown as physical behaviour, every camera move with a motive.
Music is added in the edit. The skill targets 15-second prompts.

**Higgsfield's products point the same way:**

- **Cinema Studio 3.5** has a Claude "AI Director" that splits a script into shots, but *"Claude never
  triggers generation directly."* Planning and spending are separate, with a person in between.
- **Cinema Studio 4.0** runs on Seedance 2.5 (up to 30 seconds, 50 references).
- **Camera Controls** is a closed list of about 65 named moves. A closed list is something code can
  check.
- **Soul ID** trains a face from 20+ photos. The opposite of what this project can do over the
  Seedance API.

**What transfers:**

| Higgsfield step | Transfers? | Why |
|-----------------|------------|-----|
| Product, props, locations, schematic | Yes | Not faces, so Seedance accepts them |
| @handles | Yes | A naming rule, not a tool feature |
| Style prefix reused verbatim | Yes | Code inserts it, so it cannot drift |
| The Claude shotlist skill | Yes | Becomes the Director's instructions |
| Character re-described as text | Yes | Already the only channel this project has |
| Character sheet sent to the video model | No | Seedance refuses faces (SQ3). The avatar pipeline makes the sheet, a vision model describes it, the Prompt Coach cleans it |
| Several 15-second prompts cut together | No | Two generations give two faces. One take |
| Music added in the edit | Changed | No edit step. Seedance generates audio in the same call |

**What this means.** The workflow is assets (with handles) → shotlist → video, stitched together by a
person copying names and prompts. Automating that copying, in order and without losing anything, is
the orchestration this sprint builds.

## 3. What the video model needs

I checked the Higgsfield skill against the vendors' own guides.

| Rule | Seedance | Veo 3.1 | Sora 2 | Kling | Runway Gen-4 |
|------|----------|---------|--------|-------|--------------|
| Same slots: subject, action, setting, camera, light, style, audio | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sentences, not keyword lists | ✓ | ✓ | ✓ | – | ✓ |
| One camera move and one action per shot | ✓ | – | ✓ | – | ✓ |
| Each shot as a labelled block | ✓ | timestamps | beats | up to 6 shots | – |
| Exact per-shot timings | ✗ "unstable" | ✓ | – | – | – |

**Seedance rules that change how the agents work:**

- **Label shots in order.** Without labels the model cuts where it wants.
- **No timestamps.** Timing support is unstable. The Director still plans shot length and code checks
  it fits, but the prompt carries no seconds. This is the one place the skill is adjusted.
- **One move per shot.** Several at once makes the image unstable.
- **Give every reference a role, max four to five.** An unassigned reference leaks its colour into the
  shot.
- **Audio in its syntax:** `{dialogue}`, `(music)`, `<sound effects>`.
- **End with constraints:** no subtitles, logo or watermark. Avoid sprints, jumps and violent motion.

**What this means.** Higgsfield and the vendors agree on almost everything. Three changes for one
Seedance 2.5 take: no timestamps, max five references with roles, audio in Seedance syntax.

## 4. How AI-director systems split the work

| System | How it works | Lesson |
|--------|--------------|--------|
| FilmAgent (2025) | Director, Screenwriter, Actors, Cinematographers in stages, with a capped critique loop | GPT-4o as a team (3.98) beat GPT-4o alone (3.04) and o1 alone. Splitting roles beat a stronger model |
| MovieAgent (2025) | Director → scene plan → shot plan | Each level adds detail to a structured object |
| Anim-Director (2024) | One GPT-4 planner calling tools | Specialisation is a choice, not a must |
| DreamFactory (2024) | A fixed "Base Description" conditions every keyframe | A fixed block keeps style consistent |
| StoryAgent (ICLR 2025) | User approves each stage | The AI Observer was unreliable and removed |
| VideoDirectorGPT (2023) | Planner + generator | The plan is a data structure, not prose |
| Hollywood Town (2025) | Cyclic graph *"with limited retries"* | Later steps can send work back, with a cap |
| Co-Director (2026) | — | Chains of handcrafted prompts cause *"semantic drift and cascading failures"* |

Three things repeat: the plan is structured data, something fixed carries consistency (not an agent's
memory), and loops are capped.

**Orchestration patterns.** Anthropic separates workflows (fixed code paths) from agents that direct
themselves, and advises the simplest solution that works.

| Pattern | Use in the AI Director |
|---------|------------------------|
| Prompt chaining | Brief → plan → shots → final prompt |
| Parallelisation | All reference images at once, with the Cinematographer running alongside them |
| Routing | A failed check goes back to the agent that owns it |
| Evaluator-optimizer | Only where it exists: the Prompt Coach on the character |

There are five common ways to make AI agents work together. The AI Director uses three of them,
reuses one that already exists, and skips one on purpose (orchestrator-workers: the steps of an ad are
known in advance).

- **Prompt chaining: one after another.** Like an assembly line. Each agent takes what the one before
  it made and adds its own part. The Interrogator works out the brief, the Director turns it into
  shots, the Cinematographer adds the camera to every shot, and code puts it all together into the
  final prompt.
- **Parallelisation: at the same time.** Work that doesn't depend on other work doesn't wait. The
  product picture, the location picture and the character are made at the same time. The
  Cinematographer runs alongside them, because it only needs the Director's plan, not the pictures.
  The shots themselves are **not** split up: each shot has to follow the one before (where the camera
  ends, where the light comes from, which way someone walks). So one Cinematographer call writes the
  camera for all shots, in order. Seedance is still called once.
- **Routing: send the problem to whoever made it.** When code finds a mistake, it sends it back only
  to the agent responsible for that part. If shot 2 has two camera moves, the Cinematographer fixes
  shot 2 and keeps the others as they were. Each fix gets at most two tries; after that the workflow
  stops and shows the problem.
- **Evaluator-optimizer: one makes, another checks.** This is how the Prompt Coach already works: the
  Evaluator scores and the Repairer fixes. It is reused only for the character description. Nothing
  new is graded.

**What this means.** The AI Director is a fixed route written in code. Specialists work one after
another, independent work happens at the same time, and mistakes go back to whoever made them. I
approve the brief and the plan, and only I can press render.

## 5. What already exists in this project

| Strength (reuse) | Weakness (build) |
|------------------|------------------|
| Avatar pipeline: sheet → vision description → Prompt Coach | Agents for the brief, shotlist and camera |
| Prompt Coach v2 (Evaluator and Repairer) | Product, location and prop references with handles |
| OpenRouter client for Seedance 2.5 with cost estimate | An orchestrator running the graph with gates and routing |
| Live event stream and Architecture screen | A Director tab showing the workflow and its artefacts |
| Append-only, versioned prompt files | Code that assembles the final prompt from the approved plan |

| Opportunity | Threat |
|-------------|--------|
| The Prompt Coach becomes one node in a bigger graph | More agents means more latency and cost |
| The Higgsfield skill already exists and is tested | It targets Seedance 2.0 in 15-second blocks, so it needs adjusting |

## 6. Conclusions

This sprint answers the first half of the main question. The challenge is orchestration.

- **Higgsfield's workflow is the model:** assets with handles, then a Claude skill writing prefix,
  characters, scene and cuts, then the video.
- **Three things change:** the character travels as text through the avatar pipeline and Prompt
  Coach; the ad is one Seedance 2.5 take; the prompt follows Seedance's rules.
- **The steps are always the same, so they are written in code, like a recipe.** Each step is one
  agent with one job: one works out the brief, one writes the shots, one handles the camera. Steps
  that don't need each other run at the same time. A mistake goes back only to the agent that made it.
  Nothing is made or paid for until I have looked at the plan and said yes.

**What changed during the research.**

- **Parallel shots: kept, then removed.** My first design wrote the camera for each shot in its own
  call, all at the same time. Reviewing the design in conversation with the AI, I saw that this breaks
  the story: shot 2 has to continue from shot 1. Now one call writes the camera for all shots in order,
  and only the pictures run in parallel.
- **Cut for length.** I removed parts that were too long for what they added, such as a separate
  section on failure modes and extra detail on each tool, and made the rest shorter. What stayed is
  what the design actually uses.

## 7. Learning outcome: Analysing

- **I placed the problem before solving it.** Part 4 is tied to the main question, and I explain why
  the Prompt Coach is finished enough to build on (§1).
- **I weighed several kinds of source.** Practitioner, vendor, research and orchestration sources, and
  I flagged where they disagree: timestamps work for Veo, not Seedance (§3).
- **I filtered a reference instead of copying it.** I separated what transfers from what the face
  constraint blocks (§2).
- **I questioned a tool I am going to use.** The skill writes seconds and 15-second prompts, so it is
  adjusted, not used blindly (§3).
- **I questioned my own design.** Parallel shots looked faster, but a review showed they break the
  story, so I changed it (§6).
- **The analysis turns into requirements.** Each conclusion becomes a numbered requirement in the
  advice document.

## 8. Sources

Checked 11 October 2026 unless dated otherwise. Papers marked "abstract only" were not read in full.

**Higgsfield**

- "3-Step Workflow To Make Ultra-Realistic AI Ads", 22 Jun 2026 · https://higgsfield.ai/blog/cinematic_headphones
- Headphones ad shotlist · https://static.higgsfield.ai/final-shotlist-headphones-ad.html
- `seedance-shotlist-director` Claude skill (downloaded from the article; read locally)
- Seedance 2.0 prompting guide, 13 Apr 2026 · https://higgsfield.ai/blog/seedance-prompting-guide
- Cinema Studio · https://higgsfield.ai/creator-hub/help-center/tools-and-workflows/how-do-i-use-cinema-studio
- Camera Controls · https://higgsfield.ai/camera-controls
- Popcorn · https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-popcorn
- Soul ID · https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
- Cinematic ad course · https://higgsfield.ai/academy/courses/cinematic-ad-e2e/intro

**Video model guides**

- Runway, "Seedance 2.0 prompt guide", 24 Sep 2026 · https://runway.com/resources/seedance-2-0-prompt-guide
- fal.ai, "How to use Seedance 2.0", 10 Apr 2026 · https://fal.ai/learn/tools/how-to-use-seedance-2-0
- Google Cloud, "Ultimate prompting guide for Veo 3.1", 16 Oct 2025 · https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
- OpenAI, Sora 2 prompting guide · https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide
- Kling, text-to-video prompt guide · https://kling.ai/quickstart/text-to-video-prompt-guide
- fal.ai, "Kling 3.0 prompting guide", 5 Feb 2026 · https://blog.fal.ai/kling-3-0-prompting-guide/

**Multi-agent film and video systems**

- Xu et al., FilmAgent, 2025 · https://arxiv.org/abs/2501.12909
- Wu, Zhu, Shou, MovieAgent, 2025 · https://arxiv.org/abs/2503.07314
- Li et al., Anim-Director, 2024 · https://arxiv.org/abs/2408.09787
- Lin et al., VideoDirectorGPT, 2023 · https://arxiv.org/abs/2309.15091
- Xie et al., DreamFactory, 2024 · https://arxiv.org/abs/2408.11788
- Hu et al., StoryAgent, ICLR 2025 · https://arxiv.org/abs/2411.04925
- Hollywood Town, 2025 · https://arxiv.org/abs/2510.22431 (abstract only)
- Co-Director, 2026 · https://arxiv.org/abs/2604.24842 (abstract only)
- FilMaster, 2025 · https://arxiv.org/abs/2506.18899 (abstract only)
- MAViS, 2025 · https://arxiv.org/abs/2508.08487 (abstract only)

**Orchestration**

- Anthropic, "Building effective agents" · https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, "How we built our multi-agent research system" · https://www.anthropic.com/engineering/multi-agent-research-system
- Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST), 2025 · https://arxiv.org/abs/2503.13657
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet", ICLR 2024 · https://arxiv.org/abs/2310.01798
- Panickssery, Bowman, Feng, "LLM Evaluators Recognize and Favor Their Own Generations", 2024 · https://arxiv.org/abs/2404.13076
- ICT Research Methods, DOT framework · https://ictresearchmethods.nl

**Own project**

- Applied Research, The Prompt Coach (SQ1–SQ3); `docs/repairer-v1-vs-v2-results.md`; `docs/decision-log.md`

---

*Made with Claude Code (Claude Opus 5.5) at my direction. Four research agents read the sources in
parallel. I set the scope (one take, cinematic only, orchestration over output quality), reviewed
every part in conversation with the AI, and made the final calls, including dropping the parallel
shots.*
