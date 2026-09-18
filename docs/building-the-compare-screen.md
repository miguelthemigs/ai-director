# Building the Compare screen

**Date:** 16 September 2026
**What got built:** a fourth screen that renders the same avatar twice, from the description
before the repair passes and after, and shows every step of how it got there.
**What it cost:** nothing yet. No render has been paid for.

---

## 1. What I asked for

Three things, in this order.

Move the video provider from Runway to OpenRouter, copying how we did it in the Mentic repo,
because it is cheaper. Then build a screen that renders two clips side by side from one
avatar: the description as the describe step wrote it, and the description after the repair
passes. Same avatar, same seconds, same resolution, minimum seconds, 480p if it exists and
720p if it does not.

Then, partway through, I said the thing that changed the project: our avatar's description
says his hair is shoulder-length and it is not. I asked why.

Three corrections followed, and each one was a real change of direction.

**No paid calls.** I run those. The agent builds the thing and proves it with a dry run.

**Two clips, not three.** It wanted to render the v1 repair as well, as a third panel. v1 is
the repairer that invented the hair; rendering it shows a different person, which tells me
something about v1 and nothing about repair. Cut it.

**Not a script.** It built the pipeline and then a command-line tool to drive it, when the
point was always to see it run. I said so and it rebuilt the screen so the whole thing
happens there.

The last one is worth writing down because it happened twice in one day, and the second time
it was subtler. The first version of the screen could render a comparison, but to produce a
v2 run you had to go to a different screen, use the Pipeline tab, come back, and hope you
picked the right run out of a list of UUIDs that did not say which repairer made them. That
is technically a screen and practically still a script with a form on it.

---

## 2. Why the provider changed

A conversation with my teacher reopened a decision I had already closed. I had Runway and I
had stopped thinking about it.

The route is not the model. OpenRouter serves the same Seedance 2.5 weights on a different
wire, at $0.231 per second at 720p against Runway's $0.30, which is 23 percent off. Mentic
measured that on a real eight-second render on 15 September, not off a price page. The number
I had in my head was about a third; the measured figure is 23 percent, and 23 percent is what
goes in a document a teacher reads.

The tradeoff is that the 1080p rung does not come across, and it costs me nothing. SQ2 had
already put the film in 720p native, in medium and wide framing. I was not going to render
1080p.

480p turned out to exist. OpenRouter publishes `480x854` for this model, and the engine floor
is four seconds. So the cheapest honest pair is 4 seconds at 480x854, about $0.41 a clip and
$0.83 for the two. That is the default, and 720x1280 is the second option at $1.85 a pair.

---

## 3. What I found by looking

The description says shoulder-length. The sheet says medium-length. I noticed that by looking
at the avatar and reading the sentence under it, which is not a sophisticated technique.

What the investigation turned up is that the Repairer wrote it, and five other things beside
it. Run `bee3bcd6`, three passes, terminal status `passed`:

| Pass | What the Repairer added | True of the sheet? |
|---|---|---|
| 1 | a small dark mole below his left eye | No |
| 1 | a thin pale scar crossing his right eyebrow | No |
| 1 | a flat silver ring on his right index finger | No |
| 2 | shoulder-length hair, parted on the left | No. The sheet says medium-length. |
| 2 | about 5 foot 8 | No. The sheet says 1.78m, which is 5 foot 10. |
| 2 | lean, narrow-shouldered build with slim arms | No. The sheet says average build. |

`hair_spec` and `age_build` both went from band 3 to band 5 on those inventions. The run
finished at a hundred percent.

The cause is structural rather than a bad prompt. `describeImage` is the only step that ever
sees the character sheet; it turns the picture into one sentence and the picture is dropped.
Everything after it works on text. So the Repairer is handed "wavy brown hair", told that
`hair_spec` reaches band 5 with colour and texture and style, and told to write observable
facts. It has nothing to observe with. Inventing is the only way to obey.

The full trace is in `docs/repairer-cannot-see.md`. The fix, Repairer prompt v2, sends the
sheet with the failing fragments and adds one rule: a check asking for a detail the sheet does
not show is left unsatisfied rather than filled in.

**Height is the exception, and it is my call.** The description's only reader is a video
model, where a height is a render directive: it sets how far off the ground the head sits and
how the person fills a standing frame. Banning it to keep the Repairer from guessing would
cost the video the one cue a full-body plate most needs. So v2 is given the avatar's brief as
well as the picture, and may state a height only when that brief states one. For this avatar
the brief says 1.78m, which is the number Nano Banana rendered the sheet from.

Worth knowing where that number came from: my guided form says "average height", and the
doctrine call turned that into 1.78m when it expanded the fields into an image brief. It is a
model's choice one step upstream from where I thought it was. It is still the right source,
for a reason that does not depend on who chose it: the sheet was rendered from that text, so
it describes the picture whatever its provenance.

---

## 4. Three things the agent got wrong, and how each was caught

This is the part worth the most, because none of the three was caught by a test passing.

### It built v2 and shipped it dead

The prompt existed. The version vocabulary existed. `statedFactsFor` existed. Eight unit tests
covered them and all eight passed. No caller could reach any of it: every run recorded `v1`,
and the Versions tab sealed a `repairer-prompt-v2` that no code path could run.

A code review found it. Each piece was correct in isolation and nothing tested the seam
between them. That is the same shape as the defect in section 3: a component doing its job
correctly with no way to check the thing it was supposed to affect.

Then it half-fixed it. `POST /runs` was made to accept an `avatarId`, and nothing sent one, so
v2 stayed unreachable. `SheetPipeline` had the avatar id the whole time and dropped it at a
callback boundary. I had to say "if they are unwired, you have to wire them" before the chain
ran end to end.

### A refresh could turn a paid render into a free failure

Also from the review. A render that succeeded, was billed, and whose clip failed to download
was being re-checked on refresh. By then OpenRouter answers `expired`, which classifies as
failed and carries no cost. So pressing a button rewrote a 41-cent render that happened into
one that failed and cost nothing.

Its first attempt at the fix introduced a worse bug: it called `claimSubmit` to test whether a
claim existed, which *takes* the claim and would have permanently blocked a legitimate submit.
It caught that one itself before committing.

### One CSS class made every character its own line

The description on the new screen borrowed a class name, `.specimen`, that the Run screen
already uses for a `display: grid` block with a line-number column. Inheriting that grid put
every single character on its own row. One letter per line, 1725 pixels tall.

All 200 frontend tests passed. They pass because jsdom computes no layout and the text was
present, complete and in the right order. It took opening a real browser and looking at a
screenshot. This is the second time on this project that a real browser found something 300
green tests did not, and both times it was CSS.

---

## 5. What the screen does now

Three steps, all in one place.

**1. Who.** The avatars as character sheets, not a row of UUIDs. The screen's whole subject
is whether a rendered person still looks like a particular someone, so the picker shows faces.
An avatar with no description yet is shown and disabled with the reason, rather than hidden:
"that avatar is not ready" and "that avatar is gone" are different facts.

**2. Grade and repair.** A button that runs the grade-and-repair here, naming the avatar so
the Repairer gets the sheet and runs v2. The run's own wire events stream onto the screen as
they land: which group is being scored, what bands came back, which fragment went to the
Repairer and what it gave back. Under it, the runs already graded for this avatar, each row
labelled with the repairer that wrote its "after". v2 saw the sheet, v1 was blind, and a run
that predates the record says exactly that instead of being labelled v1 on a guess.

**3. Render both.** Seconds, size, the estimate derived from both, and the one button on the
screen that spends money, with the price next to it before it is pressed.

Then the pair itself, a re-read button that takes one status read per unfinished side and can
never submit, and the history of every pair ever rendered.

**The wire inspector** is the part I would point a reader at. It prints both prompts exactly as
they were sent, the endpoint, the task ids, the poll counts and the description hashes, and it
states as a verdict whether the two prompts differ anywhere except the description. That is
the claim the entire screen rests on, and nobody has to take it on trust.

No spinners anywhere. Progress is a count of status reads, which only moves when a poll
actually returned. A spinner spins whether or not anything is happening.

---

## 6. What I learned

**Asking twice is not nagging.** The provider decision was closed until my teacher asked about
it, and asking found a quarter of the render budget. The description was correct until I read
it against the picture, and reading it found six invented facts. The screen was finished until
I asked why it was a script, and asking produced the thing I had wanted from the start. None
of the three was hard. All three needed somebody to go back and ask again.

**Correct parts do not make a working whole.** v2 had eight passing tests and could not be
reached. The Repairer satisfied nine checks and described a different man. The description
rendered every character correctly, one per line. In each case the unit was right and the
thing it was supposed to affect was never checked.

**Tests that cannot see are the same defect as a repairer that cannot see.** jsdom computes no
layout, so a layout bug reads as green. The rubric compares no picture, so a fabrication reads
as band 5. Both are graders being asked about something they have no access to, and in both
cases the score went up while the truth went down.

**Cheap evidence first, every time.** The instinct was to render the comparison and watch the
drift appear on video, at 83 cents and a screen's worth of work. The same finding was already
sitting in six JSON files on disk. Reading them cost nothing and gave a mechanism as well as a
symptom, which the video would not have.

**Write down the thing you would rather not.** The version note for v2 says the expected effect
is a lower score. The decision log says which pre-registered clause this is adjacent to and
explicitly does not claim it. The commit for the wiring says v2 shipped dead. A project that
only records its wins is a project whose records are worth nothing.

---

## 7. What is still open

**No clip has been rendered.** Everything is built, tested and proved with a dry run that
resolves both descriptions and prints the price without calling OpenRouter. The first real pair
is mine to run.

**No v2 run exists yet either.** Every run on disk predates the record and is honestly labelled
"repairer version not recorded". The comparison worth making is a v2 run against its own raw
describe output, and step 2 of the screen is how that gets made.

**Whether v2 actually holds its bands is a prediction, not a result.** Reading the rubric check
by check says it should: `hair_spec`, `face_skin` and `wardrobe` all ask for things a sheet
shows, and `age_build` is reachable through either the stated height or a visible proportion.
`anchor_marker` wants two or more localised markers and is the one check that can honestly
fall. If v2 drops much further than that, the prompt is being read as "say less" rather than
"say what you see", and that is a defect in v2 rather than a finding about the rubric.

**A gallery of every clip ever rendered.** Not built, and deliberately so: this is an idea
for later rather than a gap in what exists. The history table lists pairs as rows and you
open one at a time, which is right for reading a single comparison and wrong for the
question "what have I actually produced". Every clip is already on disk under
`data/comparisons/<id>/`, so the material is there; what is missing is a screen that shows
them all as playable thumbnails, which is how you would spot that five renders of one
identical prompt gave five different faces without opening five pages.

**Whether Seedance refuses a human likeness on the OpenRouter wire is unprobed.** Mentic
measured that refusal over nine calls on Runway in August, and it is the reason a description
travels as text at all. A different vendor in front of the same weights is not the same test.
