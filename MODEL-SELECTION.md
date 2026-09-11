# Which video model, and how I prompted the research

Miguel Roale · MA-AAI, GenAI Engineer
Toys R Us Studios, Orchestrating AI's First Brand Film
2026-09-10 · Extends Subquestion 2 of `APPLIED-RESEARCH.md`
Figures checked 2026-09-10 unless another date is given.

## The research

**Seedance 2.5 on Runway.** It is the highest-quality video model I can call, this is an ad,
and quality is the whole brief. 30 credits a second at 720p, so $9.00 for thirty seconds.

- **The only by-hand ranking of every current model puts it alone at the top.** Joseph
  Martin, 8 June 2026: "Whether you're doing cinematic, UGC, product ad, or animation work,
  SeeDance is the only S-tier option out there right now."
- **Five models, identical prompts, MindStudio's own run, 12 August 2026.** Seedance 2.5
  "produces the highest-quality footage of the group". MiniMax H3 "doesn't match Seedance 2.5
  or even Seedance 2.0 in fidelity". FLUX 3 "didn't follow instructions as tightly", with
  "noticeable audio and visual quality gaps". Wan 3.0 "don't show a huge quality leap". The
  cheaper models are cheaper, not better: 8¢ to 17¢ a second against Seedance's 23¢.
- **Curious Refuge, 14 August 2026, on the only rival that matches it on paper.** Wan 3.0's
  lip sync failed to match mouth movement to audio and its character consistency broke down in
  complex sequences. Seedance held performance, compositing, lip sync and multi-shot scenes.
- **Nothing beats it overall.** Veo 3.1 has better close-up detail at 8 seconds a render,
  Kling 3.0 has better lip sync at 15, and neither can carry a film.
- **Its one real cost is resolution.** 720p native, any 4K is an upscale pass, and tight
  facial close-ups show it. The film stays in medium and wide framing for vertical delivery.

**Identity is the only open mechanic.** Seedance refuses a real human face as input, measured
three ways, so the face has to survive some other way.

- **Test a synthetic face first.** Reporting on the 2.0 filter, 13 April 2026, says it bites
  hardest on "real, identifiable people" while "original illustrations, 3D character renders,
  or photos of actors in costume" often pass. My character is generated, so it may be accepted
  as a reference. No published result exists.
- **If it passes, the film is multi-shot in short takes**, all on Seedance, no second vendor,
  and shot length becomes an editing decision.
- **If it refuses, identity rides on the prose:** one byte-identical character description
  injected by code into every stage, which `APPLIED-RESEARCH.md` already specifies and
  unit-tests. Either way Seedance renders it.

## How I prompted the research

Claude Code (Opus 5) pulled transcripts, ran the searches, read the licence files and rate
cards and drafted the text, and two verification subagents checked its claims against primary
sources. What I contributed is which evidence counted.

- **"I know Seedance is best, but you have to prove it."** Separating my conclusion from the
  evidence left room for it to disagree, which is where the resolution ceiling and the two
  models that beat it on one axis came from.
- **"Read the actual transcript, not articles about it."** That produced the "neutered version
  of Seedance" line, corroborating my own face refusal from outside my account.
- **"Test whether it accepts faces, specifically."** Turned a vague worry into a binary test
  with a synthetic still and a real one.
- **"Does it beat Seedance 2.5, not 2.0?"** Every comparison had quietly been against 2.0,
  that being the version the boards rate.
- **"No cheap models, only the best, one winner, fewer comparisons."** Killed the cheap tier,
  the fallback model and the tables. A comparison that cannot change the pick is padding.

**What it got wrong is the more useful half.** Four of six errors were one failure repeated:
citing coverage of a document instead of the document. LTX-2's licence came from a press
release headline, a frame-count example was read as a hard limit and eliminated a model on a
ceiling that does not exist, comparisons ran against Seedance 2.0 undisclosed, and 2.0 was
recommended as cheaper against a pricing page it had already read.

**What that changed in the build.** The agent that asserts a fact is not the agent that
verifies it, and the verifier opens the source instead of reasoning about it. Same shape as
separating the scoring agent from the repair agent.

**What is still unverified.** Kling's API parameters and Reddit sentiment rest on third-party
mirrors, and the YouTube comparisons could not be transcribed: no caption track was served and
the transcript panel came back empty, so their titles and dates are recorded and nothing from
them is quoted.

## References

Joseph Martin, *I Tested EVERY AI Video Model so You Don't Have to*, 8 Jun 2026, https://www.youtube.com/watch?v=ExVmTLvrFNY

MindStudio, *Seedance 2.5 vs WAN 3.0, Flux 3, and MiniMax H3*, 12 Aug 2026, https://www.mindstudio.ai/blog/seedance-2-5-vs-wan-3-flux-3-miniax-h3

MindStudio, *What Is the Seedance 2.0 Content Restriction Problem?*, 13 Apr 2026, https://www.mindstudio.ai/blog/seedance-2-0-content-restrictions-workarounds

MindStudio, *Seedance 2.5 Review: 30-Second Clips, Voice Casting, and Morphing Bugs*, 6 Aug 2026, https://www.mindstudio.ai/blog/seedance-2-5-review-guide

Segmind, *Seedance 2.5 Review: Five Real-World Use Cases and What Each Costs*, 8 Aug 2026, https://blog.segmind.com/seedance-2-5-review-five-real-world-use-cases-and-exactly-what-each-one-costs/

Curious Refuge, *Wan 3.0: Is it Better than Seedance 2.5?*, 14 Aug 2026, https://curiousrefuge.com/blog/wan3-review

Runway model list, https://docs.dev.runwayml.com/guides/models · Runway pricing, https://docs.dev.runwayml.com/guides/pricing · Seedance 2.5 on Runway, https://runway.com/product/seedance-2.5

ByteDance Seed, *One-Take Creation, Flexible Referencing: Introducing Seedance 2.5*, 31 Jul 2026, https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5

arena.ai image-to-video, https://arena.ai/leaderboard/image-to-video · Artificial Analysis image-to-video, https://artificialanalysis.ai/video/leaderboard/image-to-video

My own probe runs against Runway, 2026-08-13 to 2026-08-30, with dates, call tables and per-call cost
