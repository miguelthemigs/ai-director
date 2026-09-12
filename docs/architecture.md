# Architecture: what Prompt Coach is, and where it sits next to Mentic

Written 2026-09-12, after reading the live Mentic avatar code at
`~/Desktop/Mentic.io`. Paths in section 1 are Mentic's; every other path is this repo's.

---

## 0. The one-paragraph version

Mentic turns a person into a paragraph of words, because the video model refuses a
photograph of a human face. That paragraph is the only thing carrying the person into
every render, so if the paragraph is vague the person changes between videos. Prompt
Coach grades that paragraph against nine checks, quotes the exact words that failed, and
rewrites only those words. It is a grader for the one field Mentic cannot afford to get
wrong.

---

## 1. How Mentic makes an avatar today

There are two entry points, and they produce the same kind of artefact by different
routes.

```
  DESCRIBED avatar                          UPLOADED avatar
  (the user types a person)                 (the user has a photo)
          |                                          |
  actor-step.tsx                            actor-step.tsx
  13 guided fields + free text              file upload + consent
          |                                          |
  assembleActorDescription()                         |
  lib/ugc-lab/actor-suggestions.ts                   |
          |                                          |
          v                                          v
  actorSheetBrief(description)              actorSheetFromPhotoBrief()
  lib/ugc-lab/generate-actor.ts             same file
          |                                          |
          +--------------------+---------------------+
                               |
                   Nano Banana Pro / gemini-3-pro-image
                   ONE image, 16:9, four candidates
                               |
                               v
                    THE CHARACTER SHEET
          left panel: facial close-up, whole head in frame
          right panel: full-body FRONT and BACK, same outfit
                    plain grey, vertical dividers
                               |
                     user picks one of four
                               |
                               v
                   describeActorFromPhoto()
                   lib/video-lab/describe-actor.ts
                   claude-sonnet-5 vision call, ONE sentence, 900 char cap
                               |
                               v
                   UgcActor.description   <-- THE PARAGRAPH
                               |
                    spliced into every render prompt
                               |
                               v
                        seedance2 video
```

Three facts about that diagram matter more than the rest.

**The photo never reaches the video model.** `ACTOR_IMAGE_ENABLED` is `false` in
`lib/video-lab/render-ugc.ts`, because seedance2 refuses a human likeness in any input
image. The sheet's only reader is a vision model. So the person reaches the render as
text and nothing else.

**The paragraph is written once and stored.** `UgcActor.description` is generated on
first use and reused for every later render. That is what keeps the person looking like
themselves across videos, and it is also why one bad paragraph is a defect that repeats
forever rather than a one-off bad render.

**The user can edit it.** It is an ordinary text column, not a hidden derived value.
Which means a score plus a suggested rewrite is directly actionable: there is a field to
paste it into.

### What Mentic's own describe prompt already enforces

`DESCRIBE_ACTOR_SYSTEM` in `lib/video-lab/describe-actor.ts` is not naive. It already
forbids, by name:

- describing the sheet instead of the person (no panels, no divider lines, no grey
  background, no studio)
- names, identities, guesses at who the person is
- judgements about them
- inventing anything the image does not show

Those three prohibitions are, in this repo's vocabulary, `no_cross_slot`,
`no_real_person` and `drawable_only`. Mentic is already passing three of the nine checks
by construction.

### Where the paragraph is structurally squeezed

The same prompt ends with `One sentence, under 400 characters`. The storage cap is 900,
raised from 400 on 2026-08-28 after a live description was cut mid-word, but the
instruction to the model still says 400 and still says one sentence.

A sentence under 400 characters cannot hold all of: an age bracket, a build, hair colour
and texture and style, every visible garment with colours including footwear, and a
localised reusable marker. Something gets dropped, and which thing gets dropped varies
per call. That is a plausible mechanism for the symptom described as
*"it does a good job, but it's not super constant."*

Prompt Coach does not assume that is the cause. It measures it.

---

## 2. What Prompt Coach does with that paragraph

```
  description text
        |
        v
  +--------------------------------------------------+
  |  EVALUATOR                                        |
  |  apps/backend/src/agents/evaluator/               |
  |  three API calls, one per group, run in parallel  |
  |                                                   |
  |  look      age_build  face_skin  hair_spec        |
  |            wardrobe   anchor_marker               |
  |  safety    no_real_person  no_brand_name          |
  |  drawable  drawable_only   no_cross_slot          |
  |                                                   |
  |  each check -> a band 1..5 + a written reason     |
  |  any band below 4 -> VERBATIM quotes of the       |
  |  offending words                                  |
  +--------------------------------------------------+
        |
        v
  +--------------------------------------------------+
  |  ENFORCEMENT (code, no model)                     |
  |  apps/backend/src/enforce/                        |
  |                                                   |
  |  verifySpans.ts   finds each quote with indexOf,  |
  |                   computes the offsets itself.    |
  |                   A quote it cannot find is       |
  |                   discarded, not trusted.         |
  |  score.ts         band -> 20/40/60/80/100.        |
  |                   The model never states a %.     |
  |  invariants.ts    a failing check with no quote   |
  |                   is a defect, not a result.      |
  +--------------------------------------------------+
        |
   all nine >= band 4 ? ---- yes ----> status: passed
        |
        no
        v
  +--------------------------------------------------+
  |  REPAIRER                                         |
  |  apps/backend/src/agents/repairer/                |
  |                                                   |
  |  Sees ONLY the failing fragments. Never the whole |
  |  description. Returns a replacement per span.     |
  +--------------------------------------------------+
        |
        v
  splice.ts  applies replacements right-to-left into
             the immutable original, then asserts the
             untouched regions are byte-identical.
        |
        v
  next pass (max 3)
        |
        v
  terminal: passed | improved_still_failing | no_improvement
```

Two design choices carry most of the safety.

**The model never computes an offset.** It supplies quote text; `indexOf` supplies the
position. Models miscount characters, and a wrong offset silently corrupts the splice.

**The Repairer is kept blind.** Handing it the whole description invites it to rewrite
prose it was not asked to touch. Handing it three fragments means the other 90% of the
text is unchanged by construction, and the splice asserts it.

**There are three terminal states and only one is success.** `improved_still_failing` and
`no_improvement` must never render as a win. `isSuccess()` in
`packages/contract/src/run.ts` is the single place that decides.

---

## 3. The three screens

| Screen | File | What it is for |
|---|---|---|
| Run | `apps/frontend/src/screens/RunScreen.tsx` | Paste a description, watch the checks arrive, click a failing check to light up the exact words, compare pass 1 / 2 / 3 |
| Architecture | `ArchitectureScreen.tsx` | The pipeline above, live. Each node lights as its step runs, and holds the real payload it sent |
| Versions | `VersionsScreen.tsx` | Rubric version history. The visible feedback cycle: v1 scored a gold set, the agreement study said which checks were unreliable, v2 changes those and is re-scored against the same frozen set |

The backend streams progress over server-sent events (`apps/backend/src/server/sse.ts`),
so the Run screen fills in check by check rather than waiting for all three groups.

Every screen runs on fixtures with no backend at all:
`npm run dev:web`, then `?fixture=improvedStillFailing`. Fixture data is visibly labelled
on screen so it can never be mistaken for a measured result.

---

## 4. The mapping: nine checks against Mentic's thirteen fields

This is the part worth reading twice. It is what makes Prompt Coach a tool for Mentic
rather than a generic text grader.

| Prompt Coach check | Mentic guided field | Fit |
|---|---|---|
| `age_build` | `age` + `buildNote` | Direct. `buildNote` pool already includes heights |
| `face_skin` | `ethnicity`, `eyeColor` | Partial. No field asks for a jaw, freckles, or a skin texture |
| `hair_spec` | `hair` | Direct. Pool values give colour, texture and style together |
| `wardrobe` | `wardrobe` | Direct. Pool values are already head to toe with `no logos` |
| `anchor_marker` | none | **Gap.** Nothing in the form asks for a reusable marker |
| `no_real_person` | none needed | Enforced by `DESCRIBE_ACTOR_SYSTEM` |
| `no_brand_name` | `wardrobe` pool ends every value `no logos` | Handled at the pool level |
| `drawable_only` | none needed | Enforced by `DESCRIBE_ACTOR_SYSTEM` |
| `no_cross_slot` | fields were deliberately removed 2026-08-28 | `location`, `lighting`, `framing`, `expression` were cut from the form. That removal is exactly this check |

Two conclusions fall out of the table.

**`anchor_marker` has no home in the Mentic form.** Band 4 wants something like *two moles
on the left cheek* or *a gold hoop in the right ear only*, a small thing that can be
checked shot to shot. The only place a user could type it today is `extraNotes`, the free
text escape hatch, where nothing prompts them to. If the agreement study confirms
`anchor_marker` predicts consistency, adding one field to `ACTOR_FIELDS` is a small change
with a measurable payoff.

**`face_skin` is the weakest structural fit.** `ethnicity` and `eyeColor` give one
concrete feature between them; band 4 wants two or more.

**`no_cross_slot` already has a precedent in Mentic's own history.** The four scene fields
were removed on 2026-08-28 with the note *"remove for avatar all background
characteristics, just keep the avatar descriptions."* That was the same judgement this
check encodes, made a month earlier without a measurement behind it. The check is what
makes that judgement testable rather than a matter of taste.

---

## 5. The pipeline, reproduced

Mentic's whole path is now runnable in this repo, so the description can be measured
where it is written rather than where it is typed.

| Mentic | Here | Copied how |
|---|---|---|
| `doctrine/actor-image.md` | `apps/backend/src/avatar/doctrine/mentic-actor-image.md` | Verbatim |
| `authorActorPrompt` | `apps/backend/src/avatar/authorPrompt.ts` | Same doctrine, same model (`claude-sonnet-5`) |
| `actorSheetBrief`, `ACTOR_SHEET_PANELS`, `IMAGE_REALISM_TAIL` | `apps/backend/src/avatar/sheetBrief.ts` | Verbatim |
| `googleGenerateImage` | `apps/backend/src/avatar/generateSheet.ts` | Same call shape, `gemini-3-pro-image`, 16:9, 2K |
| `DESCRIBE_ACTOR_SYSTEM` | `apps/backend/src/describe/prompt.ts` | Verbatim |
| `describeActorFromPhoto`, `trimToWhole` | `apps/backend/src/describe/describeImage.ts` | Same call, same 900-character cap |
| The guided form | `apps/frontend/src/domain/avatarFields.ts` | Mentic's fields, suggestion values verbatim |

Every one of those files says at the top that it is the **subject under test**. Editing
one means this repo stops measuring Mentic and starts measuring a prompt of its own.

**Two routes, not one, and the split is the point.** `POST /avatar/sheet` runs the
doctrine and renders the sheet. `POST /avatar/describe` reads a description back off it.
A description can lose a check in three different places: the form never asked for the
thing, the authoring step dropped it, or the describe step could not read it off the
rendered sheet. One route returning a score would collapse all three into a single
number. Stopping between them, with the sheet and both prompts on screen, is what makes
the loss locatable.

**Upload is the other half.** A sheet rendered in Mentic itself can be dropped straight
into the Pipeline tab, which measures Mentic's real output rather than a re-render of it.

**What is deliberately not reproduced.** Mentic mirrors every generated image to
UploadThing and writes a priced row to its usage ledger. This repo has neither, and half
an object store or half a ledger would be worse than none. The bytes go to the caller.

**What is still unmeasured.** Nothing above has been run against a live provider. The
standing instruction in this project is that the owner runs the paid calls, so every
number this repo could report about Mentic today would be zero calls deep. The four
outstanding items are in `docs/decision-log.md`.

---

## 6. Where to look first

| I want to understand | Read |
|---|---|
| What a check actually asks for | `apps/backend/src/rubric/v1.json` |
| How a failing quote becomes a highlight | `apps/backend/src/enforce/verifySpans.ts` |
| Why the untouched text cannot drift | `apps/backend/src/enforce/splice.ts` |
| What crosses the network | `packages/contract/src/run.ts` |
| The decisions already taken, and the pre-registered failure condition | `docs/decision-log.md` |
| How this was built, for assessment | `docs/how-i-built-prompt-coach.md` |
