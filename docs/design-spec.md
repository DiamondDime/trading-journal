# Design Spec — Crypto Spread Journal

**Audience:** Claude Design (Anthropic Labs web product) + any designer / design-AI building the UI for this project.

**How to use:** Upload this file as persistent context in your Claude Design project. Every prompt then inherits these tokens and rules without you re-stating them. When the output drifts from this spec, the spec wins — update the output, not the spec.

**Last updated:** 2026-05-16.

---

## 0. North-star aesthetic

> **Bloomberg Terminal × Linear × Hyperdash, not Stripe Dashboard or TradeZella's marketing site.**

Dense, monochrome, monospace numbers, color used only to convey state (green up, red down, yellow warn). Zero decoration: no shadows, no rounded corners, no gradients, no emoji, no illustrations. The trader's eye must land on the *number* first, the *label* second, the chrome third.

This is a **professional tool for someone who already understands the domain**. We do not onboard them, we do not show tutorials, we do not soften the data with friendly copy. Friction-free density beats hand-holding.

---

## 1. Color tokens

All colors are semantic — never named by hue. The tokens drive everything; no raw hex in components.

```css
--color-bg:                 #0a0a0a;   /* page background */
--color-surface:            #141414;   /* card / row hover background */
--color-surface-elevated:   #1a1a1a;   /* modal / popover background */
--color-border:             #2a2a2a;   /* all separators (1px) */
--color-border-strong:      #3a3a3a;   /* focus rings, active borders */

--color-text:               #e8e8e8;   /* primary text */
--color-text-dim:           #888888;   /* secondary text, labels */
--color-text-faint:         #666666;   /* placeholder, disabled */

--color-accent-up:          #00ff88;   /* positive PnL, "open" status, success */
--color-accent-down:        #ff3b30;   /* negative PnL, "orphaned" status, error */
--color-accent-warn:        #ffaa00;   /* "winding_down" status, threshold breach */
--color-accent-info:        #5ac8fa;   /* informational accent (rare) */

--color-accent-up-dim:      rgba(0, 255, 136, 0.15);   /* up tag background tint */
--color-accent-down-dim:    rgba(255, 59, 48, 0.15);   /* down tag background tint */
--color-accent-warn-dim:    rgba(255, 170, 0, 0.15);   /* warn tag background tint */
```

**Color rules — strict:**
- Decorative color is forbidden. Every chromatic pixel conveys state.
- Numbers use `--color-accent-up` if `value >= 0`, `--color-accent-down` if `value < 0`. Never both.
- Status badges use accent colors as **text color**, never as solid pill background. (Tint backgrounds via the `-dim` variants are OK at low opacity for emphasis only.)
- The `--color-accent-info` exists for "neutral signal" (e.g., information tooltip) and is rarely used.
- No purple, no teal, no pink — those signal "consumer SaaS" and break the aesthetic.

---

## 2. Typography

```css
--font-mono:    'JetBrains Mono', 'Menlo', 'Consolas', ui-monospace, monospace;
--font-sans:    'Inter', 'SF Pro Text', -apple-system, system-ui, sans-serif;
```

Imports (must be in HTML head — Claude Design needs explicit links or it will fall back to its defaults):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

**Font-usage rules — strict:**
- **All numbers, all instrument symbols, all UUIDs, all timestamps** use `--font-mono` with `font-variant-numeric: tabular-nums`. Always.
- **Prose, labels, body text** use `--font-sans`.
- **Section headings** use `--font-mono` uppercase, letter-spaced.
- **No serifs anywhere.**
- Never mix two weights of mono in the same row — use 400 for normal, 600 for the headline metric only.

### Type scale

| Token | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `text-headline` | 24px | 32px | 600 | Spread detail page hero metric |
| `text-h1` | 16px | 24px | 500 | Page titles |
| `text-h2` | 13px | 20px | 500 | Section labels (`SPREADS`, `FILTERS`) — uppercase, letter-spacing 0.08em |
| `text-body` | 13px | 20px | 400 | Tables, default text |
| `text-small` | 11px | 16px | 400 | Helper text, hints, metadata |
| `text-tiny` | 10px | 14px | 500 | Badge text — uppercase, letter-spacing 0.06em |

13px / 11px is small on purpose. Density is the point. If a reviewer asks for "bigger text," push back.

---

## 3. Spacing

```css
--space-1:  4px;   /* tight icon gap */
--space-2:  8px;   /* default inline gap, badge padding */
--space-3: 12px;   /* table cell padding-y */
--space-4: 16px;   /* card internal padding */
--space-5: 24px;   /* between sections */
--space-6: 32px;   /* between major regions */
--space-8: 48px;   /* page-level vertical rhythm */
```

**Spacing rules:**
- 8px grid. No arbitrary values.
- Table row height: 32px. Header row 28px. (Compactness over comfort.)
- Card internal padding: 16px (`--space-4`).
- Between two cards / sections: 24px (`--space-5`).
- Form input height: 32px.
- Button height: 28px (compact) or 32px (default). Never larger.

---

## 4. Borders, corners, shadows

```css
--radius: 0;                              /* every component, every state */
--border-width: 1px;
--border-style: solid;
--shadow-none: none;                      /* the only valid shadow */
```

**Rules — strict:**
- `border-radius: 0` on every element. No exceptions. No "softening" with `2px`.
- All separators are `1px solid var(--color-border)`.
- **No box-shadows anywhere.** Elevation is conveyed by border color (use `--color-border-strong` for active/focused states) and background color (`--color-surface` for hover, `--color-surface-elevated` for popovers).
- Focus rings: `outline: 1px solid var(--color-border-strong); outline-offset: 1px`. No glow, no halo.

---

## 5. Component rules

### 5.1 Button

```
[Default]    bg: transparent; border: 1px solid var(--color-border); color: var(--color-text); padding: 0 var(--space-3); height: 28px; font-mono, 11px, uppercase, letter-spacing 0.06em.
[Hover]      bg: var(--color-surface); border: 1px solid var(--color-border-strong).
[Active]     bg: var(--color-text); color: var(--color-bg). (Invert.)
[Disabled]   color: var(--color-text-faint); cursor: not-allowed.
[Primary]    bg: var(--color-accent-up); color: var(--color-bg); no border. Used sparingly — only for the single most important action on a page.
[Danger]     border: 1px solid var(--color-accent-down); color: var(--color-accent-down).
```

No icon-only buttons except in a toolbar. Text labels always.

### 5.2 Status badge

Text-only badge, color = state. Uppercase, 10px, letter-spacing 0.06em, font-weight 500.

```
candidate     → color: var(--color-text-dim)
rejected      → color: var(--color-text-faint)
open          → color: var(--color-accent-up)
winding_down  → color: var(--color-accent-warn)
orphaned      → color: var(--color-accent-down); PLUS a 1px outline in same color; PLUS a small dot (•) prefix
expired       → color: var(--color-text-dim)
closed        → color: var(--color-text-dim)
```

`orphaned` is the only state with non-text emphasis (the outline + dot) because it's an alert that demands operator action — see `docs/vocabulary.md` § 3.

### 5.3 Table

- Header row: `var(--font-mono)`, 10px, uppercase, letter-spacing 0.08em, color `--color-text-dim`, border-bottom `1px solid var(--color-border)`.
- Body rows: 32px tall, border-bottom `1px solid var(--color-surface)` (subtle separator, not the strong border).
- Row hover: `bg: var(--color-surface)`.
- Numeric columns: right-aligned, `font-variant-numeric: tabular-nums`, sign-prefixed for PnL.
- Text columns: left-aligned, truncate with ellipsis after column width.
- Zebra striping: **off**. Use the row hover for "where am I" feedback.

### 5.4 Card (spread card)

- `bg: var(--color-bg)`, `border: 1px solid var(--color-border)`, `padding: var(--space-4)`, `border-radius: 0`.
- 6 fields max per spread-list card; see `docs/vocabulary.md` § 5 for what each spread type shows.
- Card layout:

```
┌────────────────────────────────────────────────────────────────┐
│ [STATUS BADGE]                              [HEADLINE METRIC]  │  ← top row
│                                                                │
│ Spread name                              ⟶                     │  ← name + click hint
│ Type · variant                                                 │  ← type identifier
│                                                                │
│ field1: value1   field2: value2   field3: value3   field4: …   │  ← detail row
└────────────────────────────────────────────────────────────────┘
```

- Headline metric: 16px mono 600. Color-coded by sign. Right-aligned at the top-right.
- Status badge: top-left, see § 5.2.
- Click target: entire card. Hover: `bg: var(--color-surface)`, cursor: pointer.
- Card-on-card: never nest cards. Use spacing instead.

### 5.5 Stat (single number with label)

```
┌─────────────────────┐
│ LABEL (uppercase    │  ← text-tiny, color-text-dim
│  10px, dim)         │
│ 14.0%               │  ← text-headline, color-coded
└─────────────────────┘
```

Used on the spread detail page hero, and in the post-trade review thesis-delta table.

### 5.6 Filter bar

A horizontal row of segmented controls and select dropdowns. Always above the data, sticky on scroll.

- Each filter: 28px tall, 1px border, label inline (`status: open ✕`), close button removes the filter.
- "Saved view" dropdown on the right: select a preset (`Funding captures Q1`, `Orphaned alerts`, `Open positions`, …).
- Sort control: separate from filters, sits to the right of the saved-view dropdown.

### 5.7 Chart — line / bar / stacked-bar

- Background: `var(--color-bg)`. No grid lines except faint horizontal at 1/4 / 1/2 / 3/4 / 1 in `var(--color-surface)` (barely visible).
- Axis labels: `font-mono`, 10px, `var(--color-text-dim)`.
- Line: 1px solid in `--color-accent-up` or `--color-accent-down` depending on the trend direction.
- Bars (funding events): `var(--color-accent-up)` for received, `var(--color-accent-down)` for paid. 1px gap between bars.
- Stacked-bar (PnL decomposition): each component gets a different color (funding=up-green, basis=info-cyan, fees=down-red, total=text-white). Component labels rendered on the right side of the bar, never inside it.
- No fill area under lines (that's a TradingView convention; we don't need it).
- No animations longer than 150ms.

### 5.8 Form input

- Height 32px, `bg: var(--color-bg)`, `border: 1px solid var(--color-border)`.
- Focus: `border-color: var(--color-border-strong)`. No glow.
- Label above the input, `text-tiny`, uppercase, `color-text-dim`.
- Helper text below in `text-small`, `color-text-faint`.
- Error: border `var(--color-accent-down)`, helper text `var(--color-accent-down)`.

---

## 6. Density rules (the trading-terminal vibe)

- **A page should show as much data as legibly possible.** If the comp looks "spacious," it's wrong. Compact > airy.
- **Tabular numbers, sign-prefixed.** `+11.6 bps` not `11.6 bps`. `−59 bps` not `-59 bps` (use the proper minus sign character U+2212).
- **Right-align all numeric columns.** Left-align text columns. Center nothing — center alignment in tables hides the data structure.
- **Truncate with ellipsis at column boundaries.** Don't wrap text in cells.
- **No icons in body cells.** Icons only in toolbars / headers.
- **Never use bold to "highlight" a row.** Use color or a left-border accent instead.

---

## 7. State coverage — every screen must include

Before any screen is "done," all of these must be designed:

1. **Default state** — populated with realistic data (use `docs/design-fixtures.json`)
2. **Empty state** — zero data: a single line of text, no illustration. e.g., `"No spreads yet. Connect an exchange via POST /api/exchanges."`
3. **Loading state** — skeleton rows (greyed-out 1px lines, same height as real content). No spinners.
4. **Error state** — single line, red, with a "retry" button: `"Failed to load spreads. [Retry]"`
5. **Long-text overflow** — what happens when `name` is 80 characters
6. **Orphaned/alert variant** — for spread cards, the red-outlined version when `status = 'orphaned'`

---

## 8. What to steal from TradeZella

TradeZella is your direct competitor. Some of its patterns are excellent for a journal. Use them, but **strip the consumer aesthetic** (purple/teal palette, rounded cards, generous spacing, illustrations) and re-skin them in the monochrome dense style above.

**Patterns to steal:**

1. **Calendar heatmap** of daily PnL. A 7×N grid of small squares, color = net PnL intensity for that day (green up, red down, dim grey for no trades). Click a day → list of spreads closed that day. Excellent at-a-glance "how was last month."
2. **Per-spread detail page with attached notes + screenshots.** The detail page is the journal's "single source of truth" for any one trade. TradeZella does this well: timeline of legs, embedded notes, attached images, tags. Adopt the layout, lose the bubbly chat-style note presentation.
3. **Custom-tag taxonomy.** TradeZella lets users tag trades with setups / emotions / mistakes. Map directly to our `regime_tags` (market state) and `custom_tags` (freeform). Show tags as text-only badges (see § 5.2), not colored pills.
4. **Strategy / playbook templates** at trade-open. Operator picks a template ("BTC cash-carry funding-version"), pre-fills `target_apr_at_open`, `expected_holding_days`, `exit_plan`. Defer to v2 but design the form to anticipate it.
5. **Multi-account dashboard switcher**. Our analog: multi-exchange filter. Top-of-page persistent switcher: `All exchanges ▼` or `Binance + Bybit ▼`.

**Patterns to skip from TradeZella:**

- Their primary palette (purple/teal/pink) — too consumer.
- Their headline win-rate KPI — Simpson's paradox per our brief.
- Their equity-curve-as-one-line — anti-pattern per our brief. Use stacked-by-spread-type instead.
- Chart screenshots as primary data. We're API-driven; embedded TradingView charts are v2.
- Onboarding tour, gamification, achievements. Not a thing here.

---

## 9. What to steal from TraderMakeMoney

TraderMakeMoney is closer to us — already crypto-native. Adopt:

1. **Risk-management violation indicator** — small yellow triangle (▲) in the row when a spread breached its `slippage_tolerance_bps` / `close_threshold_apr` / `max_gas_budget_usd`. Single visual cue, no popup, click for details.
2. **Sticky filter state across navigations** — when the user returns to `/spreads`, their last filter set is restored. Map to our `saved_views` table.
3. **Hedge-mode awareness** — Bybit supports hedge mode for short-term legs. Surface as a "hedge mode" tag on connections that have it enabled. Already in adapter scope.

**Skip from TraderMakeMoney:**

- Generally utilitarian / unbranded feel — they leave the design language unclaimed. We claim ours: Bloomberg-Terminal-density.
- No spread / multi-leg concept. We have to invent the UI for multi-leg; TMM is not the reference for that.

---

## 10. Reference apps to screenshot (mood board)

Build a folder of 10–15 screenshots before opening Claude Design. Attach them to your prompts as visual anchors.

**Must-have references:**
- Bloomberg Terminal — any screenshot, for density / mono / sparing color.
- Hyperdash.com — closest crypto-native analog with the right aesthetic.
- Deribit pro trading view — multi-panel custom layouts.
- IBKR Trader Workstation — old-school dense.
- Linear.app — non-finance but the cleanest example of monochrome + mono numbers + zero decoration.
- TradeZella — your competitor; reference for journal patterns (steal logic, not skin).

**Nice-to-have:**
- Velo.xyz, Coinalyze, Laevitas — crypto-derivatives dashboards.
- Stripe Terminal SDK demo (NOT Stripe Dashboard — the Terminal demo specifically has the right vibe).

---

## 11. Prompt templates (copy-paste these into Claude Design)

### 11.1 First-prompt (set up project)

```
Project: crypto-spread-journal — a private spread-specialist trading journal.

Aesthetic: Bloomberg Terminal × Linear × Hyperdash. Dense, monochrome
dark, monospace numbers (JetBrains Mono), zero decoration (no shadows,
no rounded corners, no gradients, no illustrations, no emoji). Color is
used only to convey state: #00ff88 for positive / open, #ff3b30 for
negative / orphaned, #ffaa00 for warning / winding_down.

Read these three docs uploaded to this project:
- docs/design-spec.md (this file — tokens, components, rules)
- docs/vocabulary.md (state machine, metric definitions, card-headline-per-type)
- docs/design-fixtures.json (realistic sample data — use as placeholder)

Anti-references: do NOT design like TradeZella's marketing site, Stripe
Dashboard, generic Web3 marketing pages, or any consumer-SaaS aesthetic.

Output format: React components with Tailwind CSS, matching Next.js 16 +
Tailwind v4 stack. All components must support empty / loading / error /
long-text-overflow states.
```

### 11.2 Per-screen prompt

```
Build the [spread list page / spread detail page / open-spread form / 
post-trade review].

Use the design spec already loaded. Pull placeholder data from
docs/design-fixtures.json — specifically [the 5 closed spreads for the
list, OR the cash_carry funding-version detail for the detail page].

Reference: [Bloomberg + Hyperdash for list, IBKR position-detail for
detail page, Deribit calendar entry form for open-spread form].

Required states: default, empty, loading, error. For the spread list,
also include an orphaned-status row variant with red outline + dot
prefix per the spec.

Show me 3 directional variations before refining the chosen one.
```

### 11.3 Adversarial revise

```
Critique this design against the spec. Specifically:

1. Are all numbers using JetBrains Mono with tabular-nums?
2. Are negative numbers using the proper minus sign U+2212, not hyphen?
3. Is any color decorative (not conveying state)?
4. Is notional shown anywhere? (It must not be — see vocabulary.md § 4.)
5. Are all cards using border-radius 0 and 1px borders?
6. Are status badges text-only (except orphaned which has outline+dot)?
7. Does the headline metric switch on card_headline_format string, or 
   on spread_type? (Must be format string — design must not branch on 
   spread_type.)

Revise to fix every "no" answer. Don't change anything that's already 
correct.
```

---

## 12. Handoff to Claude Code (me)

When you've locked a screen in Claude Design, export the React component
and drop it into `src/components/spreads/` (or wherever it belongs).

What I need from each handoff:
- The React component file (.tsx)
- The list of prop types — I'll validate against `canonical.ts SpreadPnl`
  and either align the design or extend the type
- Any new Tailwind utility classes used (so I can add them to the
  config if v4 doesn't have them built-in)
- Notes on any interactive behavior that needs server actions

Use Claude Design's built-in "handoff bundle" feature when available — 
it packages everything for me to consume.
