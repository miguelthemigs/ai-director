# Prompt Coach UI design specification

Date: 2026-09-11
Owner: Miguel Roale
Implements: `docs/superpowers/specs/2026-09-10-character-description-agents-design.md` §3, §5, §6, §9
Stack: React 19 + TypeScript + Vite, plain CSS with custom properties, `motion/react`
Skills invoked before writing: `impeccable` (seed key `eca0ea4c`, direction scope, operate mode),
then `ui-ux-pro-max`

Animation timing, easing and choreography are **out of scope here** and belong to the motion
specification. This file names where motion attaches and what it must not be allowed to carry.

---

## 1. Design direction

**The lined continuity script.** A script supervisor takes the shooting script and rules a vertical
line down the margin for every camera setup, spanning exactly the lines of dialogue that setup
covers, solid where the actor is on camera and a squiggle where they are not. It is the one document
in film whose entire job is to bind margin annotations to specific words in a text, which is exactly
what this product does when the Evaluator quotes a fragment and code verifies it with
`description.indexOf(quote)`. So the description is the script page, each check is a coverage line
in the gutter, the band is the line's stroke pattern, the three passes are takes, and the rubric and
prompt versions carry the film industry's own revision-paper colours in their canonical order.

**It is deliberately not** the dark-slate research dashboard with green/amber/red status pills, an
aggregate donut, and a monospace font worn as a costume. That is the look every tool in this
category ships, and the one the `ui-ux-pro-max` generator returned for this query. Two specific
refusals sit behind that. Green/amber/red is the exact ramp that collapses at the pass boundary
under red-green colour blindness: measured below, deuteranopic contrast between the fail and pass
bands falls to 1.03:1 on a hue-only ramp. And an aggregate score is forbidden by the spec, so this
interface has no number that can hide a failing check.

**Instrument polarity.** Failing readings are hot, bright and wide; passing readings are cool, quiet
and narrow. Nominal does not shout on a bench instrument, and the loudest thing on the screen is
always the thing that is wrong. That turns the brief's oscilloscope register into a rule a developer
can follow, and it is what makes a failed run hard to mistake for a successful one.

### Raises taken from the directions this one beat

Each line below is a discipline donated by a challenger direction that was weighed and declined or
held competitive. Donations transfer system discipline, never clothes; one world owns the screen.

| Donor | Verdict | Discipline taken into this direction |
|---|---|---|
| Dark-first developer console | competitive | Panels divide with **hairline seams and exactly one elevation step**, never with card shadows. There are two shadow tokens in the whole system and neither one divides a panel. |
| Doujin event catalog (newsprint) | declined | **One ink, and a colour means exactly one thing.** The band ramp is the only chromatic system on Run and Architecture; revision-paper colour is the only chromatic system on Versions; the two never appear in the same region. |
| CRT arcade cabinet | declined | **Palette law.** Five band values exist and each is bound to exactly one band. One value, `--sig-alarm-fill`, is reserved for terminal failure and pipeline defect and is the only solid colour fill behind text anywhere in the product. |
| Film cutting bench select rail | competitive | State is a mark, not a hue, so every state must survive `filter: grayscale(1)`. And rank is cell count, not type size, which is why a failing check row occupies more vertical cells than a passing one instead of a larger font. |
| Drawcord transforming cape | declined | **The control is the accent.** Selection is carried by the rule you click, not by a decorative colour applied to it; there is no selection hue competing with the band ramp. |
| Cyclorama dawn | declined on product truth | **Cue discipline.** Every run state is a named, numbered, deep-linkable cue with a text equivalent. The SSE event ids `<pass>-<step>` from spec §6 surface in the UI as visible cue numbers instead of staying a hidden protocol detail. (Declined because a dawn ramp implies progress toward light, which would make a `no_improvement` run look like it got better.) |

### Direction contract

Paste verbatim as the first child of `<body>` in the root layout, so it survives the production
build and can be grepped for in `dist/`.

```html
<!--
THESIS: a lined continuity script for prose — every score is a coverage line ruled against the exact
words that produced it. Refuses the aggregate-score dashboard; no number here can hide a failing check.
OWN-WORLD: graphite ground #0e1012, recessed script field #080a0c, hairline seams, Archivo caps labels
over Courier Prime specimen, five-band ramp hot-to-cool with a stroke-pattern twin, film revision-paper
chips on Versions, one reserved alarm fill #b00c15.
STORY: the writer sees which check failed, the words that failed it, what was changed, and what it cost,
without leaving the screen or trusting a number they cannot trace.
FIRST VIEWPORT: 88px pass rail | script field with numbered lines and a coverage gutter | 400px check
column, nine rows always visible under three group headers. Verdict sits at the foot of the rail.
FORM: lined continuity script, candidate 5 of the grounded list, seed eca0ea4c.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict,
DESIGN.md, and every shipping raster carrying its provenance.
-->
```

---

## 2. Tokens

Paste as-is. Dark is primary; `[data-theme="light"]` is the lab-notebook rendition for projection
and for assessors reading printed or over a shoulder. Every colour below was computed from oklch and
every ratio in §7 was measured against these exact hex values.

```css
:root {
  color-scheme: dark;

  /* ── Surfaces ──────────────────────────────────────────────── */
  --sf-ground:        #0e1012;  /* app ground */
  --sf-panel:         #17191c;  /* panels, check column, tables */
  --sf-panel-raised:  #1f2125;  /* the ONE elevation step: inspector, compare drawer, popover */
  --sf-field:         #080a0c;  /* the script field — recessed, darker than ground */

  /* ── Seams (panels divide with lines, never with shadow) ───── */
  --ln-faint:         #272a2e;  /* row rules inside a panel */
  --ln:               #363a3e;  /* panel seams */
  --ln-strong:        #575b61;  /* graph edges, table head rule, active borders */

  /* ── Ink ───────────────────────────────────────────────────── */
  --ink:              #ebedef;
  --ink-2:            #b3b6ba;  /* reasons, secondary values */
  --ink-3:            #878b90;  /* labels, units, cue ids */

  /* ── Mark (selection + focus; grease pencil) ───────────────── */
  --mark:             #fbf3dd;
  --mark-soft:        #332d1c;  /* selected-span ground */

  /* ── Band ramp — ink values, used for numerals, rules, meters ─
     Polarity: fail = hot + bright + wide, pass = cool + quiet.
     The hue break between band 3 and band 4 IS the pass threshold. */
  --band-1:           #fe7365;  /*  20 */
  --band-2:           #ffa459;  /*  40 */
  --band-3:           #f2d350;  /*  60 */
  --band-4:           #169597;  /*  80  ← pass threshold */
  --band-5:           #45adcd;  /* 100 */

  /* ── Band tints — meter troughs and chip grounds. Text on these is --ink. */
  --band-1-tint:      #4c1410;
  --band-2-tint:      #442100;
  --band-3-tint:      #392c01;
  --band-4-tint:      #013132;
  --band-5-tint:      #02323f;

  /* ── Span highlight grounds — sit behind specimen text ─────── */
  --span-1:           #450907;
  --span-2:           #3a1b00;
  --span-3:           #2e2401;
  --span-unverified:  #1b1d1f;  /* quote failed verification: neutral, never a band colour */

  /* ── Reserved alarm. Terminal failure and pipeline defect ONLY.
     --sig-alarm-fill is the only solid colour fill behind text in the product. */
  --sig-alarm-fill:   #b00c15;
  --sig-alarm-ink:    #fef9f8;
  --sig-alarm-edge:   #f14e46;
  --sig-alarm-tint:   #490d0b;

  /* ── Diff. Aliased to the band axis on purpose: warm = removed/contested,
     cool = added/clear. There is no red/green pair anywhere in this product. */
  --diff-del:         var(--band-1);
  --diff-del-ground:  var(--span-1);
  --diff-add:         var(--band-4);
  --diff-add-ground:  var(--band-4-tint);

  /* ── Focus ─────────────────────────────────────────────────── */
  --focus:            #fbf3dd;
  --focus-ring: 0 0 0 2px var(--sf-ground), 0 0 0 4px var(--focus);

  /* ── Revision paper. Film's own revision order. Versions screen only.
     Always rendered with its version number beside it; never a state signal. */
  --rev-1-white:      #ffffff;
  --rev-2-blue:       #bcd4e6;
  --rev-3-pink:       #f7c8d8;
  --rev-4-yellow:     #f7efa6;
  --rev-5-green:      #c5e3c1;
  --rev-6-goldenrod:  #efc75e;
  --rev-7-buff:       #eee0c6;
  --rev-8-salmon:     #f6bca3;
  --rev-9-cherry:     #e78fa0;
  --rev-ink:          #171a1e;  /* ink printed on a revision chip, both themes */

  /* ── Type ──────────────────────────────────────────────────── */
  --ff-ui: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --ff-specimen: "Courier Prime", "Courier New", ui-monospace, "SF Mono", Menlo, monospace;

  --fs-micro:     0.6875rem; /* 11px — cue ids, lane tabs, axis ticks, units */
  --fs-label:     0.75rem;   /* 12px — caps labels, column heads, node labels */
  --fs-ui:        0.8125rem; /* 13px — reasons, table cells, payload keys */
  --fs-body:      0.875rem;  /* 14px — default UI text, notes */
  --fs-specimen:  0.9375rem; /* 15px — the description, quotes, diffs, prompts */
  --fs-readout:   1.125rem;  /* 18px — the band percentage numeral */
  --fs-title:     1.25rem;   /* 20px — screen title */
  --fs-verdict:   1.75rem;   /* 28px — terminal verdict word */
  --fs-count:     2.5rem;    /* 40px — the single display numeral; see §6 for what it may hold */

  --lh-tight:  1.15;
  --lh-ui:     1.35;
  --lh-spec:   1.7333;  /* 15px × 1.7333 = 26px = --pitch */

  --tr-caps:   0.09em;  /* uppercase labels */
  --tr-title:  0.01em;
  --tr-verdict: -0.015em;

  --fw-reg: 400;
  --fw-med: 500;
  --fw-semi: 600;
  --fw-bold: 700;
  --wd-narrow: 88;      /* Archivo wdth axis for dense labels */
  --wd-normal: 100;

  /* ── Space. 4px base; dense instrument. ────────────────────── */
  --sp-1:  2px;
  --sp-2:  4px;
  --sp-3:  8px;
  --sp-4: 12px;
  --sp-5: 16px;
  --sp-6: 24px;
  --sp-7: 32px;
  --sp-8: 48px;
  --sp-9: 64px;

  /* ── Pitch. The script's line rhythm. Everything in the field column
     and every coverage rule is an integer multiple of this. ──── */
  --pitch: 26px;

  /* ── Fixed structure ───────────────────────────────────────── */
  --h-topbar:    48px;
  --w-rail:      88px;
  --w-checks:   400px;
  --w-inspect:  360px;
  --w-linenum:   28px;
  --w-lane:       6px;   /* one coverage lane; max 9 lanes = 54px */
  --measure:     66ch;   /* specimen measure ≈ 71 columns of Courier Prime */

  /* ── Radii. Paperwork is square. ───────────────────────────── */
  --r-0: 0;
  --r-1: 2px;   /* chips, band swatches, meter caps */
  --r-2: 3px;   /* graph node corners, popovers */
  --r-3: 6px;   /* nothing larger exists */

  /* ── Borders ───────────────────────────────────────────────── */
  --bd-hair: 1px;
  --bd-mark: 2px;   /* selected rule, focus, alarm outline */

  /* ── Shadow. Two, both with offset and blur. Neither divides a panel. */
  --sh-raise: 0 2px 6px rgb(0 0 0 / 0.42), 0 8px 24px rgb(0 0 0 / 0.30);
  --sh-pop:   0 4px 10px rgb(0 0 0 / 0.48), 0 16px 40px rgb(0 0 0 / 0.36);

  /* ── Breakpoints (documentation; use the literals in media queries) */
  --bp-lap:  1024px;
  --bp-desk: 1280px;
  --bp-wide: 1440px;
}

[data-theme="light"] {
  color-scheme: light;

  --sf-ground:        #f3f2ef;
  --sf-panel:         #fbfaf7;
  --sf-panel-raised:  #e9e8e3;
  --sf-field:         #fefdfc;

  --ln-faint:         #d9d7d2;
  --ln:               #c0beb7;
  --ln-strong:        #8f8c84;

  --ink:              #171a1e;
  --ink-2:            #494d54;
  --ink-3:            #686c73;

  --mark:             #2a2a49;   /* pencil blue-black */
  --mark-soft:        #d9dbfc;

  --band-1:           #be010c;
  --band-2:           #a55401;
  --band-3:           #846604;
  --band-4:           #05585d;
  --band-5:           #023e5b;

  --band-1-tint:      #ffd4ce;
  --band-2-tint:      #fedbc2;
  --band-3-tint:      #f9e7b3;
  --band-4-tint:      #c8eff1;
  --band-5-tint:      #cdeefe;

  --span-1:           #fecbc4;
  --span-2:           #fed5b6;
  --span-3:           #f8e4a7;
  --span-unverified:  #e9e8e5;

  --sig-alarm-fill:   #b20111;
  --sig-alarm-ink:    #fefbfa;
  --sig-alarm-edge:   #b91319;
  --sig-alarm-tint:   #ffcfc9;

  --focus:            #2a2a49;
  --focus-ring: 0 0 0 2px var(--sf-ground), 0 0 0 4px var(--focus);

  --sh-raise: 0 1px 3px rgb(23 26 30 / 0.14), 0 6px 18px rgb(23 26 30 / 0.10);
  --sh-pop:   0 2px 6px rgb(23 26 30 / 0.18), 0 12px 32px rgb(23 26 30 / 0.14);
}
```

### Base rules that ship with the tokens

The browser surfaces you did not draw still carry the design. These are not optional polish.

```css
html { font-size: 16px; }

body {
  margin: 0;
  background: var(--sf-ground);
  color: var(--ink);
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-ui);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "cv05" 1;
  -webkit-font-smoothing: antialiased;
}

::selection      { background: var(--mark-soft); color: var(--ink); }
:focus-visible   { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-1); }
caret-color: var(--mark);   /* on every text input */

* { scrollbar-width: thin; scrollbar-color: var(--ln-strong) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: var(--ln); border: 3px solid transparent; background-clip: content-box; border-radius: 99px; }
*::-webkit-scrollbar-thumb:hover { background-color: var(--ln-strong); }

a { color: inherit; text-decoration-thickness: 1px; text-underline-offset: 3px; }

/* Every numeric readout in the product. */
.tnum { font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
```

---

## 3. Typography

Two families. One is the instrument chrome, one is the specimen under measurement.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..700&family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap">
```

Verified 2026-09-11: this URL returns 200 and serves woff2 for both families, with Archivo's width
axis exposed through `font-stretch`.

**Archivo** (chrome) is a grotesque drawn for highly functional, high-legibility print work, with a
variable width axis. The width axis is the point: labels and column heads compress to `font-stretch:
88%` without a second font file, which a dense instrument needs and which a fixed-width grotesque
cannot give. Tabular figures throughout. Fallback stack is the platform sans.

**Courier Prime** (specimen) is the screenwriting Courier, and the correct face for a text that is
being measured character by character. Monospace is earned here rather than worn: the product's
whole enforcement layer is `description.indexOf(quote)`, so a grid where one column is one character
is literally true to the data model, and the coverage gutter can therefore rule against columns.
Nothing else in the interface uses it.

| Token | Size | Family | Weight / width | Tracking | Used for |
|---|---|---|---|---|---|
| `--fs-micro` | 11px | Archivo | 500 / 88 | `--tr-caps` uppercase | cue ids (`2-eval-A`), lane tabs, units (`tok`, `s`, `$`), sparkline axis |
| `--fs-label` | 12px | Archivo | 600 / 88 | `--tr-caps` uppercase | group headers (`A · RE-RENDERABLE LOOK`), table column heads, graph node labels, panel titles |
| `--fs-ui` | 13px | Archivo | 400 / 100 | 0 | check reasons, table cells, payload keys, metric values, version notes |
| `--fs-body` | 14px | Archivo | 400 / 100 | 0 | default body, dialog copy, empty-state prose (max 68ch) |
| `--fs-specimen` | 15px | Courier Prime | 400 | 0 | the description, quoted fragments, diff lines, prompt text, JSON payloads |
| `--fs-readout` | 18px | Archivo | 600 / 100 | 0, `tnum` | the band percentage numeral in a check row |
| `--fs-title` | 20px | Archivo | 600 / 100 | `--tr-title` | screen title in the top bar |
| `--fs-verdict` | 28px | Archivo | 700 / 88 | `--tr-verdict` uppercase | the terminal verdict word |
| `--fs-count` | 40px | Archivo | 700 / 100 | `--tr-verdict`, `tnum` | the single display numeral; see §6 for the rule on what it is allowed to contain |

Line lengths: UI prose and version notes cap at 68ch. The specimen caps at `--measure` (66ch, ≈ 71
Courier columns). Payload JSON and prompt diffs may run to 120ch inside their own `overflow-x: auto`
container.

The scale ratio is deliberately flat (≈1.12 between adjacent UI steps). Hierarchy in this interface
comes from how many pitch cells a thing occupies rather than from type size: a failing check row is
three cells tall and a passing one is one cell tall. Only the terminal verdict and its single count
numeral break the flat scale, once per screen.

---

## 4. Layout

All three screens share `AppShell`: a 48px top bar, then the screen body. No page-level max width,
because an instrument fills its bezel. Minimum side gutter is 16px at every width, set once on the
shell.

```css
.shell {
  display: grid;
  grid-template-rows: var(--h-topbar) minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}
.shell > * { padding-inline: var(--sp-5); }
```

### 4.1 Run screen

Desktop, ≥1280px:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PROMPT COACH  │ RUN  ARCHITECTURE  VERSIONS │ 7f3a2c · 14:22:06 · rubric v1 · e1/r1 │◐│ 48
├──────────┬──────────────────────────────────────────────┬──────────────────────────────┤
│  PASSES  │  DESCRIPTION            read-only · 412 char │ CHECKS            4/9 at ≥80 │
│          │ ┌─────┬──┬───────────────────────────────┐   │┌────────────────────────────┐│
│  ▐ 1     │ │  01 │┃┊│ A 34-year-old man, lean and   │   ││ A · RE-RENDERABLE LOOK     ││
│  ▐ 2     │ │  02 │┃┊│ wide-jawed, with a cinematic  │   │├────────────────────────────┤│
│  ▢ 3     │ │  03 │┃∿│ presence that commands the    │   ││▐ ══ age_build      100 ▰▰▰▰▰││
│          │ │  04 │ ∿│ room. Brown hair, slicked     │   ││  ══ face_skin       80 ▰▰▰▰ ││
│ ──────── │ │  05 │ ∿│ back. He wears a Nike         │   ││  ┄┄ hair_spec       60 ▰▰▰  ││
│  CUE     │ │  06 │  │ windbreaker over a white tee. │   ││     mentions colour only;   ││
│  3-done  │ └─────┴──┴───────────────────────────────┘   ││     no texture or style     ││
│          │      ↑lane 1: wardrobe   ↑lane 2: drawable   ││  ∿∿ wardrobe        20 ▰    ││
│ ──────── │                                              ││     no footwear stated      ││
│ ┌──────┐ │  PASS 2 · 3 FRAGMENTS CHANGED                │├────────────────────────────┤│
│ │STILL │ │ ┌──────────────────────────────────────────┐ ││ B · WILL NOT BE REFUSED    ││
│ │FAIL- │ │ │ 03  − a cinematic presence that commands │ │├────────────────────────────┤│
│ │ING   │ │ │     + squared shoulders, chin level      │ ││  ══ no_real_person  80 ▰▰▰▰ ││
│ │      │ │ │     drawable_only · band 3 → 4           │ ││  ∿∿ no_brand_name   20 ▰    ││
│ │  3   │ │ ├──────────────────────────────────────────┤ ││     names a brand           ││
│ │checks│ │ │ 05  − a Nike windbreaker                 │ │├────────────────────────────┤│
│ │below │ │ │     + a plain navy nylon windbreaker     │ ││ C · ONLY DRAWABLE WORDS    ││
│ │band 4│ │ │     no_brand_name · band 1 → 5           │ │├────────────────────────────┤│
│ └──────┘ │ └──────────────────────────────────────────┘ ││  ┄┄ drawable_only   60 ▰▰▰  ││
│          │                                              ││  ══ no_cross_slot  100 ▰▰▰▰▰││
│          │                                              │└────────────────────────────┘│
└──────────┴──────────────────────────────────────────────┴──────────────────────────────┘
   88px                        1fr                                      400px
```

```css
.run {
  display: grid;
  grid-template-columns: var(--w-rail) minmax(0, 1fr) var(--w-checks);
  gap: 0;
  min-height: 0;
}
.run > * + * { border-inline-start: var(--bd-hair) solid var(--ln); }   /* seams, not shadows */

.run__field {                 /* the script field column */
  display: grid;
  justify-items: center;
  overflow-y: auto;
  padding-block: var(--sp-6);
  background: var(--sf-field);
}
.specimen {
  display: grid;
  grid-template-columns: var(--w-linenum) calc(var(--w-lane) * var(--lane-count, 0)) minmax(0, var(--measure));
  column-gap: var(--sp-3);
  font-family: var(--ff-specimen);
  font-size: var(--fs-specimen);
  line-height: var(--lh-spec);      /* = 26px = --pitch */
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
```

`--lane-count` is set inline on `.specimen` from the run: one lane per check that has at least one
verified span, in rubric order, capped at 9. Lane index is stable for the life of the run, so a
check never changes lane between passes.

Each source line (split on `\n`) is wrapped in `<span class="spec-line" data-line={n}>`. Wrapped
continuation rows carry no number, as in a script. A `ResizeObserver` on `.specimen` recomputes each
coverage rule's `{top, height}` in pixels from the first and last `spec-line` that contains one of
that check's spans; rules are drawn in one absolutely positioned SVG layer over the lane column.

**1024px.** The pass rail leaves the left column and becomes a 44px horizontal strip directly under
the top bar, scrollable if needed; the verdict moves from the rail's foot into the strip's right
end. Columns become `minmax(0, 1fr) 340px`. `--measure` drops to `58ch`, `--w-lane` to `5px`. Check
reasons still show for failing checks; the meter shrinks from 72px to 56px.

**Phone (<720px).** One column, in this order: top bar → pass strip (horizontal, scroll-snapped) →
verdict → `CheckStrip` (a single 36px-tall row of nine band marks with their percentages, the whole
result at a glance and each cell tappable) → description → full check list → fragment diffs. The
coverage gutter collapses to one 4px lane that draws only the currently selected check. Selecting a
check scrolls the description to its first span and raises a sticky 56px footer bar naming the
check, its band, and `‹ 2 of 4 ›` fragment pagers. Tap targets are 44×44 minimum; the check rows are
already taller than that.

### 4.2 Architecture screen

Desktop, ≥1280px:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PROMPT COACH  │ RUN  ARCHITECTURE  VERSIONS │ 7f3a2c · pass 2/3 · 00:41.2 elapsed  │◐│
├──────────────────────────────────────────────────────────────┬─────────────────────────┤
│                                                              │ NODE                    │
│  ┌────────┐                                                  │ evaluator · group A     │
│  │ INTAKE ├──┐                                               │ ────────────────────────│
│  └────────┘  │   ┌──────────────┐                            │ state      done         │
│              ├──▶│ EVALUATOR A  │══╗                         │ cue        2-eval-A     │
│ ┌ ─ ─ ─ ─ ┐  │   └──────────────┘  ║                         │ latency    3.84 s       │
│ │INTERROG-│  │   ┌──────────────┐  ║  ┌──────────┐           │ in         1 142 tok    │
│ │ATOR     │  ├──▶│ EVALUATOR B  │══╬═▶│  VERIFY  │           │ out          612 tok    │
│ │ PLANNED │  │   └──────────────┘  ║  │  SPANS   │           │ cost       $0.0210      │
│ └ ─ ─ ─ ─ ┘  │   ┌──────────────┐  ║  └────┬─────┘           │ ────────────────────────│
│              └──▶│ EVALUATOR C  │══╝       │ 11 verified     │ PAYLOAD          ⧉ copy │
│                  │  ● running   │          │  1 unverified   │┌───────────────────────┐│
│                  └──────────────┘          ▼                 ││{                      ││
│                                      ┌──────────┐            ││ "checkId":"wardrobe", ││
│ ┌ ─ ─ ─ ┐   ┌ ─ ─ ─ ─ ─ ┐            │ REPAIRER │            ││ "band": 1,            ││
│ │DIRECT-│   │ IDENTITY  │            └────┬─────┘            ││ "quotes": [           ││
│ │OR     │   │ METER     │                 ▼                  ││   "a Nike windbreaker"││
│ │PLANNED│   │ PLANNED   │            ┌──────────┐            ││ ]                     ││
│ └ ─ ─ ─ ┘   └ ─ ─ ─ ─ ─ ┘            │  SPLICE  │            ││}                      ││
│                                      └────┬─────┘            │└───────────────────────┘│
│                                           ▼                  │                         │
│                                      ┌──────────┐            │                         │
│                                      │   GATE   │            │                         │
│                                      │  ≥ band4 │            │                         │
│                                      └──────────┘            │                         │
├──────────────────────────────────────────────────────────────┴─────────────────────────┤
│ CUE LOG  2-eval-A done 3.84s · 2-eval-B done 4.10s · 2-eval-C running · 2-verify queued │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

```css
.arch {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--w-inspect);
  grid-template-rows: minmax(0, 1fr) 132px;
  grid-template-areas: "graph inspect" "cues cues";
  min-height: 0;
}
.arch__graph   { grid-area: graph;   overflow: auto; }
.arch__inspect { grid-area: inspect; border-inline-start: var(--bd-hair) solid var(--ln);
                 background: var(--sf-panel-raised); box-shadow: var(--sh-raise); }
.arch__cues    { grid-area: cues;    border-block-start: var(--bd-hair) solid var(--ln);
                 background: var(--sf-panel); overflow-y: auto; }
```

The graph is a hand-laid SVG on a fixed 12 × 9 lattice whose unit is `--pitch` (26px), giving a 312
× 234 logical board scaled by a single `viewBox`. It is **not** a force layout: this is a known,
fixed pipeline, and a physics simulation of a known graph is decoration. Node positions are a
constant in code. Edges are orthogonal polylines with a 3px corner radius, stroked `--ln-strong` at
1px when idle and 2px in the active band colour when carrying a completed step.

**1024px.** The inspector detaches and becomes a bottom sheet at `--sf-panel-raised` with
`--sh-raise`, opening to 45dvh over the graph, dismissible with Escape. The graph takes the full
width; the cue log collapses to a single 32px line showing the most recent cue with a disclosure to
expand.

**Phone.** The graph becomes a vertical stage list: one 52px row per node in pipeline order, with
the node's state mark, label, cue id, and latency, connected by short 12px vertical rules in the
left gutter. Planned nodes keep their dashed treatment as a dashed row rule. Tapping a stage opens
the inspector full-screen. A node graph that must be pinch-zoomed is worse than a list, and the list
carries every state, payload, latency and cost the graph does.

### 4.3 Versions screen

Desktop, ≥1280px:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PROMPT COACH  │ RUN  ARCHITECTURE  VERSIONS │ 5 versions · gold set 40 items       │◐│
├────┬─────┬────────┬──────────┬───────┬───────┬─────────────┬───────────────────────────┤
│ ☐  │ VER │ KIND   │ SEALED   │  MEAN │     Δ │ CHECK PROFIL│ NOTE                      │
├────┼─────┼────────┼──────────┼───────┼───────┼─────────────┼───────────────────────────┤
│ ☑  │ ▪v1 │ rubric │ 09-02    │  62.2 │     — │ ╌╌╌╌╱╲╌╌╌╌╌ │ first frozen rubric; band │
│    │     │        │          │       │       │             │ wording drafted from 12   │
├────┼─────┼────────┼──────────┼───────┼───────┼─────────────┼───────────────────────────┤
│ ☑  │ ▪v2 │ rubric │ 09-07    │  71.1 │ +8.9 ▲│ ╌╌╱╌╲╱╌╌╌╌╌ │ split hair_spec into      │
│    │     │        │          │       │       │             │ colour + texture + style  │
├────┼─────┼────────┼──────────┼───────┼───────┼─────────────┼───────────────────────────┤
│ ☐  │ ▪e1 │ prompt │ 09-08    │  71.1 │  0.0 =│ ╌╌╱╌╲╱╌╌╌╌╌ │ added quote-exactly       │
│    │     │        │          │       │       │             │ instruction to evaluator  │
├────┴─────┴────────┴──────────┴───────┴───────┴─────────────┴───────────────────────────┤
│ COMPARE  v1 ⇄ v2                         gold set 40 items · κ 0.71 → 0.78    ⇄ swap   │
│ ┌───────────────────────────────────┬──────────────────────────────────────────────┐   │
│ │ PROMPT DIFF     evaluator/v1 → v2 │ PER-CHECK DELTA                              │   │
│ │ ─────────────────────────────────  │ ──────────────────────────────────────────── │   │
│ │  12   Score each check 1 to 5.    │ age_build      60 ▰▰▰   →  80 ▰▰▰▰   +20 ▲   │   │
│ │  13 − Use your judgement.         │ face_skin      80 ▰▰▰▰  →  80 ▰▰▰▰     0 =   │   │
│ │  13 + Use only the band wording   │ hair_spec      40 ▰▰    →  80 ▰▰▰▰   +40 ▲   │   │
│ │  14 + below. Do not paraphrase.   │ wardrobe       60 ▰▰▰   →  40 ▰▰     −20 ▼   │   │
│ └───────────────────────────────────┴──────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

```css
.versions { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; }

.vtable { display: grid;
  grid-template-columns: 40px 56px 72px 96px 68px 84px 104px minmax(0, 1fr);
  align-items: start; }
.vtable__row { display: grid; grid-column: 1 / -1;
  grid-template-columns: subgrid;
  border-block-end: var(--bd-hair) solid var(--ln-faint);
  padding-block: var(--sp-3); }
.vtable__row[aria-selected="true"] { background: var(--sf-panel); box-shadow: inset 2px 0 0 var(--mark); }
```

The sparkline is a nine-point check profile in rubric order rather than a time series. A fake time
axis over five versions would be the decorative sparkline the craft floor refuses. A profile makes
"v2 beat v1" legible check by check, which is exactly what spec §9 asks the screen to prove, and the
pass threshold is drawn across it as a 1px `--ln-strong` hairline at 80 so the shape reads rather
than decorates.

**1024px.** The `NOTE` column moves out of the row into a disclosure that opens beneath it; columns
become `36px 48px 64px 80px 60px 76px 92px`. The compare pane's two halves stack vertically, prompt
diff first.

**Phone.** The table becomes hairline-separated blocks, no card, no shadow: line 1 carries the
revision chip, version id and kind; line 2 the mean, delta badge and profile; lines 3 and 4 the
note. Compare becomes a two-step flow: a `SELECT A` / `SELECT B` header that fills as you tap two
rows, then a full-screen compare with the two panes stacked and a sticky swap control.

---

## 5. Component inventory

Shared domain types. Put them in `src/domain/types.ts`; every component below imports from here.

```ts
export type CheckId =
  | 'age_build' | 'face_skin' | 'hair_spec' | 'wardrobe' | 'anchor_marker'
  | 'no_real_person' | 'no_brand_name'
  | 'drawable_only' | 'no_cross_slot';

export type GroupId = 'A' | 'B' | 'C';
export type Band = 1 | 2 | 3 | 4 | 5;
export type BandPercent = 20 | 40 | 60 | 80 | 100;

export type TerminalState = 'passed' | 'improved_still_failing' | 'no_improvement';
export type RunStatus = 'idle' | 'submitting' | 'streaming' | 'failed' | TerminalState;

export interface Span {
  id: string;            // stable: `${pass}-${checkId}-${index}`
  checkId: CheckId;
  quote: string;
  start: number;         // computed in code via description.indexOf
  end: number;
}

export interface UnverifiedQuote {
  id: string;
  checkId: CheckId;
  quote: string;
  retried: boolean;      // true once the quote-exactly retry has been spent
}

export interface CheckResult {
  checkId: CheckId;
  group: GroupId;
  band: Band;
  percent: BandPercent;
  reason: string;
  spans: Span[];
  unverified: UnverifiedQuote[];
}

export interface Replacement {
  spanId: string;
  checkId: CheckId;
  before: string;
  after: string;
  rationale: string;
  line: number;          // 1-based source line of `before` in that pass's description
  bandBefore: Band;
  bandAfter?: Band;      // known only after the next pass evaluates
}

export interface PassResult {
  pass: 1 | 2 | 3;
  description: string;   // the text this pass was evaluated against
  checks: CheckResult[];
  replacements: Replacement[];
  startedAt: number;
  completedAt?: number;
}

export type NodeState = 'queued' | 'running' | 'done' | 'failed' | 'planned';
export type NodeKind  = 'intake' | 'agent' | 'enforce' | 'gate';

export interface PipelineNode {
  id: string;
  label: string;
  kind: NodeKind;
  state: NodeState;
  cueId?: string;        // `${pass}-${step}` from the SSE event id
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  payload?: unknown;
  error?: string;
  note?: string;         // e.g. "11 verified · 1 unverified"
}

export interface VersionRecord {
  id: string;                       // 'v1', 'e2', 'r1'
  kind: 'rubric' | 'evaluator_prompt' | 'repairer_prompt';
  sealedAt: string;                 // ISO date
  revisionIndex: number;            // 1-9, indexes the revision-paper ramp
  meanPercent: number;
  deltaPercent: number | null;      // null for the first version of its kind
  profile: Record<CheckId, BandPercent>;
  note: string;                     // required by spec §7; never optional in the UI
  kappa?: number;
  goldSetSize?: number;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  rubricVersion: string;
  evaluatorPromptVersion: string;
  repairerPromptVersion: string;
  model: string;
}
```

### Shared

| Component | Props | Responsibility |
|---|---|---|
| `AppShell` | `{ children: React.ReactNode }` | Grid frame, top bar slot, 100dvh, 16px side gutter, theme attribute owner. |
| `TopBar` | `{ screen: 'run' \| 'architecture' \| 'versions'; manifest: RunManifest \| null; right?: React.ReactNode }` | Product mark, screen tabs, run provenance strip, theme toggle. |
| `ScreenTabs` | `{ active: 'run' \| 'architecture' \| 'versions'; failingCount: number; onChange(s): void }` | Three tabs; carries the failing-check count as a persistent badge on `RUN` so a failed run stays visible from any screen. |
| `RunIdentityStrip` | `{ manifest: RunManifest; elapsedMs?: number; compact?: boolean }` | Run id, timestamp, rubric version, prompt versions, model. Present on all three screens, because a score with no provenance is not evidence. |
| `ThemeToggle` | `{ theme: 'dark' \| 'light'; onChange(t): void }` | Sets `data-theme` on `<html>`; persists to `localStorage`, defaults to dark. |
| `CueBadge` | `{ cueId: string; state?: NodeState }` | Renders `2-eval-A` at `--fs-micro` in `--ink-3`. The visible form of the SSE event id; deep-linkable as `#cue=2-eval-A`. |
| `SectionLabel` | `{ children: React.ReactNode; as?: 'h2' \| 'h3' }` | Uppercase 12px Archivo at width 88, `--tr-caps`, `--ink-3`, with the 1px seam beneath. The only heading treatment in the product. |
| `EmptyState` | `{ title: string; body: string; action?: { label: string; onAction(): void } }` | Teaches the screen. Never the word "nothing". |
| `ErrorPanel` | `{ title: string; detail: string; cueId?: string; onRetry?(): void; canResume: boolean }` | Alarm-outline panel. Names the failed cue and the recovery. |
| `SkeletonRows` | `{ rows: number; height: number }` | Pitch-aligned placeholder rules. Used instead of spinners inside content. |
| `LiveAnnouncer` | `{ politeness: 'polite' \| 'assertive'; message: string }` | Single visually-hidden `role="status"` / `role="alert"` region. See §7. |

### Run screen

| Component | Props | Responsibility |
|---|---|---|
| `RunScreen` | `{ runId?: string }` | Owns `useRunStream` and `useSelection`; lays out the three columns. |
| `DescriptionComposer` | `{ value: string; onChange(v: string): void; onSubmit(): void; disabled: boolean; maxChars: number }` | Pre-run textarea, character count, submit. Unmounts once the run starts; the description is read-only thereafter. |
| `SpecimenView` | `{ text: string; spans: Span[]; lanes: CheckId[]; selectedCheckId: CheckId \| null; selectedSpanId: string \| null; bandOf(c: CheckId): Band; onSelectSpan(spanId: string): void }` | The script field: numbered source lines, coverage gutter, span-highlighted text. Measures line geometry and publishes it to the gutter. |
| `SpecimenLine` | `{ n: number; children: React.ReactNode }` | One numbered source line at `--pitch` rhythm; continuation rows unnumbered. |
| `CoverageGutter` | `{ lanes: CheckId[]; rules: CoverageRuleGeometry[]; selectedCheckId: CheckId \| null; onSelectCheck(c: CheckId): void }` | The SVG lane layer. `CoverageRuleGeometry = { checkId: CheckId; lane: number; top: number; height: number; band: Band }`. |
| `CoverageRule` | `{ lane: number; top: number; height: number; band: Band; selected: boolean; label: string }` | One vertical rule in its band's stroke pattern, with a 3-letter tab at its head when selected. |
| `SpanMark` | `{ span: Span; band: Band; selected: boolean; onSelect(id: string): void }` | The inline highlighted fragment: `--span-N` ground, 2px band-coloured underline, `--mark-soft` ground plus a 2px `--mark` underline when selected. Renders as `<mark>` wrapping a `<button>`. |
| `CheckPanel` | `{ checks: CheckResult[]; selectedCheckId: CheckId \| null; onSelectCheck(c: CheckId \| null): void; streaming: boolean }` | The right column. Three groups, nine rows, always all nine. Header shows `n/9 at ≥80`, a count of checks, never an averaged score. |
| `CheckGroupHeader` | `{ group: GroupId; label: string; total: number }` | Header only. **Must not render an aggregate band, average or progress bar** (spec §9). |
| `CheckRow` | `{ result: CheckResult \| null; selected: boolean; streaming: boolean; onSelect(c: CheckId): void }` | One check: state mark, name, percentage, meter, and, only when `band < 4`, the reason and the quote list. `result: null` renders the pre-result skeleton. |
| `BandMeter` | `{ band: Band; percent: BandPercent; width?: number; showThreshold?: boolean }` | Five segments, filled to `band`, trough `--band-N-tint`, a 1px `--ln-strong` threshold notch between segments 3 and 4. |
| `BandMark` | `{ band: Band; orientation: 'h' \| 'v'; size?: number; title: string }` | The authored SVG stroke-pattern swatch. Geometry is fixed: band 1 a 4px-period sine of 1.5px amplitude; band 2 `stroke-dasharray: 1 3`; band 3 `stroke-dasharray: 4 3`; band 4 a solid 1.5px stroke; band 5 two 1px strokes 2px apart. `currentColor`, `stroke-linecap: butt`. This is the signal that survives `grayscale(1)`. |
| `QuoteList` | `{ spans: Span[]; unverified: UnverifiedQuote[]; selectedSpanId: string \| null; onSelectSpan(id: string): void }` | The verbatim fragments under a failing check, each jumping to its span. |
| `UnverifiedQuoteNotice` | `{ quote: UnverifiedQuote }` | The explicit **fragment not found** state. Alarm outline, `--span-unverified` ground, the quote in Courier Prime, and the line: *"This quote was not found in the description. It was excluded from repair and logged. This is a pipeline defect, not a display problem."* Never silently omitted. |
| `PassStepper` | `{ passes: PassResult[]; current: 1 \| 2 \| 3; terminal: TerminalState \| null; onSelect(p: 1 \| 2 \| 3): void }` | Passes 1 to 3 as takes. Unreached passes render as empty frames, not as greyed duplicates. The final frame takes a cross-bar terminator when the terminal state is a failure. |
| `PassStep` | `{ pass: 1 \| 2 \| 3; state: 'empty' \| 'running' \| 'done' \| 'terminated'; changedCount?: number; selected: boolean; onSelect(): void }` | One take frame plus its changed-fragment count. |
| `FragmentDiff` | `{ pass: 1 \| 2 \| 3; replacements: Replacement[] }` | **Only the fragments that changed.** Never renders the full text. Empty renders `"No fragments changed in this pass."` at `--ink-2`. |
| `FragmentDiffRow` | `{ replacement: Replacement; onSelectSpan(id: string): void }` | Source line number, `−` before in `--diff-del` on `--diff-del-ground`, `+` after in `--diff-add` on `--diff-add-ground`, then `checkId · band N → M` and the rationale. The `−`/`+` characters are literal text, present regardless of colour. |
| `VerdictBanner` | `{ status: RunStatus; passesUsed: number; failingCount: number; meanDelta: number; onStartNew(): void }` | The terminal state. Governed entirely by §6's table; contains the one display numeral on the screen. |
| `CheckStrip` | `{ checks: CheckResult[]; selectedCheckId: CheckId \| null; onSelectCheck(c: CheckId): void }` | Phone only: nine band marks with percentages in one 36px row. |

### Architecture screen

| Component | Props | Responsibility |
|---|---|---|
| `ArchitectureScreen` | `{ runId?: string }` | Subscribes to the same `useRunStream` as Run; owns node selection. |
| `PipelineGraph` | `{ nodes: PipelineNode[]; edges: GraphEdge[]; selectedNodeId: string \| null; onSelectNode(id: string \| null): void }` | Fixed-lattice SVG board. `GraphEdge = { from: string; to: string; state: NodeState }`. No force simulation. |
| `GraphNode` | `{ node: PipelineNode; selected: boolean; onSelect(id: string): void }` | One node. `queued` 1px `--ln` on `--sf-panel` with `--ink-3` label; `running` 2px `--mark` border plus a visible `RUNNING` tag; `done` 1px `--band-4` border with a solid corner tick; `failed` solid `--sig-alarm-fill` with `--sig-alarm-ink`; `planned` 1px dashed `--ln` (`stroke-dasharray: 5 4`), `--ink-3`, and a literal `PLANNED` tag. The dash pattern and the tag carry "planned", not the colour. |
| `GraphEdge` | `{ from: Point; to: Point; state: NodeState }` | Orthogonal polyline, 3px corners, 1px `--ln-strong` idle, 2px band colour when carrying a completed step. |
| `NodeInspector` | `{ node: PipelineNode \| null; onClose(): void }` | The one elevation step. State, cue id, latency, tokens in/out, cost, then the real payload. Empty renders the instruction to select a node. |
| `MetricRow` | `{ label: string; value: string; unit?: string; mono?: boolean }` | One label/value pair, tabular figures, label `--ink-3`, value `--ink`. |
| `PayloadViewer` | `{ value: unknown; maxHeight?: number; onCopy?(): void }` | Courier Prime JSON, 2-space indent, keys `--ink-2`, strings `--ink`, numbers `--band-5`, `overflow: auto`, copy action. No syntax-highlighting library. |
| `CueLog` | `{ entries: CueEntry[]; onSelectCue(cueId: string): void }` | Append-only list of every event received, newest last. `CueEntry = { cueId: string; label: string; state: NodeState; ms?: number; at: number }`. This is the audit record; it is never truncated within a run. |
| `StageList` | `{ nodes: PipelineNode[]; selectedNodeId: string \| null; onSelectNode(id: string): void }` | Phone replacement for `PipelineGraph`; same states, same payload access. |

### Versions screen

| Component | Props | Responsibility |
|---|---|---|
| `VersionsScreen` | `{}` | Loads the version records, owns the two-version compare selection. |
| `VersionTable` | `{ versions: VersionRecord[]; selected: [string?, string?]; onToggleSelect(id: string): void }` | The rows. Selection is capped at two; selecting a third replaces the older. |
| `VersionRow` | `{ version: VersionRecord; selected: boolean; onToggleSelect(id: string): void }` | Checkbox, revision chip, id, kind, sealed date, mean, delta badge, profile, note. |
| `RevisionChip` | `{ index: number; versionId: string }` | An 11 × 14px paper chip in `--rev-N` with a 1px `--ln` edge, always immediately followed by the version id in text. Colour is identity, never state. |
| `DeltaBadge` | `{ delta: number \| null; unit?: '%' \| 'pt' }` | `+8.9 ▲` / `−1.2 ▼` / `0.0 =`. The arrow is an authored SVG, the sign is literal text, and the colour is `--band-4` up / `--band-1` down / `--ink-3` flat. Three signals, colour last. `null` renders an en rule with `aria-label="no previous version"`. |
| `CheckProfileSparkline` | `{ profile: Record<CheckId, BandPercent>; compareTo?: Record<CheckId, BandPercent>; width?: number; height?: number }` | Nine points in rubric order, 104 × 20px, 1.5px polyline, threshold hairline at 80 in `--ln-strong`. With `compareTo`, the earlier profile draws behind at 1px dashed. Not a time series. |
| `VersionCompare` | `{ a: VersionRecord; b: VersionRecord; promptDiff: DiffLine[]; onSwap(): void }` | The two-pane compare. `DiffLine = { line: number; kind: 'ctx' \| 'del' \| 'add'; text: string }`. |
| `PromptDiff` | `{ lines: DiffLine[]; title: string }` | Unified diff in Courier Prime, line numbers in `--ink-3`, `−`/`+` literal, same colour pair as `FragmentDiffRow`. `overflow-x: auto`. |
| `CheckDeltaTable` | `{ a: VersionRecord; b: VersionRecord }` | Nine rows: check name, band meter before, arrow, band meter after, delta badge. This is the "v2 beat v1, check by check" artefact. |
| `AgreementReadout` | `{ kappa?: number; goldSetSize?: number }` | Cohen's kappa and gold-set size when present. When absent renders *"not yet measured"* in `--ink-3`. **Never a zero, never a placeholder number.** |

### Hooks

```ts
export interface RunStreamState {
  status: RunStatus;
  manifest: RunManifest | null;
  description: string;
  passes: PassResult[];
  currentPass: 1 | 2 | 3;
  nodes: PipelineNode[];
  cues: CueEntry[];
  terminal: TerminalState | null;
  error: { cueId?: string; message: string } | null;
  elapsedMs: number;
}
export function useRunStream(runId: string | undefined): RunStreamState;
```

One `EventSource` per run, shared by both Run and Architecture through a context provider so the two
screens are driven by the same events rather than by two subscriptions. Reconnects with
`Last-Event-ID`, which is why the cue ids are `<pass>-<step>`. Events are applied through a reducer;
`PipelineNode` state is derived from the cue log, never stored twice.

```ts
export interface Selection { checkId: CheckId | null; spanId: string | null; }
export function useSelection(spansByCheck: Map<CheckId, Span[]>): {
  selection: Selection;
  selectCheck(c: CheckId | null): void;   // sets spanId to that check's first span
  selectSpan(id: string): void;           // sets checkId to that span's owner
  nextSpan(): void; prevSpan(): void;
  nextCheck(): void; prevCheck(): void;
  clear(): void;
};
```

One source of truth for the bidirectional check ↔ fragment link. Nothing else in the app holds
selection state.

---

## 6. States

### 6.1 Run screen

**Empty (no run started).** The check column renders all nine rows with their names, group headers,
and an empty five-segment meter in `--band-N-tint`. The rubric is visible before you have a score,
which teaches what is about to be measured. The field column holds `DescriptionComposer` with the
placeholder *"Paste the character description."* and a character count. The rail shows three empty
take frames. `EmptyState` body: *"Nine checks, three groups, up to three repair passes. Nothing here
spends a render credit."*

**Loading / streaming.** The composer unmounts and the text becomes the read-only specimen
immediately. Check rows arrive by group as `evaluator.group.completed` lands, so groups fill in
three steps and never all at once. A row awaiting its result shows `SkeletonRows` at one pitch cell
and the group header shows `-- / n`. The rail's current take frame carries the `RUNNING` tag. The
cue badge under the rail updates to the latest cue id. Coverage rules draw as their spans verify. No
aggregate appears at any point, including mid-stream.

**Error (`run.failed`).** `ErrorPanel` replaces the pass stepper, not the screen: everything already
received stays on screen, because partial evidence is still evidence. It names the failed cue
(`2-eval-B`), the message, and whether the stream can resume from `Last-Event-ID`. The verdict slot
shows `RUN FAILED` in the alarm outline treatment. Checks that never arrived keep their empty meters
and are labelled `not evaluated` in `--ink-3`, never `0` and never band 1.

### 6.2 The three terminal states

This table is binding. A developer implementing `VerdictBanner` may use nothing outside the row.

| | `passed` | `improved_still_failing` | `no_improvement` |
|---|---|---|---|
| Verdict word | `PASSED` | `STILL FAILING` | `NO IMPROVEMENT` |
| Treatment | 2px `--band-5` outline, `--sf-panel` ground, `--band-5` word | 2px `--sig-alarm-edge` outline, `--sig-alarm-tint` ground, `--sig-alarm-edge` word | **Solid `--sig-alarm-fill`, `--sig-alarm-ink` word.** The only solid colour fill behind text in the product |
| `--fs-count` numeral | `9` | the count of checks still below band 4 | the count of checks still below band 4 |
| Numeral label | `of 9 checks at band 4 or above` | `checks still below band 4` | `checks still below band 4` |
| Mandatory second line | `3 passes used · mean 88` | `3 passes used · mean rose 62 → 80 · the description did not pass` | `3 passes used · mean unchanged at 62 · no fragment improved its band` |
| `BandMark` in the banner | band 5 double rule | band 1 wave | band 1 wave |
| Final `PassStep` | closed frame | cross-bar terminator | cross-bar terminator |
| `ScreenTabs` RUN badge | none | failing count, alarm outline | failing count, alarm fill |
| Tokens **forbidden** | none | `--band-4`, `--band-5`, `--diff-add`, any tick or check glyph | `--band-4`, `--band-5`, `--diff-add`, any tick or check glyph |
| Words **forbidden** | none | complete, success, done, finished, ✓, "improved" without "still failing" in the same line | complete, success, done, finished, ✓ |

Three structural facts make a failure hard to misread, beyond the colours:

1. The display numeral is **the count of failing checks**, not the score. On a failed run the
   biggest number on the screen counts what is still wrong. The improvement figure exists, is
   honest, and is set at `--fs-ui` in `--ink-2` on the second line where it cannot be read as the
   headline.
2. `improved_still_failing` may never render the word *improved* on its own. The string is fixed:
   `mean rose 62 → 80 · the description did not pass`. The clause that qualifies it is in the same
   line, not below it, so no truncation or screenshot can separate them.
3. `no_improvement` is the only state in the entire product that uses a solid colour fill behind
   text. Nothing else can borrow that treatment, so it is unmistakable and cannot drift into being a
   style.

### 6.3 Architecture screen

**Empty.** The full graph renders with every node `queued` and the planned agents dashed. This is
the correct empty state: the pipeline is a fact before any run exists, and showing it is how the
screen earns the word *architecture*. Inspector reads *"Select a node to see its payload, latency
and cost."*

**Streaming.** Nodes flip through `queued → running → done` from the cue stream. The three evaluator
nodes run concurrently and must be seen to. All three carry the `RUNNING` tag at once, matching spec
§4. `VERIFY SPANS` shows its real counts (`11 verified · 1 unverified`) as a node note; a non-zero
unverified count draws the node's border in `--sig-alarm-edge` while the node itself is still
`done`, because an unverified quote is a defect inside a successful step.

**Error.** The failing node takes the solid alarm fill. Its inspector opens automatically with the
error and the raw payload. Downstream nodes stay `queued`, never `failed`. Only the node that
actually failed is marked failed.

**Terminal.** The `GATE` node's state is the run's terminal state: `done` with a band-5 tick for
`passed`, solid alarm fill for both failure states, with the terminal state as its label.

### 6.4 Versions screen

**Empty.** One row: the sealed `v1`. The compare pane reads *"Select two versions to compare."*
Never a zero-state illustration.

**Loading.** `SkeletonRows` at the row pitch, column heads already drawn.

**Error.** `ErrorPanel` above the table with the store path that failed to read, because the store
is files on disk and the path is the recovery.

**Missing note.** Spec §7 makes the note required. If a version record arrives without one, the row
renders `note required, not recorded` in `--sig-alarm-edge` and the row takes the alarm outline. An
undocumented version is a defect in the record, and the screen says so rather than leaving a blank
cell.

**Missing agreement data.** `AgreementReadout` renders *"κ not yet measured"*. The gold set is not
marked yet; no screen may show a fabricated kappa, and no placeholder number may appear anywhere.

---

## 7. Accessibility

### Contrast, verified

Computed from the exact token values in §2 with the WCAG 2.x relative-luminance formula on
2026-09-11. Ratios are text-on-surface unless noted.

| Pair | Dark | Light | Requirement |
|---|---|---|---|
| `--ink` on `--sf-ground` / `--sf-panel` / `--sf-field` | 16.24 / 15.01 / 16.89 | 15.59 / 16.73 / 17.18 | ≥4.5 |
| `--ink-2` on the same three | 9.37 / 8.65 / 9.74 | 7.59 / 8.14 / 8.36 | ≥4.5 |
| `--ink-3` on the same three | 5.56 / 5.14 / 5.78 | 4.71 / 5.05 / 5.19 | ≥4.5 |
| `--band-1` on ground / panel | 7.13 / 6.59 | 5.86 / 6.29 | ≥4.5 |
| `--band-2` on ground / panel | 9.72 / 8.98 | 4.85 / 5.20 | ≥4.5 |
| `--band-3` on ground / panel | 12.90 / 11.92 | 4.83 / 5.18 | ≥4.5 |
| `--band-4` on ground / panel | 5.25 / 4.85 | 7.33 / 7.86 | ≥4.5 |
| `--band-5` on ground / panel | 7.36 / 6.80 | 10.18 / 10.92 | ≥4.5 |
| `--sig-alarm-ink` on `--sig-alarm-fill` | 6.92 | 7.02 | ≥4.5 |
| `--sig-alarm-edge` on ground | 5.37 | 5.92 | ≥4.5 |
| `--ink` on every `--band-N-tint` | 11.66 to 12.65 | 12.94 to 14.35 | ≥4.5 |
| specimen `--ink` on every `--span-N` and `--span-unverified` | 13.07 to 14.40 | 12.10 to 14.25 | ≥4.5 |
| `--focus` on `--sf-ground` | 17.22 | 12.29 | ≥3 (non-text) |
| `--ln-strong` on ground (graph edges, threshold notch) | 2.79 | 3.00 | ≥3 light; dark edges are decorative duplicates of a labelled state |
| `--rev-ink` on every revision chip | 7.34 to 17.46 | same | ≥4.5 |

The lowest text ratio anywhere in the product is 4.71:1.

### Colour vision, and the measurement that drove the design

Band values were simulated for deuteranopia and protanopia (Viénot, Brettel) and the adjacent-band
contrast measured after simulation:

| | dark, deuter | dark, protan | light, deuter | light, protan |
|---|---|---|---|---|
| band 3 vs band 4 (**the pass threshold**) | 2.66 | 2.15 | 1.62 | 1.33 |
| band 1 vs band 2 | 1.30 | 1.54 | 1.11 | 1.57 |
| band 2 vs band 3 | 1.26 | 1.47 | 1.04 | 1.12 |
| band 4 vs band 5 | 1.41 | 1.39 | 1.38 | 1.43 |

Two conclusions, both of which the design acts on:

- The hot to cool hue break plus the luminance break at the threshold gives the pass boundary 2.15
  to 2.66:1 in dark. A conventional green/amber/red ramp measured 1.03:1 at the same boundary in the
  same test. That is why the ramp's break sits exactly where the semantic break sits, instead of
  running smoothly from 20 to 100.
- Colour genuinely cannot separate bands 1, 2 and 3 in the light theme. The worst pair measures
  1.04:1. That is why `BandMark`'s five stroke patterns, the printed percentage and the meter fill
  length exist. Every band is legible at `filter: grayscale(1)`, and that filter is a required
  manual check before merge. The same rule governs node states (dash pattern plus literal tag),
  diffs (the `−` and `+` characters), and delta badges (sign, then arrow, then colour).

### Focus order

Top bar → screen tabs → run identity → theme toggle → main. A skip link (`Skip to checks`) is the
first focusable element and lands on `CheckPanel`.

Within the Run screen, tab order is **rail → field → checks**, matching the visual order:
`PassStepper` (one stop, arrow keys inside) → `SpecimenView` (one stop, arrow keys inside) →
`CheckPanel` (one stop, arrow keys inside) → `FragmentDiff` rows. Three composite widgets, three tab
stops, not two hundred. `VerdictBanner`'s action is the last stop.

### Keyboard, and the check to fragment link

`CheckPanel` is `role="listbox"` with `aria-activedescendant`; each `CheckRow` is `role="option"`
with `aria-selected`. Roving tabindex.

| Key | In `CheckPanel` | In `SpecimenView` |
|---|---|---|
| `↑` / `↓` | previous / next check across group boundaries | no binding |
| `←` / `→` | no binding | previous / next span in document order |
| `Home` / `End` | first / last check | first / last span |
| `Enter` / `Space` | select the check, scroll its first span into view | select the span's owning check, move focus to its row |
| `Escape` | clear selection | clear selection |
| `n` / `p` | next / previous span **of the selected check** | same |
| `f` / `Shift+F` | next / previous **failing** check (band < 4) | same |
| `1` to `9` | select check by rubric index | same |

Selection is announced without moving focus: selecting `wardrobe` announces *"wardrobe, band 1, 20
percent, 2 fragments"*. Selecting a span announces *"fragment 2 of 2, wardrobe, band 1"*. Both go
through the polite `LiveAnnouncer`.

`SpanMark` renders `<mark><button>` so screen readers get both the highlight semantics and an
operable control; each button carries `aria-label="fragment N of M, {check name}, band {n}"`. The
specimen container is `role="group"` with `aria-label="Character description with check coverage"`.

`PipelineGraph` is a `role="list"` of `role="listitem"` buttons in pipeline order; arrow keys move
between nodes, Enter opens the inspector, Escape closes it and returns focus to the node. The SVG
carries `role="img"` with an `aria-label` summarising the pipeline, and every node is individually
reachable. `NodeInspector` as a bottom sheet at ≤1024px is a focus trap with Escape and a visible
close; sticky UI never covers the focused control (WCAG 2.2 *focus not obscured*).

`VersionTable` is a `role="grid"`; rows are `aria-selected` checkboxes capped at two.

### Live announcements while a run streams

One polite `role="status"` region and one assertive `role="alert"` region, both visually hidden,
both `aria-atomic="true"`. Nothing else in the app is a live region, because nine competing regions
would flood the buffer.

Announced **politely**, one message per pass step, never per token and never per node:

- `Pass 2 started.`
- - `Pass 2 evaluated. 6 of 9 checks at band 4 or above. 3 checks failing: hair spec, wardrobe, no
  brand name.`
- `Repair applied to 3 fragments.`
- selection changes (above)

Announced **assertively**:

- `Run failed at step 2-eval-B. Evaluator group B returned no parsable output.`
- every terminal state, in the exact wording from §6.2, so the failure states reach a screen reader
  as failures, with the qualifying clause in the same utterance.

Not announced: individual node transitions, cue log entries, elapsed time, coverage rules drawing.
All of these remain readable on demand in `CueLog`, which is a static list, not a live region.

### Reduced motion

Under `prefers-reduced-motion: reduce`, every state change still happens, as an immediate value
swap. Coverage rules appear at full length; check meters appear at final fill; the running node
shows its `RUNNING` tag and 2px `--mark` border with no marching pattern; graph edges show their
completed 2px band stroke with no flow; fragment diffs appear in place. No state in this product is
communicated by motion alone, so removing all of it removes no information. That is the test the
motion specification has to hold itself to.

### Remaining requirements

- Touch targets ≥44 × 44px on phone; check rows and pass frames already exceed it; `SpanMark` gets
  `padding-block: 6px` and a `-4px` negative margin at ≤720px so inline fragments stay tappable
  without disturbing the pitch.
- `cursor: pointer` on every clickable element, including coverage rules and graph nodes.
- - All icons are authored SVG at a 1.5px stroke on a 16px box. No emoji, no Unicode glyph
  substitutes. The `▲ ▼ ∿ ══` characters in this document's wireframes stand for drawn marks.
- The text is never zoom-locked; the layout holds to 200% browser zoom by dropping to the 1024px
  arrangement.
- - Every numeric column uses `font-variant-numeric: tabular-nums` so values do not shift as they
  stream.

---

## 8. Where motion belongs, and the handoff to the motion specification

Named moments only. No durations, no easing, no orchestration here; spec §9 already binds motion to
real state changes, forbids ambient and looping motion, forbids animating unchanged scores, and
forbids motion while typing.

1. **Check row reveal.** A group's five or two rows resolving as `evaluator.group.completed` lands.
   Three reveals per pass, one per group, never nine at once.
2. **Band meter fill.** Segments filling to the landed band. Must not animate on a re-render where
   the band is unchanged.
3. **Coverage rule draw.** A rule extending down its lane as its spans verify.
4. **Span highlight and selection.** Ground and underline changing on the check to fragment link.
5. **Graph edge flow.** Travel along an edge between agents, gated on a real `*.completed` event.
6. **Node state transition.** Queued to running to done.
7. **Fragment diff transition.** The `−` line giving way to the `+` line in the pass being viewed.
8. **Pass stepper advance.** The take frame moving from pass n to pass n+1.
9. **Inspector and bottom sheet.** The one elevation step arriving and leaving.

Three constraints the motion spec must honour, because they are correctness rather than taste: the
terminal failure states get no celebratory motion of any kind; every one of these moments must have
a complete static equivalent under reduced motion; and the cue log never animates, because it is the
audit record.

---

## 9. Implementation checklist

- [ ] `grayscale(1)` applied to all three screens: every band, node state, diff and delta still
  readable.
- [ ] Both themes checked at 1440, 1280, 1024, 768 and 390px with real content.
- [ ] A `no_improvement` run screenshotted and shown to someone who has not read this document. They
  must not describe it as having succeeded.
- [ ] No aggregate score, group average, or overall progress ring exists anywhere in the codebase.
- [ ] `UnverifiedQuoteNotice` reachable in a real run with a deliberately unmatchable quote.
- [ ] Keyboard-only pass through all three screens, no pointer.
- [ ] `node .claude/skills/impeccable/scripts/detect.mjs --json <built screens>` run once, after
      the screens are finished.
- [ ] DESIGN.md written from the built result at finish, per the direction contract's FINISH line.
