# The Repairer cannot see

**Date:** 16 September 2026
**Status:** defect confirmed from stored runs. No renders were paid for to find it.
**Fix:** repairer prompt v2.

---

## 1. What I asked for

I asked for two things. Move the video provider from Runway to OpenRouter, copying how we did it
in the Mentic repo, because it is cheaper. Then build a new screen that renders two clips side by
side from one avatar: the description as it came out of the describe step, and the description
after the repair passes. Same avatar, same seconds, same resolution. Only the words change.

The point of the screen is to answer a question the rubric cannot answer about itself. The rubric
says the repaired description is better. A video is the only thing that can say whether the person
in it still looks like the person on the sheet.

Then I mentioned something I had noticed by eye. Our avatar's description says his hair is
shoulder-length. It is not. It is shorter than that. I asked why it was saying that.

---

## 2. Why the provider changed

A conversation with my teacher reopened a decision I had already closed. I had Runway and I had
stopped thinking about it.

The route is not the model. OpenRouter serves the same Seedance 2.5 weights on a different wire, at
$0.231 per second at 720p against Runway's $0.30, which is 23 percent off. Mentic measured that on
a real eight-second render on 15 September, not off a price page. The number I had in my head was
about a third; the measured figure is 23 percent, and 23 percent is what goes in a document a
teacher reads.

The tradeoff is that the 1080p rung does not come across, and it costs me nothing. SQ2 had already
put the film in 720p native, in medium and wide framing. I was not going to render 1080p. Giving up
something I had already decided not to use is not a compromise.

The reason this sits in a findings document rather than a changelog is that it is the same lesson
as section 7, arriving from the other direction. I closed a decision, stopped looking at it, and
someone asking about it found a quarter of the budget. Below, I trusted a score and stopped looking
at the avatar, and looking found six invented facts. Neither was hard. Both needed somebody to ask
again.

---

## 3. What was found

The Repairer wrote it. It was not in the description the describe step produced, and it is not
true of the sheet.

Run `bee3bcd6-3f0d-4b43-9a86-efc03a58b051`, 12 September, three passes, terminal status `passed`.
Avatar `eaa18108-4b38-408f-b683-2fc897ce2537`.

The sheet prompt that rendered the image says:

> HAIR: medium-length wavy brown hair, side part, natural texture
> BUILD: about 1.78m, average build, medium frame, straight posture

The describe step read that image and wrote:

> A young man in his mid-twenties with wavy brown hair, green eyes, light stubble and fair skin, of
> average build and medium height, wearing a black crewneck sweater, dark jeans and black leather
> shoes.

Vague, but nothing in it is false. Then the repair passes ran.

| Pass | What the Repairer added | True of the sheet? |
|---|---|---|
| 1 | a small dark mole below his left eye | No. Not in the sheet prompt. |
| 1 | a thin pale scar crossing his right eyebrow | No. Not in the sheet prompt. |
| 1 | a flat silver ring on his right index finger | No. Not in the sheet prompt. |
| 2 | shoulder-length hair, parted on the left, tucked behind the ears | No. The sheet says medium-length. |
| 2 | about 5 foot 8 | No. The sheet says 1.78m, which is 5 foot 10. |
| 2 | lean, narrow-shouldered build with slim arms | No. The sheet says average build, medium frame. |

Six invented details across two passes. Three of them contradict the sheet outright; the other
three are features the person does not have.

The bands moved the way you would want them to:

| Check | Pass 1 | Pass 2 | Pass 3 |
|---|---|---|---|
| `hair_spec` | 3 | 3 | 5 |
| `age_build` | 3 | 3 | 5 |
| `anchor_marker` | 1 | 5 | 5 |

The run finished `passed`, with all nine checks at band 4 or above, which the UI reports as 100
percent.

---

## 4. Why it happens

The Repairer has never been given the image. It is not a bug in the prompt wording, it is the
shape of the pipeline.

`describeImage` is the only step in this repo that sees the character sheet. It turns the picture
into one sentence and the picture is then dropped. Everything downstream works on text alone:
the Evaluator, the Repairer, the splice and the gate. I checked `agents/repairer/run.ts` and
`orchestrate/runPass.ts` for any reference to an image, a sheet, or base64 bytes. There are none.

So the Repairer is handed the fragment "wavy brown hair", told that `hair_spec` wants colour and
texture and style to reach band 5, and told in rule 3 of its own prompt to "replace with observable
facts a video model can draw". It cannot observe. It has nothing to observe with. The only way to
satisfy the instruction is to make something up that sounds like an observation, and that is
exactly what it does.

The design note in `agents/repairer/run.ts` says the Repairer only ever sees failing fragments and
never the whole description. That rule is right and it is not the problem here. Showing it the
whole description would not have helped: the length of the hair is not in the description either.
It is in the image, and the image was thrown away three steps earlier.

---

## 5. What this means for the rubric

The score and the truth are moving in opposite directions. Every band that rose in that run rose
because a detail was invented. A description scoring 100 percent now describes a man with a
different height, a different build, a scar, a mole and a ring.

This is close to the second clause of the pre-registered failure condition in
`docs/decision-log.md`:

> Repaired descriptions score higher on the rubric while a later render comparison shows no
> reduction in identity drift or refusal rate.

It is not that clause yet, and the difference matters. The clause requires a render comparison,
and no renders have been made. What exists is a mechanism that predicts the clause will hold, plus
six worked examples of that mechanism running on a real run. That is stronger than a hunch and
weaker than a result, and it gets reported as what it is.

The order it happened in is worth recording. The comparison screen was meant to be the instrument
that caught this, and it caught it before it was built, out of JSON files that were already sitting
on disk from 12 September. That is the return on writing every intermediate step to disk instead of
holding it in memory.

---

## 6. What v2 changes

The Repairer gets the sheet.

The v1 prompt stays exactly where it is, unedited. Prompt files here are append-only, and there is
a second reason on top of the rule: v1 is the thing that produced the evidence in section 3, and a
result you can no longer reproduce is not a result. A run can still be made on v1 deliberately.

`prompt-v2.ts` ships beside it. The image travels with the failing fragments, and the rules change
in one direction: every replacement has to be something visible in the sheet, and a check that
demands a detail the sheet does not show is to be left unsatisfied rather than filled in. A
description that honestly scores band 3 on `hair_spec` is more useful than one that scores 5 on
hair the person does not have.

Height is the exception, and it is the owner's call of 16 September. The description's only reader
is a video model, where a height is a render directive rather than a trivium: it sets how far off
the ground the head sits, how the person fills a standing frame, and how they scale against
anything else in shot. Banning it to keep the Repairer from guessing would cost the video the one
cue a full-body plate most needs.

So v2 is given the avatar's brief alongside the picture, and may state a height only when that
brief states one, copied without adjustment. For avatar `eaa18108` the brief says 1.78m, which is
the number Nano Banana rendered the sheet from, so it describes the picture by construction. Worth
knowing where the number itself came from: the guided form says "average height", and the doctrine
call turned that into 1.78m when it expanded the fields into an image brief. It is a model's choice
one step upstream, and it is still the right source, because the sheet was rendered from this text
whatever its provenance. A number the image was conditioned on beats a number inferred from the
image afterwards. An uploaded sheet has no brief, so no height is known and the Repairer is held to
proportion cues.

That does make part of the pipeline circular, and the circle is bounded rather than hidden. The
Repairer sees the brief only alongside the failing fragments it already had, never the whole
description, so the brief can only reach words a check has already rejected. `describeImage` never
sees it, and the agreement study grades `describeImage`. What the study measures is untouched.

The rubric was then read check by check to predict the effect, because "it will score lower" was a
first guess and the rubric does not support it. Band 5 of `hair_spec`, `face_skin` and `wardrobe`
asks only for things a character sheet shows, so v2 should hold band 5 on all three and simply be
true for the first time. `age_build` band 5 wants an age bracket, a build and a height OR
proportion cue, and v2 can now satisfy it through either arm: the real height when the brief states
one, a visible proportion when it does not. `anchor_marker` band 5 wants two or more
localised markers and is the one check that can honestly fall, and only when the render shows fewer
than two.

So the prediction is: unchanged on most checks, truthful where v1 was not, and a possible drop on
`anchor_marker` alone. A large fall anywhere else means the prompt is being read as "say less"
rather than "say what you see", which is a defect in v2 and not a finding about the rubric.

The run record now carries which prompt version repaired it, so a v1 result and a v2 result can
never be confused on a screen or in a study.

---

## 7. What I learned

**The grader could not check the thing it was grading.** Nine checks on how a person is described,
and not one of them could compare the description to the person. They grade the prose. Specificity
reads as quality to a check that has no way to test whether the specific thing is true, so the
fastest way to a high band is to be confidently wrong. I built a rubric that rewards fluent
invention and did not notice until I looked at my own avatar and disagreed with it.

**Noticing beat measuring.** No test caught this. 341 of them pass. The agreement study would not
have caught it either, because it measures whether two graders agree with each other, and two
graders reading the same text with no picture would agree that the hair is well described. It was
caught by looking at a face and reading a sentence about it.

**Cheap evidence first.** The instinct was to build the render comparison and watch the drift
appear on video. That is two clips, about 83 cents, plus the screen to show them. The same finding
was sitting in six JSON files that were already written. Reading those cost nothing and gave a
mechanism as well as a symptom, which the video would not have.

**Keeping the broken version is part of the fix.** The temptation is to edit the v1 prompt and move
on. Then the evidence in section 2 becomes unreproducible and this document becomes a story about
something that used to be true. Append-only felt like bureaucracy when I wrote the rule down. It is
the reason this finding survives the fix.

---

## 8. What is still open

The comparison screen is still worth building, and the question it answers has changed. It was
going to ask whether repair helps. It should now ask whether v2 repair drifts less than v1 repair,
which means rendering three descriptions rather than two: the raw describe output, the v1 repair
and the v2 repair.

Whether Seedance refuses a human likeness in an input image on the OpenRouter transport is still
unprobed. Mentic measured that refusal on Runway, over nine calls in August, and it is the reason
the description travels as text in the first place. A different vendor in front of the same weights
is not the same test.
