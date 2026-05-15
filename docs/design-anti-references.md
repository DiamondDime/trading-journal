# Design Anti-References — what NOT to look like

**Audience:** Claude Design + any designer / design-AI.

**How to use:** Read alongside `docs/design-spec.md`. When the output drifts toward any pattern below, paste this doc back and ask for revision against the specific rule.

**Last updated:** 2026-05-16 (rev 2).

---

## 1. The primary failure mode: "AI-generic trading terminal"

This is the trap we're explicitly fighting. Symptoms:

- **Pure-black background** (`#000000` or `#0a0a0a`) — looks like a 1995 hacker movie
- **Matrix-green accent** (`#00ff00`, `#00ff88`) — neon, juvenile
- **JetBrains Mono everywhere** — body text, headings, buttons, labels
- **All-caps uppercase mono section labels** ("OPEN SPREADS", "FILTERS")
- **0px border-radius on everything** — "brutalist" flat
- **No shadows / no elevation** — flat 2-tone
- **11-13px body text** — squint mode
- **`▲ ▼ • ✕` text-symbol icons** instead of real iconography
- **No charts, just numbers in tables**

This is what every AI produces when asked for "a serious dashboard." It is **not** what real premium fintech looks like. Mercury, Stripe Treasury, Linear, Brex, Plaid — none of them use any of the patterns above.

**If the output has any 3+ of those symptoms, it has fallen into the trap. Revise.**

---

## 2. Categorical anti-references

### Generic consumer SaaS
- Stripe Dashboard the marketing demo, Notion, Airtable, ClickUp, Linear's *landing page* (not the actual product), Vercel marketing pages.
- Light backgrounds with cute illustrations, friendly copywriting, generous illustrations of stick-figure people, "Welcome back!" greetings, achievements UI, soft purples and pinks.
- **Why bad:** consumer-friendly signals "anyone can use this." We're a premium B2B tool. Operators are paying us; we don't need to coddle.

### "AI-trading-terminal" cliché (the new failure mode)
- Pure black bg + neon green text + Courier/JetBrains Mono everywhere + all-caps labels.
- Looks like every AI-generated "make me a Bloomberg clone" output since 2023.
- **Why bad:** it's the visual fingerprint of "I asked an LLM for a dashboard." Generic. Cheap-looking. Performatively serious.

### Web3 marketing aesthetic
- DeFiLlama, Dune Analytics, OpenSea, Magic Eden, Phantom Wallet, Uniswap landing.
- Neon-on-dark, gradient backgrounds, animated mesh patterns, "Connect Wallet" energy.
- **Why bad:** marketing visuals, not working visuals. We're a tool, not a brochure.

### Fintech-consumer
- Robinhood, Coinbase consumer, Revolut, eToro.
- Big single celebratory numbers, friendly rounded sans-serifs, green-for-good with thumbs-up energy.
- **Why bad:** retail-trader UX. Our user is a pro who wants data, not encouragement.

### Trading-journal competitors at their worst
- TradeZella marketing site (the app is OK), Edgewonk, Tradervue.
- Purple/teal/pink palettes (TradeZella in particular).
- Win-rate as headline KPI.
- Equity curve as one big line.
- Achievements / streaks / badges.
- Rounded corners with soft shadows in a *consumer* way (not the disciplined fintech-pro way).
- **Why bad:** consumer-trader UX. We're a tier above.

---

## 3. Pixel-level banned patterns

| Pattern | Why banned |
|---|---|
| Pure black `#000` or near-black `#0a0a0a` for bg | Hacker-movie cliché. Use `#0d1117` (GitHub-dark) or lighter. |
| Neon green `#00ff00`, `#00ff88` for positive | Matrix cliché. Use mature green `#16a34a` / `#3fb950`. |
| Neon red `#ff0000`, `#ff3b30` for negative | Use mature red `#dc2626` / `#f85149`. |
| Monospace body text | Inter for body. Mono ONLY for numbers / tickers / IDs. |
| All-caps section labels (`OPEN SPREADS`) | Sentence-case Inter medium. "Open spreads". |
| 0px border-radius on everything | Cards 8px, buttons 6px, badges full-rounded. Brutalist 0-radius is the AI cliché. |
| No shadows ever | Subtle shadows are how premium fintech does elevation. See spec § 4. |
| 11px / 12px body text | 14px minimum for body. Density via hierarchy, not miniaturization. |
| Text-symbol icons (▲ ▼ ✕ • ✓) in headers/buttons | Use Lucide icons (16-20px) for real iconography. Text symbols only in tabular indicators. |
| Gradients on cards | Subtle bg-tone shift between surface levels is fine; gradients are not. |
| Soft drop shadows with halo / glow | `--shadow-sm` and `--shadow-md` only. Disciplined. |
| Emoji (📈 🚀 💰 ✅) | Never. Lucide icons or nothing. |
| Cartoon illustrations on empty states | Subtle brand-color line icon (64px max) is fine; cartoon people are not. |
| Animation longer than 300ms | Real motion, not performative. Hover 150ms, page transitions 300ms max. |
| Decorative icons in body table cells | Icons in toolbars/headers only. Body rows = data. |
| Centered text alignment in tables | Numeric right, text left, nothing centered. |
| Bold weight to "emphasize" rows | Use bg-tone or left-border accent instead. |
| Tooltips that explain basic UI | Operator already knows. Tooltips for non-obvious only. |
| "?" help-icon clusters | If UI needs help icons, redesign the UI. |
| Modals with rounded corners + soft drop shadow + backdrop blur in a CONSUMER way | Modals use `--shadow-xl`, `--radius-lg`, dark backdrop at 50% opacity. Disciplined, not airy. |
| Color palette with more than 5 chromatic colors | Brand + 4 state colors = 5. That's the budget. |
| `bg-{color}-500/10` gradient pills for status | Use `--accent-*-bg` solid tinted backgrounds. |
| Sparkline charts decorating every metric | Charts where charts belong; numbers where numbers belong. |

---

## 4. Copywriting anti-patterns

The text in the UI should sound like a Stripe API doc, not a customer-success email.

| Wrong (consumer copy) | Right (operator copy) |
|---|---|
| "Welcome back, Andrew! Here's your dashboard." | (no greeting) |
| "Great trade! Your win rate just improved." | (no praise) |
| "Oops! Something went wrong." | "Failed to load spreads. Retry." |
| "You haven't added any trades yet. Let's get started!" | "No spreads yet. Connect an exchange to start tracking." |
| "Your portfolio is up 12% this month — amazing!" | "+12.4% MTD · realized $8,123, MTM $4,290" |
| "Are you sure?" | "Delete spread? This cannot be undone." |
| Page titles in sentence case: "My trading journal" | Page titles in sentence case: "Spreads" — but NOT all-caps mono. |
| Button labels: "Got it!", "Let's go!" | Verb-only: "Save", "Accept", "Reject", "Export" |

**No exclamation marks. No emojis. No greetings. No achievements.**

But we *don't* need to be hostile/terse either. "Failed to load spreads. Retry." is fine — full sentences, just not chatty.

---

## 5. Specific TradeZella patterns to invert

| TradeZella does | We do instead |
|---|---|
| Win rate as the dashboard hero number | Per-spread-type APR distribution. Win rate buried in detailed reports. |
| Equity curve as one line | Stacked equity curve — band per spread type or per component (realized / basis / funding / fees). |
| Calendar heatmap with consumer-bright colors | Calendar heatmap with brand-color saturation gradient for positive, red saturation for negative. Subtle. |
| Trades as rows with bright colored pills | Spreads as cards (multi-leg needs more than a row) OR table rows with subtle tinted-bg badges per spec. |
| Bubbly chat-style notes section | Plain prose notes with proper typography, attachments listed below. |
| Onboarding tour with arrows + tooltips | None. README is the doc. |
| Streaks / achievements / gamification | None. Stats only. |

---

## 6. The smell test

After each Claude Design output, ask:

- Could this be a Bloomberg Terminal screenshot? → **It's wrong. Revise — we're not a terminal.**
- Does it look like every AI-generated trading dashboard ever made? → **It's wrong. Revise.**
- Is it pure black + neon green? → **It's wrong. Revise.**
- Is every element monospace? → **It's wrong. Inter is the default.**
- Does it have all-caps section labels? → **It's wrong. Sentence-case Inter.**
- Could you imagine this being shipped by Robinhood / Coinbase consumer / TradeZella? → **It's wrong, too consumer.**
- Could you imagine this being shipped by Mercury / Stripe Treasury / Linear / Brex / Plaid / Carta? → ✓ **On target.**

---

## 7. The single biggest tell of "AI generic" — 2026 edition

When undirected (or over-directed toward "trading terminal"), Claude Design defaults to one of two failure modes:

**Failure mode A — Generic SaaS:**
- Indigo or purple accent
- Soft rounded `xl` (12px+) corners on everything
- Lucide icons paired with all labels
- Hero chart with fill gradient
- "Beautiful" but undifferentiated

**Failure mode B — AI trading terminal:** *(the one we just hit)*
- Pure black bg
- Neon green/red
- JetBrains Mono everywhere
- All-caps mono section labels
- 0-radius brutalism
- 11-13px squint text
- No shadows, flat 2-tone
- Performatively "serious"

**Both are failures.** The target is the narrow band *between* them: premium fintech-pro. Mercury-ish, Stripe-Treasury-ish, Linear-actual-product-ish.

If output drifts toward A: more brand-color discipline, less generic shadcn-defaults, real differentiated typography.
If output drifts toward B: drop the mono, add radius, add shadows, switch to Inter, use mature colors.
