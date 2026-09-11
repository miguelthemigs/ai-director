# Applied Research: The Prompt Coach

Checking a cinematic video prompt before paying to render it.

Author: Miguel Roale · MA-AAI, GenAI Engineer
Assignment: Toys R Us Studios, Orchestrating AI's First Brand Film
Date: 2026-09-07 · Framework: DOT (ICT Research Methods)

## Introduction

The assignment is to orchestrate several generative AI tools (video, voice,
music, sound) into one short film of 30 to 60 seconds, with at least five scenes
that connect into a single story. The reference case is the Toys R Us brand film
shown at Cannes Lions in June 2024, made with Sora in three weeks instead of the
usual eight to twelve.

The tools are the easy part. What decides the result happens before any tool
runs, in the prompt. The team behind the Toys R Us film said so themselves:
"When we are crafting the prompts, we use specific keywords to dial the look."

That is where my project sits. A vague brief gives a vague film, and you only
find out after you have paid for it. A 15-second vertical clip on Seedance 2 at
1080p costs 600 credits, roughly $6.00. Having a small language model read the
same prompt and grade it costs a fraction of a cent. Checking is about a
thousand times cheaper than rendering, so a pipeline that renders before it
checks is paying to learn something it could have known for free.

### What I am building

A Prompt Coach. It takes a one-line brief such as "cool ad for my headphones",
works out what the brief left out, writes the film as a sequence of stages,
scores each stage against a rubric, names what is wrong with it, and fixes that.
Only then is anything rendered.

Two things about the shape of the output, both decided by a limit rather than by
preference.

The whole film is one generation, not a set of clips glued together. Seedance
renders several stages inside a single prompt, and because it is one generation
the character stays the same person from the first stage to the last. Cutting
five separate renders together would give five different-looking people, for the
reason in Subquestion 3. So the assignment's five scenes become five stages in
one take, and that is also the honest answer to its character-consistency
question.

Audio comes out of the same generation. Seedance emits music, ambience and
spoken lines with the picture, so there is no separate voice or sound vendor and
no audio to sync afterwards. Everything is Runway, one key, one credit balance,
one spend check.

Length is decided by money. Seedance 2 runs 4 to 15 seconds and Seedance 2.5
goes to 30. My ceiling is 30 seconds, my working target is 15 or below, because
that is what keeps a run affordable enough to iterate on. How many stages fit in
that time, and how long each one gets, is the Director agent's judgement: a long
establishing stage followed by two short ones is a real editorial choice, so it
is not a fixed number I hand it.

The probe data I use as evidence in Subquestions 2 and 3 comes from live API
calls I ran myself against both providers at work. I say where each measurement
came from and what it cost.

### Motivation

I work at Mentic, an autonomous advertising company, and the video generation side of the
product is part of my job. What I actually want to build there is an AI
director: something that takes a brief and makes the decisions a director makes
about shots, camera, pacing and performance, instead of handing text to a model
and hoping. This assignment is my chance to research the piece of that I keep
running into.

That piece is the prompt. Getting a video out of an API is something I can
already do. Telling whether a prompt is good before paying to find out is not,
and that gap costs real money every week. So it is both the part I most want
solved and the part I do not yet know how to do, which is why I chose it over
something I could already finish.

Three practical reasons back that up.

Prompt quality is the bottleneck I can control. Model quality improves on its
own without me.

It can be measured cheaply. "The film looks better" is not a result. A rubric
score that moves from 58 to 89, or a refusal rate that drops from 3 in 9 to 0 in
9, is one. Grading prompts costs almost nothing, so I can iterate without
burning my render budget.

It survives the models changing. Runway's model list will look different in six
months. A rubric about what a shot prompt has to contain does not care which
model renders it.

### Main reference

The prompt recipe I build on and test is Higgsfield's published cinematic ad
workflow: https://higgsfield.ai/blog/cinematic_headphones

It is the clearest public description I found of what a professional video
prompt contains: one locked style line reused in every shot, reference sheets
for the product, character, location and props built before any scene is
written, named handles for each of those reused across cuts, and a cut-by-cut
breakdown giving camera, action and performance for every cut.

I treat it as a source to test rather than to copy. Its advice assumes a
provider that accepts character reference images, and Subquestion 3 shows that
assumption does not hold on the API I chose.

## Main research question

> How can a set of AI agents turn a vague brief into a good cinematic video
> prompt, and prove the prompt is good before any money is spent on rendering?

Three subquestions: what "good" means and whether an AI can score it (SQ1),
which video provider to use (SQ2), and how much a written description can keep a
character looking the same when the provider refuses face photos (SQ3).

The pipeline has to handle two kinds of ad, because both are things I want to
make: a cinematic brand ad, where camera work and grade carry the film, and a
UGC ad, where a person talks to the phone. They fail differently, so the rubric
has to score them differently. A cinematic stage is judged on camera move,
lighting and grade. A UGC stage is judged on delivery, pacing, and whether
spoken words and on-screen words have been kept apart.

## Subquestion 1. What makes a video prompt good, and can an AI score it?

If I invent the rubric myself, the score only repeats my own taste and proves
nothing. The criteria have to come from somewhere else and then be checked
against real results.

Three sources point at a similar list.

The Higgsfield recipe names camera and lens, motion, framing, lighting, colour
grade, a locked subject description, how the subject behaves and feels, physics
and continuity, and an explicit audio instruction.

A shot-construction contract I wrote earlier against real renders adds things a
style guide would not think of. Every stage needs a verb sequence showing change
over time, because a frozen description renders as a still image. Every stage
needs a named camera move, and "cinematic" does not count because no model can
act on it. Every stage needs an end state, which is what lets the next stage
start from somewhere. Spoken words and on-screen words need separate syntax,
which I added after a model read a written headline out loud as a voiceover.

Failures I have already hit contribute the rest. A brand or franchise name in a
prompt gets the whole request refused by the provider's moderation. A character
described in different words in stage 4 than in stage 1 comes back looking
different, even inside one generation.

Putting those together gives twelve things a stage has to say: subject, action
over time, camera (framing, angle, move, lens), lighting, colour grade,
location, product and prop binding, energy arc, audio mode, on-screen text,
duration, and physics and continuity.

That makes the question answerable. Does an AI scoring these twelve items agree
with a human scoring the same prompts? If it agrees, the score can be trusted to
hold back spending. If it disagrees, the score is decoration.

One design choice sits underneath. Scoring and fixing are two separate agents,
because a model that grades its own rewrite has an interest in the grade.
Keeping them apart also leaves me with the list of defects it found, and that
list is the only real evidence that a bad prompt became a good one.

### Research method

| Method | Strategy | Use |
|---|---|---|
| Literature study | Library | Cinematography and prompt engineering for video models |
| Best good and bad practices | Library | Pull the recipe out of the Higgsfield reference and similar published workflows |
| Available product analysis | Library | Look at how existing tools structure video prompts |
| Design pattern research | Library | Critic and repair loops, LLM-as-judge patterns |
| Prototyping | Workshop | Build the rubric and the scoring agent |
| Model evaluation (ML) | Lab | Score a fixed set of prompts, measure how much the score moves after repair |
| Model validation (ML) | Lab | Compare the AI's scores against my own blind scores on the same prompts |

Success looks like: the AI ranks a set of prompts the same way I do, and
repaired prompts score higher without breaking something else.

## Subquestion 2. Which video provider should I use?

I answered this the expensive way, by integrating both providers and probing
them with live API calls. That is what makes the comparison hands-on instead of
a reading of two documentation sets.

| Provider | Why considered |
|---|---|
| Runway | Many third-party video models behind one API, one key, one credit balance |
| Higgsfield | Cheaper published pricing, strong marketing around cinematic control |

### What Higgsfield publishes is not what you can call

Higgsfield's API specification advertises Kling, both Seedance tiers, both Veo 3
tiers and three DoP tiers. My account could actually call one video model, DoP
Lite. Everything else returned:

```
403 {"detail": "not_enough_credits"}
```

That came back while 2,138 credits sat unused on the dashboard. The error names
the wrong cause. It is a permissions problem reported as a money problem, and
working that out cost about two days.

This is a planning risk, not a complaint about taste. If what a provider
publishes, what it sells you and what its errors say all disagree, you cannot
plan around it, and two lost days costs more than the cheaper per-second price
saves.

### Runway tells you the rules up front

Runway publishes, for each model and each endpoint, which fields it accepts and
which values are legal: aspect ratios, durations, resolutions, how many
reference images, whether it does audio. The same model can differ between its
text-to-video and image-to-video endpoints. Those rules can be turned into code,
so an illegal request fails while I am building instead of after I have paid.

Behind that one interface there are eight usable video models (Seedance 2 and
2.5, Veo 3.1 and 3.1 Fast, Hailuo 3, Grok Imagine 1.5, HappyHorse 1.0, Seedance
2 Fast). Picking a different model for a difficult shot is a routing decision
inside one integration rather than a second vendor to sign up with.

It also covers the audio. Seedance generates music, ambience and dialogue along
with the picture, so the whole film comes from one call and there is nothing to
sync afterwards. That removes a second vendor, a second bill, and the
audio-visual timing problem the assignment lists as a challenge.

### Rankings have to come from outside the vendor

Runway markets `gen4.5` as its flagship, "best balance of quality and cost". On
independent leaderboards (Artificial Analysis and Arena.ai, checked 2026-08-22)
it does not appear on one at all and sits 24th of 45 on the other, while
`gen4_turbo` sits 44th of 45. Both are Runway's own models. Ranking on the
vendor's own copy would have picked the two worst models in the catalogue, so I
take rankings from third parties and record the date I checked.

### Decision

Runway, with Seedance as the default. Runway is not the cheaper option. It is
the only one where I can know what a request will do before I send it, and a
spend check needs that. You cannot quote someone a price for a model that might
turn out to be unavailable.

Seedance 2 for anything up to 15 seconds, Seedance 2.5 when a film needs the
extra length up to 30. Both carry the audio, and both hold one character across
the stages of a single generation.

### Research method

| Method | Strategy | Use |
|---|---|---|
| Available product analysis | Library | Read both providers' API specifications |
| Competitive analysis | Library | Model list, pricing shape, published constraints, error quality |
| Multi-criteria decision making | Workshop | Decide and weight the criteria before comparing |
| Benchmark test | Showroom | Live probe calls: latency, real billed cost against the quote, refusal behaviour |
| Data analytics | Lab | Compare predicted credits against what was actually charged |
| Non-functional test | Lab | Latency and failure behaviour on real submits |

The probes are done and recorded with dates, call tables and per-call cost. A
4-second 720×1280 clip with audio took 125 seconds to render. Refused requests
come back in 10 to 20 seconds and cost $0.

## Subquestion 3. How much can a written description keep a character consistent?

Seedance 2 refuses a human face in any input. I tested it as a starting frame,
as a reference image, re-uploaded through Runway's own storage, and finally as a
two-second video clip of the same picture. All refused, with the same moderation
error. The video attempt was blocked in 15 seconds for $0, before any rendering
started.

Two controls make this solid rather than a guess. The identical request with a
non-human image rendered and billed normally, so the account, the settings and
both reference modes are fine. And a render with the same
actor, same model and a product photo instead of a headshot succeeded. The only
thing that changes the outcome is a human face.

Three obvious workarounds are closed. There is no setting to turn it off: the
moderation option exists only on Runway's own two models, and none of the
third-party ones have it. A synthetic AI face is refused exactly the same way,
so making up a person does not help. And changing the file type does not help,
since image and video are both refused.

### What this decides about editing

Two generations of the same described person do not produce the same face. That
turns editing into a rule rather than a preference: anything with a face has to
come from one generation, and only shots without a face can be joined on
afterwards.

So the film is one take. Product shots, pack shots and end cards can be appended
in code, because a product is not a face and a product reference image is
accepted. Anything showing the person stays inside the single generation where
the character holds.

Locations and products are unaffected in general. They are not faces, they pass
as reference images, and they stay stable across stages. The reference layer
therefore stays simple: attach the images, name them, and paste in the same
binding sentence every time. That is something to implement and write down, not
something to research.

The character is the exception, and words are the only way it can reach the
model. What that costs is the open question:

> How much of a person does a written description actually carry, and where does
> it drift?

I am measuring this, not automating it. A loop that re-renders until a score
passes costs credits every time round with no guarantee it ever passes. Instead
the pipeline measures the drift, I rewrite the description myself, and I log
each round as a feedback cycle. A measured drift curve is a result I can defend.
A loop that ran out of budget halfway is not.

There are two drifts to measure and they are different questions. Inside one
generation, does the character still look the same in the last stage as in the
first? Across two generations from the same description, how far apart are the
two people? The first tells me whether a one-take film holds together. The
second tells me how much of a person a description carries at all, and it is the
number that decides whether cutting between generations, and so a real
multi-shot film, could ever become an option.

### Research method

| Method | Strategy | Use |
|---|---|---|
| Available product analysis | Library | Which models expose a moderation setting and which do not |
| Benchmark test | Showroom | The probe matrix: same request, one thing changed, cost recorded each time |
| Model evaluation (ML) | Lab | A vision model scores rendered frames against the reference sheet, per stage |
| Model validation (ML) | Lab | Check the drift score matches my own judgement of the same frames |
| Data analytics | Lab | Drift within a generation against drift between generations |
| A/B testing | Lab | Short description against long description, same brief, one variable |

Success looks like: a drift figure per stage and per generation, and a clear
statement of whether more detail helps, including a null result if it does not.

## Conclusions

1. "Good" can be broken into twelve things a stage has to say, taken from a
   published recipe, my own render-tested contract, and failures I have hit. The
   score only means something if the AI agrees with a human, so I test that
   rather than assume it.
2. Runway, Seedance by default: 2 up to 15 seconds, 2.5 up to 30. Chosen because
   I can know what a request will do before sending it, not because it is cheap.
   Higgsfield is out on a planning risk: what it publishes is not what it sells,
   and its error message names the wrong cause. Both findings come from live
   calls.
3. Rankings come from third-party leaderboards with the date recorded. The
   vendor's own marketing would have picked its two worst models.
4. A human face cannot reach this provider as an image, a re-upload, or a video.
   Words are the only channel.
5. Because two generations give two different faces, the film is one take.
   Anything with a face stays inside that generation, and only product shots get
   appended, in code.
6. Audio is part of the same generation, so there is no second vendor and no
   audio-visual sync step.
7. Character drift gets measured, not automatically corrected, both within a
   generation and between generations. Rewriting the description is my job,
   logged as a feedback cycle.

## Implementation direction

1. Build the twelve-item rubric and the scoring agent first. It is the cheapest
   piece to test and it sets the standard everything else is held to.
2. Add the agent that fills in the missing parts of the brief, and the one that
   writes the stages and decides how long each is.
3. Add the repair agent, closing the score, defect and fix loop in text only.
   Nothing has cost a credit yet.
4. Move the exact parts into code: the locked look line, the reference binding
   sentence, the character description, the duration fit, and the cost estimate.
   Test that they come out identical in every stage and that the stage lengths
   sum to the target.
5. Spend check, then render the one take on Runway with its audio.
6. Append product shots in code where the film needs them, and never a face.
7. Measure the character drift, within the take and between takes, and report it.

Steps 1 to 4 produce evidence without spending render credits, which is what
makes this affordable.

## Future work, out of scope here

Everything above assumes one generation per film, because that is what today's
consistency allows. If drift between generations turns out to be small, or if I
can get it small, that constraint lifts and a different kind of film becomes
possible: several generations cut together into a real multi-shot piece, with
coverage, cutaways and reverse angles instead of stages inside a single take.

That is what Higgsfield's Cinema Studio, the product behind the reference
article, is built to do. Rejecting their API on a planning risk in Subquestion 2
is not rejecting the approach. The technique is the target. The vendor question
is separate and can be reopened when their model roster and account entitlements
change.

The decision criterion already exists in this project. Subquestion 3's second
measurement, how far apart two generations from the same description are, is the
number that says whether multi-shot is available yet. I am not planning that
pipeline here. I am producing the measurement that would justify starting it.

## Sources

- Higgsfield, *Cinematic Headphones* production workflow,
  https://higgsfield.ai/blog/cinematic_headphones
- Toys R Us Studios / Native Foreign brand film, Cannes Lions, June 2024
- Runway API model constraints and error documentation
- Higgsfield published API specification v2.0.0
- Artificial Analysis and Arena.ai video model leaderboards, checked 2026-08-22
- My own probe runs against Runway and Higgsfield, 2026-08-13 to 2026-08-30,
  recorded with dates, call tables and per-call cost
- ICT Research Methods, DOT framework, https://ictresearchmethods.nl
