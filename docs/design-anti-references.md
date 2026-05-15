# Design Anti-References — what to NOT look like

**Audience:** Claude Design + any designer / design-AI.

**How to use:** Read alongside `docs/design-spec.md`. When Claude Design produces something that drifts toward any of the patterns below, that's the signal to paste this doc back and ask for revision.

When in doubt, the rule is: **"if a normie product manager would call it pretty, we don't want it."**

---

## 1. Categorical anti-references (do not design like these)

### Generic SaaS dashboards
- **Stripe Dashboard, Linear (but pastel), Vercel Dashboard, Notion, Airtable, ClickUp.**
- Light backgrounds, soft greys, generous whitespace, large illustrations on empty states, friendly copywriting, rounded everything, blue/purple accents.
- **Why we don't want this:** the trader using our app isn't being onboarded. They want maximum data density and zero hand-holding. SaaS dashboards optimize for "anyone can use this" — we explicitly don't.

### Consumer crypto / Web3 marketing
- **DeFiLlama homepage, Dune Analytics landing page, OpenSea, Magic Eden, Phantom Wallet.**
- Neon-on-black, gradient accents, animated backgrounds, "Connect Wallet" CTA aesthetics, NFT-adjacent visual flair.
- **Why we don't want this:** marketing visuals, not working visuals. We're a tool, not a brochure.

### Fintech onboarding aesthetic
- **Robinhood, Coinbase consumer app, eToro, Revolut.**
- Single big number, friendly fonts (Cera, Fakt, custom rounded sans), green-for-good, soft confirmation modals.
- **Why we don't want this:** these apps optimize for "lower the barrier to a retail trader." We assume the user is a professional.

### Trading-journal competitors at their worst
- **TradeZella marketing site, Edgewonk, Tradervue.**
- Specific patterns to NOT replicate:
  - Purple/teal/pink accent palette (TradeZella in particular)
  - Win-rate as headline KPI on the dashboard
  - Equity curve as a single hero line
  - Achievements / badges / streaks gamification
  - Onboarding tour overlays
  - Rounded cards with soft drop shadows
  - "Friendly" empty-state illustrations
- **Why we don't want these:** see `docs/vocabulary.md` § 4 anti-patterns — most of them are statistically misleading for multi-strategy traders, and the visual softness signals "consumer app" which we're not.

---

## 2. Pixel-level patterns to ban

| Pattern | Why banned |
|---|---|
| `border-radius` greater than `0` | Softens the dense data look; reads as "consumer SaaS" |
| `box-shadow` of any kind | We use border color for elevation. Shadows read as decoration. |
| Gradients (`background: linear-gradient(...)`) | Decorative. State is conveyed by solid color only. |
| Emoji (📈 🚀 💰 ✅ etc.) | Unprofessional for a tool. Use text symbols (▲ ▼ • ✓ ✕ → ⟶) sparingly. |
| Illustrated empty states (a person looking at an empty chart, etc.) | Wastes space + signals "consumer app." Empty states are one line of text. |
| Animation longer than 150ms | Slows the operator down. Hover transitions ≤100ms. |
| Decorative icons in body cells | Icons only in toolbars/headers. Body rows are pure data. |
| Centered alignment in tables | Hides the data structure. Numeric right, text left, nothing center. |
| Bold weight to "emphasize" rows | Use color or a 2px left-border instead. |
| Tooltips that explain basic UI ("click to filter") | Operator already knows. Tooltips only for non-obvious actions. |
| "?" help-icon clusters | If the UI needs help icons, the UI needs to be redesigned. |
| Sidebar nav with icons + labels (Notion-style) | We use a horizontal top-bar. Icons-with-labels-in-sidebar wastes vertical space. |
| Modals with rounded corners + drop shadow | Modals are full-rectangle, 1px border, same aesthetic as cards. |
| Charts with fill gradients under the line | TradingView convention we don't need. Lines only. |
| Color palette with more than 4 chromatic colors | We have 4: up, down, warn, info. That's it. |
| "Beautiful" hero numbers in a giant font on a gradient card | TradeZella's "Net P&L this week" card. Don't. |

---

## 3. Copywriting anti-patterns

The text in the UI should sound like a Bloomberg field label, not a customer-success email.

| Wrong (consumer copy) | Right (operator copy) |
|---|---|
| "Welcome back, Andrew! Here's your trading dashboard." | (no greeting; data only) |
| "Great trade! Your win rate just improved." | (no praise; data only) |
| "Oops! Something went wrong." | "Failed to load spreads. [Retry]" |
| "You haven't added any trades yet. Let's get started!" | "No spreads. Connect an exchange via `POST /api/exchanges`." |
| "Your portfolio is up 12% this month — amazing!" | "+12.4% MTD (realized: +8.1%, MTM: +4.3%)" |
| "Are you sure you want to delete this trade?" | "Delete spread? This action is irreversible." |
| Sentence-case headings ("My trading journal") | Uppercase-mono section labels ("SPREADS", "FILTERS", "POST-TRADE REVIEW") |
| Friendly button labels ("Got it!", "Let's go!") | Verb-only ("CLOSE", "ACCEPT", "REJECT", "EXPORT") |

**No exclamation marks. Ever.**

---

## 4. Specific TradeZella patterns to invert

| TradeZella does | We do instead |
|---|---|
| Win rate as the dashboard hero number | Per-spread-type APR distribution. Win rate is buried in detailed reports, never the headline. |
| Equity curve as one line | Stacked equity curve: one band per spread type, or one band per component (realized / basis / funding / fees). |
| Calendar heatmap with bright colors | Calendar heatmap, but monochrome — green→bg for positive intensity, red→bg for negative. Cell border 1px. |
| Trades shown as rows with bright tag pills | Spreads as cards (multi-leg complexity demands more than a row) or as table rows with text-only tags. |
| Bubbly notes section with profile-pic chat aesthetic | Plain `<textarea>` with monospace, attachment list below. |
| "Strategy templates" gallery with screenshots | Drop-down list of named templates, no thumbnails. |
| Trade replay slider with cute icons | (defer; v2) — when built, plain monospace timeline. |
| Onboarding tour with tooltips and arrows | None. README in the repo is the docs. |
| Gamified streaks / achievements | None. Stats only. |

---

## 5. Specific Stripe Dashboard patterns to invert

| Stripe Dashboard does | We do instead |
|---|---|
| Generous 80px+ vertical spacing between sections | 24px / 32px max. Density. |
| White cards on light grey background | Black-on-dark; cards are bg with 1px border. |
| Big rounded number cards ("$1,234.56 this month") with subtle grey labels | Tabular-num text in the table; "this month" is a filter, not a card. |
| 14–16px body text everywhere | 11–13px body. Density. |
| Subtle blue accent everywhere | Color reserved for state. No blue accent on chrome. |

---

## 6. The smell test

After any Claude Design output, ask:
- Could this be a screenshot of a B2B SaaS landing page? → It's wrong. Revise.
- Does it have a "delightful empty state"? → It's wrong. Revise.
- Does the dashboard headline number feel celebratory? → It's wrong. Revise.
- Could you imagine this being shipped by Stripe / Linear / Notion? → It's wrong. Revise.
- Could you imagine this being shipped by Bloomberg / IBKR / Deribit / Hyperdash? → ✓ Continue refining.

---

## 7. The single biggest tell of "AI generic"

The model defaults to a specific look when undirected:

- Dark navy or slate-900 background (not true black)
- Indigo or purple accent
- Inter or Geist sans throughout (no monospace)
- Rounded `xl` (12px+) on every card
- Subtle drop shadows for "depth"
- Pill-shaped status badges with `bg-*-500/10` backgrounds
- Lucide icons paired with labels
- Hero card with a big chart fill-gradient

**If you see ANY of these in Claude Design's output, paste this doc back and demand revision.** This is the "I asked an AI to make me a dashboard and got generic AI dashboard" failure mode. The whole point of the spec doc and this doc is to prevent it.
