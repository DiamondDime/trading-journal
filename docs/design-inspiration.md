# Design Inspiration — The Soul of the Product

**Audience:** Claude Design. Read this FIRST, before `design-spec.md`. The spec tells you the rules; this tells you what you're aiming at.

**Status:** This is the artistic direction document. It is opinionated. When the spec and this doc seem to conflict, this doc wins on aesthetic decisions, the spec wins on technical rules.

---

## 0. What this product actually is

This is **not a dashboard**. It is a **journal**.

A serious crypto-spread trader opens this product to:
- Understand what's in their book right now
- Review trades they closed yesterday, last week, last quarter
- Read their own past notes — and see whether their thesis was right
- Build their playbook over months and years
- Treat each spread as a **research case** worth keeping

That's a different genre than "live trading screen." It's closer to:

- A **hedge fund analyst's research note**
- A **personal commonplace book** (Reflect, Lex, Bear)
- A **magazine layout** (FT Weekend, Bloomberg Businessweek)
- A **printed academic paper** with title, abstract, figures, conclusion
- A **researcher's index card archive** (Are.na, Notion's database views at their best)

The product should feel like opening one of those — not opening Robinhood, Coinbase, or any cookie-cutter B2B SaaS dashboard. It should have **gravitas**. It should look like the operator paid for *craft*, not features.

---

## 1. Reference apps with REAL character (study these)

Cliché references ("Bloomberg Terminal", "Linear", "Stripe Dashboard") create cliché output. Here are apps with strong distinctive aesthetic, in priority order:

**Top tier — study these closely:**

1. **Linear** (the actual product, not the cliché version) — `linear.app/homepage` is fine, but look at the *real app in use*. Soft dark grey palette (#0e1014-ish), Inter throughout, beautiful subtle motion, distinctive purple-magenta accent used SPARINGLY, refined typography hierarchy, real attention to micro-interactions. The thing that makes Linear feel premium is the *restraint*: every animation is 150ms, every shadow is barely there, every accent is intentional.

2. **Lex** (`lex.page`) — a writing tool for serious writers. Editorial gravitas. Big serif type, generous space, mature color, no consumer-app energy. **This is closest to the vibe we want.**

3. **Reflect** (`reflect.app`) — personal journaling tool. Has soul. Distinctive backlink visualization. Clean, focused, not pretending to be a productivity app.

4. **Pitch** (`pitch.com`) — slide tool. Magazine-quality typography in a software product. Display fonts done right.

5. **Cron / Notion Calendar** (`notion.com/product/calendar`) — month view as art. Real visual craft applied to a "boring" category.

6. **Things 3** (cultofmac.com/things-3 if you don't have a Mac) — pixel-perfect type, decisive, restrained. Every spacing decision is intentional.

7. **Cursor** (`cursor.com`) — IDE with soft glows, refined panels, real depth, distinctive visual identity that says "we sweat the details."

8. **Raycast** (`raycast.com`) — command palette with gradients done right, hero moments, brand personality.

**Editorial / publication references (the journal-feeling cousin):**

9. **Financial Times Weekend layout** — display serif headlines, body sans, mono numbers in tables, generous space, real photography in articles. The genre we're stealing from.

10. **Bloomberg Businessweek covers** — opinionated typography, real color, character.

11. **The Atlantic** website — refined long-form, mature color, beautiful typography.

12. **Substack reader** — when reading a serious newsletter, the typography craft is on display.

13. **Are.na** (`are.na`) — index-card aesthetic, hand-crafted feel, distinctive. The closest "personal archive" reference.

**Quant / finance with character:**

14. **Composer.trade** — algorithmic trading with refined gradients and real visual identity. Rare in the category.

15. **Pelican** / **Numerai** / **Tally.io** — finance brands with point of view.

**EXPLICITLY skip these as references (they will route to the wrong output):**

- ~~Bloomberg Terminal~~ — wrong genre. We're not a real-time terminal.
- ~~IBKR TWS~~ — old-school enterprise, no craft.
- ~~Robinhood / Coinbase / Revolut~~ — consumer-trader UX.
- ~~Stripe Dashboard marketing demo~~ — too consumer-friendly.
- ~~Notion's default views~~ — too generic.
- ~~Default shadcn-with-no-customization~~ — too undifferentiated.

---

## 2. The signature moves

These are the **5 design decisions that make the product distinctive**. Without them, it's another competent dashboard. With them, it has a face.

### Signature move #1 — Display serif for hero moments

A **Source Serif 4** (or IBM Plex Serif as alternate) display weight, used for:
- The page-hero metric on the spread detail page (72px, signature amber, font-weight 400)
- The spread name as a section title on the detail page (36-44px)
- Pull quotes from the operator's notes (italic, 20px)
- Section headings on the detail page ("THESIS", "DECOMPOSITION", "EXECUTION", "POSTMORTEM") — small caps tracked
- The page title on the dashboard

Inter remains the default body type. JetBrains Mono remains for tabular numbers in tables. **The serif is the signature** — it does the work of separating us from every other crypto/fintech tool, all of which use Inter or Geist Sans for everything.

Font imports:
```html
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Signature move #2 — Distinctive amber accent

`--accent-signature: #b8860b` (light mode) / `#d4a017` (dark mode) — old-gold / ticker-tape amber.

Used ONCE per screen, on the single most important element:
- The hero metric on the spread detail page
- The "live spread" indicator on the dashboard
- The brand mark in the page header
- The primary CTA on the open-spread form

It is **not** a button-bar color. It's a *signature*. Like the way the FT uses its salmon-pink — once and definitively, not everywhere.

The brand teal (`#0d8a8a`) from the previous spec becomes the **secondary** accent for category/info, not the primary signature.

State colors stay the same (mature green / red / amber-warn / blue-info), but on those nothing changes from the spec.

### Signature move #3 — Editorial layout for the spread detail page

The spread detail page is laid out **like a research note**, not like a dashboard:

```
Top right corner:   serial number + status pill (small, restrained)
Title area:         spread name (serif display 36-44px) + sublabel
                    + held-period sentence
Hero area:          ONE massive metric (serif 72px signature amber)
                    + a small qualifying italic line
                    + supporting line in body type

Body sections:      THESIS  →  DECOMPOSITION  →  EXECUTION  →  POSTMORTEM
                    Each with a small-caps tracked label (12px)
                    and Inter body content. Generous vertical rhythm
                    (48px between sections, 24px between subsections).

Pull quote from notes:   italic Source Serif 20px, indented, with
                         attribution line (12px tracked).

Verdict row:        Three checkmark questions, monospace symbols (✓ / ✗ / —),
                    short Inter answers.

Side panel (optional):   notes timeline, vertical, paper-feel.
```

This is **not** a dashboard with charts and KPIs scattered around. It's a single column of narrative interrupted by data visualizations as figures (with figure captions). Like reading a research note.

### Signature move #4 — The serial number (`#032`)

Every spread has an auto-incrementing display number (`#001`, `#032`, `#147`) shown:
- Top right of the spread detail page
- On every list-view card, small + dim, top-left
- In any search / filter UI

It frames the operator's collection as a **curated archive**. Researchers number their notebooks; we number our spreads.

Backend implementation: add a `display_seq` column to `spreads` table, populated by trigger (per-user incrementing).

### Signature move #5 — Calendar heatmap as art

The dashboard's calendar heatmap is the centerpiece, not a filler widget:
- Each day is a 16px square
- Background tinted by net PnL intensity for that day:
  - 0 PnL: `--bg-subtle`
  - Positive: gradient from `--accent-up-bg` to `--accent-up`
  - Negative: gradient from `--accent-down-bg` to `--accent-down`
- Hover: enlarged tile + tooltip with date + net + spread count
- Click: scroll to that day's spreads in the list below
- Vertical: months across, days down (like GitHub contributions but more refined)
- The hover state has a soft shadow elevation

When done right this single component anchors the dashboard. People will screenshot it.

---

## 3. Page archetypes — what each major screen FEELS like

### The dashboard (/)

Genre: **magazine cover + table of contents**.

Top: page title in display serif ("Book overview" or "Currently held"), small mono date below.

Hero band: calendar heatmap (signature move #5), 12 weeks visible, with a small "View all" CTA.

Below: three section cards in a row —
1. **Currently held** — top 3 open spreads by capital, with their headline metric and a one-line "current take" pulled from the most recent note
2. **Recent closes** — 3 most recently closed spreads with the postmortem one-liner
3. **Alerts** — orphaned spreads, threshold breaches, anything needing attention

Below those: a stacked equity curve broken down by spread type (real chart, sophisticated).

Below that: the spreads table (or card list), filterable, the same component used on /spreads but pre-filtered to recent.

### The spreads list (/spreads)

Genre: **research archive / ledger**.

Filter bar at top (filter chips with the amber accent on the active saved view).

Then the list itself — toggle between two layouts (designer picks one, we can build both):

**Layout A — Index card grid** (3 cards per row on desktop). Each card looks like an index card:
- Small serial number top-left (`#032`, mono, dim)
- Status pill top-right
- Spread name (serif display 18px)
- Type · variant (Inter 13px, dim)
- The headline metric (serif 32px, color-coded by sign)
- One quoted line from the operator's note (italic serif 13px, single line truncated)
- Date closed (mono 12px, dim)

**Layout B — Editorial table** (single column, dense rows). Each row:
- Serial number (16px mono, dim)
- Spread name (Inter 15px) + type sublabel (Inter 12px dim, second line)
- Headline metric (mono numeric, right-aligned, color-coded)
- Capital · Hold · Net (small mono fields, right-aligned)
- Status pill (right-most column)
- Click → detail page

### The spread detail (/spreads/[id])

See § 2 signature move #3 above. The hero of the whole product. Get this right and you've won.

### Open-spread form (/spreads/new)

Genre: **structured research entry**.

Two-column layout, generous space. Left column: spread mechanics (type, variant, legs, capital). Right column: thesis & intent (target APR, exit plan as free prose textarea with serif type, regime tags, expected holding period).

The "exit plan" textarea uses Source Serif 4 italic — typing the thesis should *feel* like writing in a journal, not filling out a form. That single typography choice changes the whole emotional register of the page.

CTA at the bottom: a single big primary button "Save spread" in amber.

### Post-trade review (/spreads/[id]/review)

Genre: **academic peer review form**.

The 3 questions from `vocabulary.md` § L become three cards stacked vertically:
1. "Was the thesis right?" — left side: target vs realized table. Right side: ✓/✗ buttons + a small prose textarea.
2. "Was execution clean?" — same shape, with per-leg execution table.
3. "Would I do it again?" — operator's note (serif textarea), thumbs ✓/✗, auto-suggested tags.

The page header includes the spread name + serial in serif, like the cover of a graded paper.

---

## 4. The "wow" checklist — every screen

A screen isn't done until **at least 3** of these are true:

1. There's a hero moment — one beautifully-typeset large element you'd screenshot.
2. The serif type appears somewhere meaningful (not just on a tiny date).
3. Color is used with restraint — the signature amber appears exactly once.
4. There's real depth — at least 2 visible elevation layers (page bg → surface → elevated card).
5. The copy has voice — at least one piece of operator language is preserved ("currently held", "postmortem", a quoted note).
6. There's at least one piece of personality — a serial number, a date stamp in a refined treatment, a status indicator that feels deliberate.
7. The numbers feel ALIVE — sign-prefixed, color-coded, tabular, in mono, with appropriate decimal precision per context (`14.0%` not `14%`; `+11.6 bps` not `11.6 bps`; `$47,300.00` not `$47300`).
8. The empty state is **specific to this product** — not "no data yet" but "no spreads in this regime — try expanding the date range" with copywriting that has voice.

If fewer than 3 are true, the screen is forgettable. Revise until it has soul.

---

## 5. The vocabulary upgrade

UI labels with **voice**, not generic SaaS:

| Generic | With voice |
|---|---|
| "Open spreads" | "Currently held" |
| "Closed spreads" | "The archive" |
| "Trade detail" | (just the spread name, big, in serif) |
| "Review" | "Postmortem" |
| "Performance" | "Track record" |
| "Notes" | "Notes & marginalia" |
| "New spread" | "Log a spread" |
| "Filters" | (small caps "Filter by") |
| "Save" | "Commit" (terminal-y but in good way) OR "Save" — pick one |
| "Settings" | "Preferences" |
| "Empty: No spreads yet" | "The book is empty. Connect an exchange to start the archive." |
| "Loading..." | (skeleton; never literal text) |
| "Error: Failed to load" | "Couldn't reach the exchange. Retry?" |

Just enough character to feel human, never enough to feel cute.

---

## 6. The "send this to Claude Design" prompt

After uploading all docs to your Claude Design project, kick off with this:

```
Aesthetic direction: this product is an EDITORIAL JOURNAL for serious 
crypto-spread traders. NOT a dashboard. NOT a terminal. Think hedge 
fund analyst's research note, Financial Times Weekend layout, Lex.page 
+ Reflect.app's editorial polish, with Linear-real-product's refined 
restraint.

Read docs/design-inspiration.md (this is the artistic direction — read 
FIRST), then docs/design-spec.md (technical rules), then 
docs/design-anti-references.md (what to avoid), then 
docs/vocabulary.md, docs/design-fixtures.json, docs/arb-brief.md.

Signature moves (do not skip any of these):
1. Source Serif 4 display weight for hero moments — the page hero 
   metric (72px), spread names on detail pages, section headings 
   (small caps tracked), pull quotes (italic).
2. Distinctive amber accent #b8860b (light) / #d4a017 (dark) — used 
   EXACTLY ONCE per screen on the most important element.
3. Editorial layout for spread detail page — research-note structure 
   (title → hero → thesis → decomposition → execution → postmortem), 
   single column with figures as charts. NOT dashboard panels.
4. Serial numbers (#001, #032) on every spread.
5. Calendar heatmap as the dashboard centerpiece — beautiful gradient 
   tile rendering, hover with depth.

Other rules from design-spec.md:
- Inter for body. JetBrains Mono ONLY for tabular numbers.
- Light mode default, dark mode toggle.
- 8px card radius, real subtle shadows, generous whitespace.
- shadcn/ui primitives + Recharts + Lucide icons.

For THIS prompt, build the spread detail page (the hero of the whole 
product). Use spread_detail_example from docs/design-fixtures.json. 
Render the layout described in docs/design-inspiration.md § 2 
signature move #3 and § 3 "spread detail" archetype.

Show me 3 layout variations — same content, three takes on the 
research-note framing. I'll pick one, then we refine.

Output: React + Tailwind. Next.js 16 + Tailwind v4 stack. CSS variables 
for tokens.
```

Send this FIRST. The detail page is the product's hero. If it lands, the rest follows. If it doesn't, we know exactly what to revise before building anything else.

---

## 7. The final "wow" test

Before declaring any screen done, hold it up against the references:

- Could this screenshot live on Linear.app or Lex.page? → ✓
- Could it be a page in Bloomberg Businessweek? → ✓
- Would the operator screenshot this and share it? → ✓
- Does it look like literally any other crypto/fintech dashboard? → ✗ revise
- Could you tell at 25% zoom that it's our product, not someone else's? → ✓

If you can't tell us apart from Mercury or Brex at 25% zoom, **we haven't earned distinction yet**.

The signature serif + signature amber + editorial layout for detail = the three things that, applied with discipline, will pass the 25%-zoom test. Without them, we're generic.
