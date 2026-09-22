# The workflow, with a real example

Run `b1177ae7`, 12 September 2026. Real, not invented — it is on disk in `data/runs/`.

## The flow

```
Description → Evaluator → Span verification → Repairer → Splice → Pass gate
                  ↑                                                   │
                  └───────────────────  round again  ─────────────────┘
```

Six steps. Two are AI (Evaluator, Repairer). Three are code (verification, splice, gate).
Three rounds maximum.

---

## Pass 1

**Input:**
> "A guy who is cool and mysterious, wearing dark clothes, looks tough."

**Evaluator** grades it. 6 of the 9 checks fail. Score: **49%**.

It has to quote the words that caused each failure:

| Check | Band | The words it blamed |
|---|---|---|
| Age and build | 1 | "A guy who is cool and mysterious" |
| Face and skin | 2 | "looks tough" |
| Hair | 1 | (nothing about hair anywhere) |
| Clothes | 2 | "wearing dark clothes" |
| Identifying mark | 1 | (none) |
| Drawable only | 2 | "cool and mysterious", "looks tough" |
| No real people | 4 | pass |
| No brands | 4 | pass |
| No camera stuff | 5 | pass |

**Span verification** (code) searches the text for each quote, confirms it is really there, and
finds exactly where it starts and ends. All verified.

**Repairer** gets only those fragments — never the whole sentence — and rewrites them.

**Splice** (code) puts them back and checks nothing else changed.

**Result:**
> "A guy who is sharp-jawed with shoulder-length black hair, wearing a black leather jacket with
> the zip half open over a charcoal-grey T-shirt, slim-fit black jeans, and scuffed black lace-up
> boots, stands with squared shoulders and clenched fists."

**Pass gate:** not all 9 passed. Go round again.

---

## Pass 2

Grades the *new* text. 4 checks still fail. Score: **71%**.

Clothes went from 40% to 100%. But age and build is still 20% — "a guy" is not an age — and
there is still no identifying mark.

Repairer fixes those.

---

## Pass 3

Score: **98%**. All 9 pass.

> "A man in his late twenties, lean and broad-shouldered, about 1.85 m tall... deep-set dark brown
> eyes, his olive skin showing visible pore texture across the nose... shoulder-length black hair,
> thick and wavy, parted on the left... a 2 cm pale scar through his right eyebrow, a single small
> mole below his left cheekbone, and a flat silver band on his right thumb."

**49% → 71% → 98%.** The whole run took 32 seconds.

---

## The point of the example

The starting text is what anyone would actually type. The finished text is something a video
model can draw the same way twice — a scar with a size and a side, a mole with a position, a ring
on a named finger. Nobody added those by hand; the tool named what was missing and filled it.

And every score points at the words that caused it. Nothing is "the AI thought it was a 6".
