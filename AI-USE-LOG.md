# AI Use Log — 2026-09-10

Transparency record for **Outcome 7 (Realising)** — *"When you use AI coding tools, be transparent
— the code is yours to defend"* — and **Outcome 5 (Personal Leadership)**. Written during the
session, not reconstructed afterwards.

**Tool:** Claude Code (Opus 5, 1M context). Skills invoked explicitly: Superpowers
`brainstorming`, `writing-plans`, the `humanizer`, and the Claude API reference before any model id
or price was written down.

**Session output:** `MODEL-SELECTION.md` rewritten to one page plus references,
`docs/superpowers/specs/2026-09-10-character-description-agents-design.md`,
`docs/superpowers/plans/2026-09-10-evaluator-repairer-agents.md`, `docs/decision-log.md`.

**Earlier sessions:** the 7 September session's account is superseded by this document. The
9 September model-selection session recorded its own prompting account inside `MODEL-SELECTION.md`.

---

## 1. How I prompted

| # | Technique | What I actually did | Effect |
|---|---|---|---|
| 1 | **Rejected another model's output as the starting point** | Pasted a competing research document produced by a different assistant and said plainly that it was wrong and unhumanised, then asked for it rebuilt in the style I had already established | Kept one voice and one evidence standard. The competing draft had MiniMax H3 as a cheap option with no mention that its licence excludes the EU, and had dropped Wan 3.0 entirely |
| 2 | **Style as a hard constraint** | Required dated third-party sources, no vendor marketing, and a humanizer pass with no AI tells | Every figure in the rewrite traces to a rate card, a licence file, or a dated test |
| 3 | **Conclusion first, proof demanded second** | Told it Seedance is the answer *and* that it had to be proven, and that the 30-second figure was never the point | Reframed the document around quality for UGC and moved the face question from a length rule to a mechanic to test |
| 4 | **Repeated scope amputation** | Cut the budget section, the model tables, and most comparisons across four rounds: "too many fucking comparisons", "I don't care about the fucking budget", "one page of research, one page of prompting, plus the references" | `MODEL-SELECTION.md` went from 344 lines to 95 |
| 5 | **Evidence sourcing demand** | "Go check all YouTube reviews and comparisons" | Produced the five-model head-to-head of 12 Aug 2026 and the Wan comparison of 14 Aug 2026. Transcripts could not be retrieved at all, so that failure is stated in the document instead of being filled with plausible quotes |
| 6 | **Register control, twice** | "What is slot, what call, you need to explain in easier terms, I don't understand anything", then "what is the model cannot act on? act on what?" | Forced a plain-language rewrite of the whole design conversation. Every later option list was written without jargon |
| 7 | **Skill invocation with an approval gate** | Asked to brainstorm rather than letting it design, and named `ui-ux-pro-max`, `impeccable` and `motion` as required for the interface phase | Design questions came one at a time, and nothing was built |
| 8 | **Adversarial team on my own plan** | Asked for three teammates on the same design: UX, technical architecture, and devil's advocate, then a fourth to mine Higgsfield's published material | The rubric now traces to Higgsfield's own character pattern rather than my taste, and the surviving objections are in the spec: frozen gold set, Cohen's kappa, a pre-registered failure condition |
| 9 | **Overruled its recommendation, then took the compromise** | Chose a 1 to 100 score against its advice. When it explained that AI judges cannot reliably separate 62 from 71, I took five written bands displayed as a percentage | The number now has a definition behind it and my hand-marking still compares cleanly |
| 10 | **Held implementation back with the plan finished** | "We need design plan first and you need to ask me question, no coding or building anything now" | Thirteen tasks written and reviewable before a line of code exists |

### What I did not do, deliberately

- I did not keep the other assistant's research, even though it looked finished.
- I did not accept the first, second or third shortened draft.
- I did not accept a percentage score once I understood it had no anchor.
- I did not let it start coding, even with the plan complete and the stack chosen.
- I did not accept vocabulary I could not explain myself.

---

## 2. Division of work

| Did it | What |
|---|---|
| Claude | Fetched and dated the third-party hands-on tests; attempted the YouTube transcripts and reported the failure; mined five Higgsfield pages for the character pattern; drafted the rewrite; wrote the spec and the 13-task plan with real TypeScript; pulled model ids, pricing and the structured-output shape from the API reference rather than memory |
| Me | Supplied the face constraint and the UGC target; set the model and demanded the proof; cut the scope four times; forced plain language; chose TypeScript, Supabase and the mentic-shaped split; chose three calls, five bands, and repair limited to quoted fragments; ordered the adversarial review; held back implementation; will hand-mark the gold set myself |

---

## 3. Where the AI was wrong, and why

- **It claimed to halve the document three times without doing it.** The first pass was 5% shorter,
  the second 13%, the third 21%. It reported each real number honestly, but only reached one page
  when I stopped asking for a shorter draft and specified the artefact: one page of research, one
  page of prompting, references.
- **It used jargon after being told twice to keep it simple.** "Slot", "call" and "halo effect" all
  went in unexplained. The 7 September session hit the same register problem, so this is a repeat
  rather than a one-off.
- **It could not retrieve a single YouTube transcript** across five approaches. Recorded as a tool
  limit; the comparison verdicts in the document therefore come from written tests only.
- **A peer agent asserted my own research forbids the repair loop.** The devil's advocate quoted
  conclusion 7 of `APPLIED-RESEARCH.md` to argue the three-pass Repairer contradicts my defended
  design. Checked against the primary file, `APPLIED-RESEARCH.md:359` explicitly plans "the score,
  defect and fix loop in text only", and conclusion 7 rejects auto-correcting *render* drift. The
  objection conflated the two. Its other three objections survived and are now in the spec.
- **Vendor-adjacent sources contradicted each other on resolution.** One publisher's launch post
  says Seedance 2.5 supports 4K; the same publisher's own test six weeks later says 720p native.
  Resolved by preferring the rate card and the dated test.

---

## 4. What this session proves about the project's own question

The separation the project already assumes, between the agent that asserts a fact and the agent that
verifies it, got a second live data point: a peer agent produced a confident, well-argued objection
that was wrong on the primary document. The 7 September session produced the same failure shape as a
citation pointing at coverage of a document instead of the document. Two instances, same lesson, now
written into the spec as a rule rather than a hope: the verifier opens the source.

The rubric also stopped being my own taste. Its nine checks are traced to Higgsfield's published
character pattern, to refusals I measured on Runway, and to my own render-tested contract, which is
what makes "does an AI scoring these items agree with a human" a question worth answering.

---

## 5. Open items

- Hand-mark the frozen gold set, 30 to 50 descriptions, blind, before looking at any agent output.
- Freeze the band wording per check after drafting it against real descriptions.
- Probe whether a synthetic character still is accepted as a reference by Seedance 2.5, which is the
  test that decides one shot or several.
- Plans 2 and 3, the backend event stream and the three screens, both written after this plan runs.
- If quotes from the video comparisons are needed, supply a transcript by hand.
