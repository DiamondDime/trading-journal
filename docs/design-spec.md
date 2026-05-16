# Design Spec — Crypto Spread Journal

**Audience:** Claude Design (Anthropic Labs) and any designer / design-AI building UI for this project.

**Aesthetic anchor:** Modern fintech-pro. Mercury × Stripe Treasury × Linear (the real product, not the AI-cliché of it) × Plaid Dashboard. "We charge $500/month and you'd pay it." NOT Bloomberg Terminal. NOT "hacker green-on-black."

**How to use:** Upload as persistent project context. Every prompt inherits these rules without re-stating. When output drifts, the spec wins — revise the output, not the spec.

**Last updated:** 2026-05-16 (rev 2 — pivoted away from terminal aesthetic).

---

## 0. The aesthetic in one paragraph

A product trader pays $500/month for. Looks like Mercury's dashboard, not Bloomberg Terminal. Light mode is the default (most operators check the journal during work hours); dark mode is a toggle. Type is **Inter** everywhere except numeric tabular data. Numbers use **JetBrains Mono** only for `$`, `bps`, `%`, `APR`, fills, timestamps, and instrument IDs — never for headings, labels, or prose. Color is sophisticated: a **single distinctive brand teal** (`#0d8a8a`) plus a mature state palette (forest green, fire-engine red, amber, financial blue). Cards have **8px radius** and **subtle 1-line shadows**. Hover states are real. Density comes from disciplined whitespace and typographic hierarchy, not from squinting at 11px text.

**Don't make it look like:**
- A Bloomberg Terminal screenshot from 1995
- Neon green on pure black ("hacker")
- All-caps monospace section labels everywhere (cliché)
- Pure flat 0-radius "brutalist AI dashboard"
- A generic shadcn-with-default-config landing page

**Do make it look like:**
- Mercury (mercury.com) — light bg, subtle elevation, sage accent, Inter throughout, mono only for numbers
- Stripe Treasury dashboard — minimal, blue accent, real polish, real charts
- Linear (the actual product, dark mode) — sophisticated grey palette, Inter, beautiful subtle color
- Plaid Dashboard — developer-grade B2B fintech, properly designed

---

## 1. Color tokens — light + dark mode

Two complete palettes. App ships with a theme toggle; light is default.

### Light mode

```css
/* Surfaces */
--bg-app:           #f7f8fa;   /* page background */
--bg-surface:       #ffffff;   /* cards, tables, panels */
--bg-elevated:      #ffffff;   /* modals, popovers — same as surface but with stronger shadow */
--bg-subtle:        #f2f4f7;   /* hover bg, secondary surface */
--bg-inset:         #f9fafb;   /* inset wells (e.g. code blocks, decomposition rows) */

/* Borders */
--border:           #e5e7eb;   /* default 1px borders */
--border-strong:    #d1d5db;   /* focus rings, active borders */
--border-subtle:    #f0f2f5;   /* internal table dividers */

/* Text */
--text-primary:     #1a1d23;   /* body text, default */
--text-secondary:   #4b5563;   /* secondary text, labels */
--text-tertiary:    #6b7280;   /* metadata, hints */
--text-disabled:    #9ca3af;   /* disabled inputs, placeholders */

/* Accents — mature, with a signature */
--accent-signature: #b8860b;   /* SIGNATURE amber/old-gold. Use EXACTLY ONCE per screen on the most important element. See design-inspiration.md § 2.2. */
--accent-signature-bg: #fdf6e3; /* signature tint for the rare amber pill */
--accent-brand:     #0d8a8a;   /* Secondary brand — teal. Used for category, info chips, primary CTA. */
--accent-brand-bg:  #e6f4f4;
--accent-up:        #16a34a;   /* positive PnL — forest green, not matrix green */
--accent-up-bg:     #ecfdf5;
--accent-down:      #dc2626;   /* negative PnL — fire-engine red */
--accent-down-bg:   #fef2f2;
--accent-warn:      #d97706;   /* warning state (winding_down, threshold breach) — amber */
--accent-warn-bg:   #fffbeb;
--accent-info:      #2563eb;   /* financial-blue for informational accents */
--accent-info-bg:   #eff6ff;
```

### Dark mode

```css
/* Surfaces */
--bg-app:           #0d1117;   /* page background — GitHub-dark proven premium */
--bg-surface:       #161b22;   /* cards, tables, panels */
--bg-elevated:      #1c2128;   /* modals, popovers */
--bg-subtle:        #21262d;   /* hover bg */
--bg-inset:         #0d1117;   /* inset wells */

/* Borders */
--border:           #30363d;
--border-strong:    #484f58;
--border-subtle:    #21262d;

/* Text */
--text-primary:     #f0f3f7;
--text-secondary:   #c9d1d9;
--text-tertiary:    #8b949e;
--text-disabled:    #6e7681;

/* Accents — slightly brighter than light-mode for contrast */
--accent-signature: #d4a017;   /* SIGNATURE amber — calibrated brighter for dark bg */
--accent-signature-bg: rgba(212, 160, 23, 0.12);
--accent-brand:     #2dd4bf;   /* teal — lighter for dark mode */
--accent-brand-bg:  rgba(45, 212, 191, 0.12);
--accent-up:        #3fb950;   /* GitHub-success green */
--accent-up-bg:     rgba(63, 185, 80, 0.15);
--accent-down:      #f85149;   /* GitHub-danger red */
--accent-down-bg:   rgba(248, 81, 73, 0.15);
--accent-warn:      #fb923c;
--accent-warn-bg:   rgba(251, 146, 60, 0.15);
--accent-info:      #58a6ff;
--accent-info-bg:   rgba(88, 166, 255, 0.15);
```

**Color rules:**
- **`--accent-brand`** is the visual signature. Use it for the primary CTA, the brand mark in the header, and the *most important* metric on a screen (the headline KPI on the dashboard). Used sparingly — once or twice per screen.
- **State colors** (up / down / warn / info) only convey state — never decoration.
- **Numbers**: `+ve` uses `--accent-up`, `-ve` uses `--accent-down`. Always the full color on the number itself, no background fill.
- **Status chips/tags** use the `*-bg` tinted backgrounds with the foreground color — a real pill, not bare text. (Reversal from the previous spec which banned pills.)
- **Brand teal** is rare in fintech. Stripe = purple, Mercury = sage, Brex = orange, Ramp = yellow. Teal at #0d8a8a is a distinctive signature. Use it deliberately.

---

## 2. Typography — three-typeface system

The signature move. **Source Serif 4 for editorial display + Inter for body + JetBrains Mono for numbers.** See `docs/design-inspiration.md` § 2 signature move #1.

```css
--font-serif: 'Source Serif 4', 'IBM Plex Serif', 'Georgia', 'Times New Roman', serif;
--font-sans:  'Inter', 'SF Pro Text', -apple-system, system-ui, sans-serif;
--font-mono:  'JetBrains Mono', 'SF Mono', 'Menlo', ui-monospace, monospace;
```

Import in HTML head (Claude Design needs explicit links):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### Font-usage rules — strict

- **Serif** (`--font-serif`) — editorial display only:
  - Page hero metric on the spread detail page (72px, the centerpiece)
  - Spread name on the detail page (36-44px)
  - Spread name on list-view index cards (18-22px)
  - Pull quotes from operator notes (italic, 18-20px)
  - Display headings on the dashboard ("Book overview", "The archive")
  - "THESIS / DECOMPOSITION / EXECUTION / POSTMORTEM" section labels (small caps tracked, 12px, weight 500)
  - **Never** on buttons, form labels, table headers, navigation, body prose

- **Sans** (`--font-sans`, Inter) — the default:
  - Body text, table cells, form inputs, buttons, navigation, labels, sentence-case section headings
  - Anything not explicitly serif or mono

- **Mono** (`--font-mono`) — tabular numbers only:
  - Currency: `$47,300.00`
  - Basis points: `+11.6 bps`
  - APR/percentage: `14.0%`
  - Instrument tickers in tables: `BTC-PERP`
  - Precise timestamps when shown: `2026-03-28T08:14:22Z`
  - Serial numbers: `#032`
  - **Never** on button labels, page titles, prose

### Type scale

| Token | Size / Line-height | Family · Weight | Use |
|---|---|---|---|
| `serif-hero`     | 72px / 80px | Source Serif 4 · 400 | THE spread-detail hero metric. Once per page max. |
| `serif-display`  | 44px / 52px | Source Serif 4 · 500 | Spread name on detail page; dashboard hero title |
| `serif-h1`       | 32px / 40px | Source Serif 4 · 500 | Page titles ("Book overview", "The archive") |
| `serif-h2`       | 22px / 32px | Source Serif 4 · 500 | Detail-page subsection titles ("Postmortem") |
| `serif-card`     | 20px / 28px | Source Serif 4 · 500 | Spread name on list-view index cards |
| `serif-quote`    | 18px / 28px | Source Serif 4 italic · 400 | Pull quotes from operator notes |
| `serif-section`  | 12px / 16px | Source Serif 4 · 500 + small-caps + 0.08em tracking | "THESIS / EXECUTION" section labels |
| `text-h1`        | 24px / 32px | Inter · 600 | Generic page titles (forms, settings) |
| `text-h2`        | 18px / 28px | Inter · 600 | Section headings in tables, lists |
| `text-h3`        | 16px / 24px | Inter · 500 | Subsection headings |
| `text-body-lg`   | 16px / 24px | Inter · 400 | Lede paragraphs, key descriptions |
| `text-body`      | 14px / 22px | Inter · 400 | Default body, table cells, form inputs |
| `text-small`     | 13px / 20px | Inter · 400 | Secondary text, metadata, helper text |
| `text-xs`        | 12px / 16px | Inter · 500 | Labels, chip text, badge text |
| `num-hero`       | 72px / 80px | Source Serif 4 · 400 (signature amber) | Spread-detail hero — pair with `serif-hero` |
| `num-display`    | 36px / 44px | JetBrains Mono · 500 | Detail-page numeric stats (decomposition totals) |
| `num-card`       | 32px / 40px | Source Serif 4 · 400 | Card-headline metric on list view (when in serif treatment) |
| `num-headline`   | 18px / 24px | JetBrains Mono · 500 | Table-headline metric / inline stats |
| `num-body`       | 14px / 22px | JetBrains Mono · 400 | Table numeric cells |
| `num-small`      | 13px / 20px | JetBrains Mono · 400 | Inline numeric (in prose) |
| `num-tiny`       | 12px / 16px | JetBrains Mono · 400 | Serial numbers, fine print |

**The hero metric is the ONE design element that separates us from every dashboard ever made.** It's a serif numeral, not a mono numeral. 72px Source Serif 4 in signature amber. Render `+14.0%` like an FT Weekend front-page stat — display weight, serif body, with the unit (`APR`) inset slightly smaller. That single typographic choice does 40% of the work of making the product feel premium.

**Body text is 14px** (not 11–13px squint-mode). Density comes from hierarchy + whitespace discipline, not from miniaturization.

**Section labels are sentence-case Inter medium, not all-caps mono.** "Open spreads" — not "OPEN SPREADS".

---

## 3. Spacing — generous but disciplined

```css
--space-1:  4px;
--space-2:  8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
```

**Component spacing:**
- Card internal padding: `24px` (`--space-6`)
- Card-to-card vertical gap: `16px` in a list, `24px` between sections
- Section vertical rhythm: `48px` between major regions, `32px` between subsections
- Page padding: `32–48px` left/right, `24px` top
- Form input height: `40px`
- Button height: `36px` (default), `32px` (compact), `44px` (large/primary on landing)
- Table row height: `48px` (header `44px`)

**Whitespace is a feature, not waste.** Generous breathing room signals "premium B2B," cramped signals "AI generic."

---

## 4. Radius, borders, shadows

```css
--radius-sm:  4px;    /* inline tags, badges */
--radius:     6px;    /* buttons, form inputs */
--radius-lg:  8px;    /* cards, panels, modals */
--radius-xl: 12px;    /* hero / feature cards (rare) */

--shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.04);                /* card resting (light) */
--shadow-md:  0 1px 3px rgba(0, 0, 0, 0.08),
              0 1px 2px rgba(0, 0, 0, 0.04);                /* card hover (light) */
--shadow-lg:  0 4px 12px rgba(0, 0, 0, 0.08),
              0 2px 4px rgba(0, 0, 0, 0.04);                /* modal, popover */
--shadow-xl:  0 8px 32px rgba(0, 0, 0, 0.12);               /* full-screen modal */

/* Dark mode shadows — almost imperceptible; use border-strong for elevation */
.dark {
  --shadow-sm: 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-md: 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.04);
  --shadow-lg: 0 4px 12px rgba(0, 0, 0, 0.32);
  --shadow-xl: 0 8px 32px rgba(0, 0, 0, 0.48);
}
```

**Rules:**
- **Cards**: 8px radius, subtle shadow, 1px border in light-mode (`--border`), no border in dark-mode (shadow + bg-tone shift provides elevation).
- **Buttons**: 6px radius.
- **Form inputs**: 6px radius.
- **Badges/chips**: full-rounded for status indicators, 4px for category tags.
- **Focus rings**: `box-shadow: 0 0 0 3px var(--accent-brand-bg)` + `border-color: var(--accent-brand)`. Real focus state, accessibility-required.
- **Hover transitions**: `transition: all 150ms ease`. Real motion, not jarring.

---

## 5. Component rules

### 5.1 Button

```
Primary:    bg: var(--accent-brand); color: white; weight 500; 6px radius;
            hover: opacity 0.9 + shadow-sm; active: opacity 0.85.
Secondary:  bg: var(--bg-surface); color: var(--text-primary); 
            border: 1px solid var(--border); 6px radius;
            hover: bg: var(--bg-subtle); border: var(--border-strong).
Ghost:      bg: transparent; color: var(--text-primary); no border;
            hover: bg: var(--bg-subtle).
Danger:     bg: var(--accent-down); color: white; same shape as primary.
Link:       color: var(--accent-brand); no border, no bg; underline on hover.
Disabled:   opacity 0.5; cursor: not-allowed; no hover.
```

Icons in buttons OK (Lucide icon set, 16px, left of text, `--space-2` gap).

### 5.2 Status badge

Now a real pill with bg tint + bold foreground, not bare text. Use the `*-bg` color tokens.

```
candidate     → bg: var(--bg-subtle);          fg: var(--text-secondary)
rejected      → bg: var(--bg-subtle);          fg: var(--text-tertiary)
open          → bg: var(--accent-up-bg);       fg: var(--accent-up)
winding_down  → bg: var(--accent-warn-bg);     fg: var(--accent-warn)
orphaned      → bg: var(--accent-down-bg);     fg: var(--accent-down)
                + pulse animation on the bg every 2s (live alert)
                + bullet prefix: •
expired       → bg: var(--bg-subtle);          fg: var(--text-secondary)
closed        → bg: var(--bg-subtle);          fg: var(--text-secondary)
```

Badge sizing: `12px` Inter medium text, `4px 10px` padding, full-rounded.

### 5.3 Table

- Header row: 13px Inter 500, `--text-tertiary`, sentence-case (NOT all-caps). Bottom border 1px `--border`.
- Body rows: 48px tall, 14px Inter 400, alternating row hover (no zebra). Row hover bg: `--bg-subtle`.
- Numeric columns: right-aligned, `--font-mono` 14px tabular-nums, sign-prefixed for PnL with proper minus character `U+2212`.
- Selected row: left border 3px `--accent-brand`, bg `--accent-brand-bg`.
- Sticky header on scroll.
- Sortable column headers: chevron icon on hover, full icon when sorted.

### 5.4 Card

```
Default card:
- bg: var(--bg-surface)
- border: 1px solid var(--border) (light only; dark uses shadow)
- border-radius: var(--radius-lg) [8px]
- padding: var(--space-6) [24px]
- shadow: var(--shadow-sm)
- transition: 150ms

Hover (when clickable):
- shadow: var(--shadow-md)
- border-color: var(--border-strong)
- cursor: pointer
```

**Spread card layout** (in the list view):

```
┌──────────────────────────────────────────────────────────────┐
│ [● open]              BTC cash-carry · Bitmex+Coinbase       │  ← header: status pill + name
│                                                              │
│                                                +14.0% APR    │  ← headline (num-headline, color-coded, right-aligned)
│                                                              │
│ ──────────────────────────────────────────────────────────   │  ← divider (1px border)
│                                                              │
│ Capital      Hold      Funding $/day    Liq buffer           │  ← labels (text-xs, --text-tertiary)
│ $47,300.00   73 days   $19.03           58%                  │  ← values (num-body)
└──────────────────────────────────────────────────────────────┘
```

Card-on-card forbidden. Nested data uses dividers + indented sections.

### 5.5 Stat (labeled number primitive)

```
┌──────────────────────┐
│ Net PnL              │  ← label: text-xs, --text-tertiary, sentence-case
│ +$1,314.40           │  ← value: num-display, color-coded by sign
│ ↑ 14.0% target       │  ← optional delta: text-small, --accent-up/--accent-down
└──────────────────────┘
```

Used in: dashboard hero row, spread detail page hero row, post-trade review thesis-delta cards.

### 5.6 Filter bar

Horizontal row, sticky on scroll, `bg: var(--bg-surface)`, bottom border.

- Saved-view dropdown on far left (with brand-color accent on the active view).
- Filter chips inline: `bg: var(--accent-brand-bg)`, `fg: var(--accent-brand)`, `×` to remove.
- Empty filter slots: ghost button "+ Add filter".
- Sort dropdown on far right.
- Search input far right of that, with `Cmd+K` keyboard hint.

### 5.7 Chart

Use **Recharts** (or Visx). Real charts, not stripped-down ASCII art.

- Background: `--bg-surface`. Subtle grid lines `--border-subtle`.
- Axes: 12px Inter, `--text-tertiary`.
- Lines: 2px stroke, `--accent-brand` for default series, `--accent-up`/`--accent-down` when up/down semantics apply.
- Area fills: 10% opacity of the line color (light mode) or 15% (dark mode). Subtle, not hero.
- Bars (funding events): `--accent-up` for received, `--accent-down` for paid, 2px gap.
- Tooltip on hover: `bg: var(--bg-elevated)`, 8px radius, shadow-lg, 12px padding. Shows date + all series values.
- Animation: 300ms ease-out on initial render, no animation on hover.

### 5.8 Form input

- Height 40px, `bg: var(--bg-surface)`, 1px border `--border`, 6px radius.
- Label above input: `text-xs` Inter 500, `--text-secondary`, `--space-2` gap below to input.
- Focus: `box-shadow: 0 0 0 3px var(--accent-brand-bg)`, `border-color: var(--accent-brand)`.
- Helper text below: `text-small`, `--text-tertiary`.
- Error: `border-color: var(--accent-down)`, helper text `--accent-down`, error icon prefix in input.
- Disabled: `bg: var(--bg-subtle)`, `cursor: not-allowed`.

---

## 6. Component library recommendation

**Use shadcn/ui** as the primitive base. It's Tailwind-native, matches this aesthetic out of the box, and Claude Design recognizes the patterns. Then apply our token overrides via CSS variables.

Specifically:
- `Button`, `Input`, `Select`, `Dialog`, `Tabs`, `Card`, `Badge`, `DropdownMenu`, `Table`, `Tooltip`, `Toast` — all shadcn defaults
- Override the CSS variables in `globals.css` to match our palette
- Custom components (SpreadCard, DecompositionBar, FundingChart) compose the shadcn primitives

**For charts**: Recharts. For icons: Lucide (16px in body, 20px in headers/buttons).

---

## 7. State coverage — every screen must include

1. **Default state** — populated with realistic data (`docs/design-fixtures.json`)
2. **Empty state** — single illustration is OK if subtle and on-brand (a faded brand-color icon, 64px max), single line of text, and a CTA. Not a generic "no data 📊" — something specific: *"No spreads yet. Connect an exchange to start tracking."*
3. **Loading state** — skeleton screens (animated shimmer at 1.5s loop) matching the layout of the loaded content. No spinners except for in-place button loading.
4. **Error state** — toast notification + inline error message with retry CTA. Red accent, not red-everywhere.
5. **Long-text overflow** — graceful truncation with tooltip on hover for full text.
6. **Alert variant** — for cards: the orphaned-status variant has a left-border 3px `--accent-down`, the pulse-bg badge, and an inline "Resolve" CTA.

---

## 8. What to steal from TradeZella

TradeZella has competent UX patterns wrapped in a too-consumer skin. Adopt the *patterns*, re-skin in the modern-fintech aesthetic.

1. **Calendar heatmap** of daily PnL — 7×N grid, brand-color saturation for positive intensity, red saturation for negative. Click a day → list of spreads.
2. **Per-spread detail page = "research note"** — timeline of legs, embedded notes, attached images, tags. Treat as a document, not a dashboard panel.
3. **Tag taxonomy** (setups / emotions / mistakes) → maps to our `regime_tags` + `custom_tags`. Show as text-only chips with subtle bg tint.
4. **Strategy templates** at trade-open — operator picks a template ("BTC cash-carry funding-version"), pre-fills the open-intent fields. v2.
5. **Multi-account dashboard switcher** → our multi-exchange filter.

Skip:
- Their purple/teal/pink consumer palette — we use teal but at #0d8a8a (deep + sophisticated, not light + bubbly).
- Win-rate as headline KPI — Simpson's paradox, see `vocabulary.md` § 4.
- Equity-curve as one line — use decomposition.
- Gamification, achievements, streaks.

## 9. What to steal from TraderMakeMoney

1. **Risk-management violation indicator** — small ⚠ chip in the row when a spread breached `slippage_tolerance_bps` / `close_threshold_apr` / `max_gas_budget_usd`. Click for details.
2. **Sticky filter state** across navigations — maps to our `saved_views`.
3. **Hedge-mode tag** on connections supporting it (Bybit).

---

## 10. References — the actual mood board

**Top tier (study these closely):**
- **Mercury** (mercury.com) — the closest aesthetic match. Light bg, sage accent, Inter, mono numbers, real shadows, generous space.
- **Stripe Treasury / Stripe Atlas dashboards** (NOT the marketing site) — minimal, blue accent, real polish.
- **Linear** (linear.app) the actual product, dark mode — sophisticated grey palette, Inter, beautiful subtle color.
- **Plaid Dashboard** — B2B fintech done right.
- **Ramp** dashboards — slightly more colorful but still mature.
- **Brex Cash** dashboard — institutional, dense-but-readable.

**Useful secondary:**
- **Carta** — equity management, polished tables and charts.
- **Pilot.com** — bookkeeping for startups, very Mercury-adjacent.
- **GitHub Projects** (the new ones, not the old issues) — clean dark mode B2B.
- **Vercel Dashboard** (yes, despite the anti-ref earlier — the *recent* Vercel dashboard is actually great fintech-pro). Borrow the spacing, skip the purple.

**Skip / avoid:**
- ~~Bloomberg Terminal~~ — we're not building a terminal.
- ~~IBKR TWS~~ — old-school dense, wrong genre.
- TradeZella marketing site (the *app* is fine to learn from).
- DeFiLlama, Dune, OpenSea, Magic Eden — Web3 marketing aesthetic.
- Default shadcn-with-no-customization landing pages — too generic.
- Stripe Dashboard the *marketing demo* (not the actual logged-in dashboard) — too consumer-friendly.

---

## 11. Prompt templates

### 11.1 First-prompt (set up project)

```
Project: crypto-spread-journal — a premium private trading journal for
spread-specialist crypto traders. Multi-leg trades are the atomic unit.

Aesthetic: Modern fintech-pro. Like Mercury × Stripe Treasury × Linear.
A product traders pay $500/month for. Light theme default, dark mode
toggle. Inter for all text. JetBrains Mono ONLY for numeric values
(prices, bps, APR, %, $, timestamps, instrument tickers). 8px card
radius, subtle shadows, mature color palette.

Brand color: #0d8a8a teal (light) / #2dd4bf (dark). Use sparingly — it
is the visual signature. State colors are forest green (#16a34a) for
positive PnL, fire-engine red (#dc2626) for negative, amber (#d97706)
for warnings, financial blue (#2563eb) for info.

Read these docs uploaded to this project:
- docs/design-spec.md  (this file — tokens, components, rules)
- docs/design-anti-references.md  (what to avoid)
- docs/vocabulary.md  (state machine, metric definitions, headline-per-type)
- docs/design-fixtures.json  (realistic sample data — use as placeholder)
- docs/arb-brief.md  (domain primer)

Component library: shadcn/ui primitives + Recharts for charts +
Lucide icons (16px in body, 20px in headers).

Anti-references: do NOT design like Bloomberg Terminal, do NOT use
matrix-green on pure black, do NOT use all-caps mono section labels,
do NOT use 0-radius brutalist styling, do NOT use 11-13px squint text.
This is not a terminal. It's a premium fintech product.

Output format: React + Tailwind components matching Next.js 16 +
Tailwind v4. Use CSS variables for tokens (never hard-coded hex in
components). Every screen must include default / empty / loading /
error / overflow states.
```

### 11.2 Per-screen prompt

```
Build the [spread list page / detail page / open-spread form / etc.].

Use the design spec and shadcn/ui primitives already loaded. Pull
placeholder data from docs/design-fixtures.json — use the specific
indices [list them].

Aesthetic anchor for this screen: [Mercury accounts list / Stripe
Treasury transactions / Linear issue detail / etc.]. Light mode primary,
dark mode toggle visible.

Required states: default, empty, loading, error.

Show me 3 directional variations before refining the chosen one. Each
variation should explore a different LAYOUT approach (table vs cards,
sidebar vs top-nav, single-column vs split-pane), not a different
COLOR scheme — colors are locked.
```

### 11.3 Adversarial revise

```
Critique this design against the spec. Specifically:

1. Is body text Inter 14px (not mono, not 11-13px)?
2. Is JetBrains Mono used ONLY for numbers (not for labels, buttons, 
   headings)?
3. Is the background a sophisticated grey (#f7f8fa light / #0d1117 
   dark), NOT pure black or pure white?
4. Are accent colors mature (#0d8a8a teal, #16a34a green, #dc2626 red), 
   NOT neon (#00ff88, #ff3b30, hot pink)?
5. Do cards have 8px radius and subtle shadows (not 0-radius flat)?
6. Are section headings sentence-case Inter medium, NOT all-caps mono?
7. Is the brand teal used sparingly (1-2 places), not on every element?
8. Are there real hover states (bg shift + shadow upgrade)?
9. Are status badges proper pills with bg tint, not bare colored text?
10. Is the headline metric switching on card_headline_format string, 
    not on spread_type?
11. Is notional shown anywhere? (It must not be.)

Revise to fix every "no" answer. Don't change anything correct.
```

---

## 12. Handoff to Claude Code (me)

Export each component as a `.tsx` file. Drop it into `src/components/`. Send me the file path or paste the code. I'll:

- Validate prop types against `canonical.ts` (`SpreadPnl`, `Spread`, etc.)
- Replace fixture data with real API calls
- Wire to `/api/spreads`, `/api/spreads/[id]`
- Flag backend gaps
- Install any missing shadcn primitives via `pnpm dlx shadcn@latest add <component>`

We commit per-screen, not per-app. History is preserved.
