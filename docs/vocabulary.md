# Crypto Spread Journal — Shared Vocabulary

Single source of truth for terminology across the stack. **Both the design Claude (frontend) and backend reference this doc.** When a name appears here, it has one and only one canonical spelling — anywhere else in the codebase, docs, or design that uses a different spelling is a drift bug.

Last updated: 2026-05-16 (locked from the v1 arbitrage domain brief).

---

## 1. Spread types

| Display name | Code (DB / TS / Python) | Notes |
|---|---|---|
| Cross-exchange perp arbitrage | `cross_exchange_perp_arb` | Same instrument on two CEXes |
| Cash-and-carry | `cash_carry` | Long spot + short derivative |
| Calendar | `calendar` | Two expiries, same asset (Deribit) |
| Funding capture | `funding_capture` | Delta-neutral, collect funding |
| DEX-CEX arbitrage | `dex_cex_arb` | One on-chain leg |
| Custom | `custom` | Operator-built, doesn't fit above |

**Never use** `cash_and_carry` (with the extra `and_`) — DB column is `cash_carry`. Display name in UI can spell it out, but every code path uses `cash_carry`.

---

## 2. Spread variants

`variant` is a sub-type. Only `cash_carry` and `funding_capture` have variants; for other types `variant` is `NULL`.

| Spread type | Variant code | Meaning |
|---|---|---|
| `cash_carry` | `funding` | Short leg is a perp; earns funding while held |
| `cash_carry` | `basis` | Short leg is a dated future; held to expiry |
| `funding_capture` | `same_venue` | Long spot + short perp on one exchange |
| `funding_capture` | `cross_venue` | Long perp (neg funding venue) + short perp (pos funding venue) |

DB constraint `chk_spread_variant` enforces this mapping.

---

## 3. Lifecycle states (`spread_status`)

| Code | Meaning | Date invariants | UI signal |
|---|---|---|---|
| `candidate` | Matcher proposal, not yet accepted | `opened_at IS NULL` | "candidate" badge, in review queue |
| `rejected` | Candidate dismissed by operator | — | hidden from default list |
| `open` | All legs filled, position active | `opened_at NOT NULL, closed_at NULL` | clean card, live MTM |
| `winding_down` | Some legs closed, exit in progress | `opened_at NOT NULL, closed_at NULL` | orange tag "exiting", greyed-out closed legs |
| `orphaned` | One leg open with no hedge (UNINTENDED) | `opened_at NOT NULL` | RED ALERT card, acknowledgement required |
| `expired` | Future settled by exchange before manual close | `opened_at NOT NULL, closed_at NOT NULL` | grey, "expired" badge |
| `closed` | All legs fully closed by operator | `opened_at NOT NULL, closed_at NOT NULL` | grey card, final stats locked |

DB constraint `chk_spread_status_dates` enforces the invariants.

### Transitions

```
candidate ──accept──▶ open
candidate ──reject──▶ rejected
open      ──leg-close-initiated──▶ winding_down
winding_down ──all-legs-closed──▶ closed
winding_down ──one-leg-fails-to-close──▶ orphaned
open      ──unintended-single-leg-state──▶ orphaned
open      ──future-settles──▶ expired
orphaned  ──operator-rehedges──▶ open
```

---

## 4. Metric vocabulary

All metrics on the spread detail page and post-trade review derive from `public.spread_pnl`.

| Metric | Column / API field | Unit | Formula | Notes |
|---|---|---|---|---|
| Capital deployed | `capital_deployed_usd` | USD | operator input at open | ⚠️ Never use notional as a substitute |
| Days held | `days_held` | days | `(closed_at − opened_at)/86400`, falls back to `now()` while open | |
| Realized PnL | `realized_pnl_quote` | USD | sum of closed-leg realized PnL | |
| Basis PnL | `basis_pnl_quote` | USD | net of leg MTMs (≈0 for delta-neutral) | The "basis" component of cash-carry / calendars |
| Funding received | `funding_received_quote` | USD | sum of `funding_events.amount` joined via legs | Discrete bars in UI, not a line |
| Fees | `fees_quote` | USD | sum of taker/maker fees on all legs | Always positive in this column (subtracted in net) |
| Net PnL | `net_pnl_quote` | USD | `realized + basis + funding − fees` | The single bottom-line number |
| Gross PnL | `gross_pnl_quote` | USD | `realized + basis` (no funding, no fees) | |
| Realized APR | `realized_apr` | decimal (0.178 = 17.8%) | `(net/capital) × (365/days_held)`. Linear, no compounding. | Cash-carry + funding capture headline |
| bps captured (net) | `bps_captured_net` | bps | `(net/capital) × 10000` | Cross-exchange + DEX-CEX headline |
| bps/day | `bps_per_day` | bps/day | `bps_captured_net / days_held` | Calendar headline |
| Realized vs expected APR | `realized_vs_expected_apr` | ratio | `realized_apr / target_apr_at_open` | Post-trade thesis-delta; <0.7 = thesis underdelivered |
| Funding $/day | derived: `funding_received_quote / days_held` | USD/day | | Funding-capture daily run-rate |

### What NOT to compute (per the brief's anti-patterns)

| Anti-metric | Why | Use instead |
|---|---|---|
| Total return % | Meaningless on market-neutral spreads | APR or bps |
| Win rate across mixed types | Simpson's paradox | Per-spread-type win rate |
| Equity curve as one line | Hides regime changes | Stacked (by type / by component) |
| Notional on the card | Misleads about risk | Capital deployed |
| ROI on calendars | Wrong frame | Credit/debit + bps/day |
| Generic max drawdown | Noise from leg lead/lag | Worst-leg-drawdown OR liq-buffer dip |
| Sharpe | Useless on near-zero-vol market-neutral PnL | APR + funding-rate stability + worst-leg-drawdown |

---

## 5. Card headline per spread type

The list view shows ONE headline number per card. The backend (`spread_pnl` view) computes this per-type so the frontend renders blindly:

```ts
// Returned by GET /api/spreads
{
  card_headline_metric: 'bps_captured' | 'realized_apr' | 'bps_per_day' | 'net_pnl_quote',
  card_headline_value: string | null,        // Decimal as string
  card_headline_format: 'bps' | 'apr_pct' | 'bps_per_day' | 'usd',
}
```

| Spread type | Metric | Format | Example display |
|---|---|---|---|
| `cross_exchange_perp_arb` | `bps_captured` | `bps` | `+11.6 bps` |
| `cash_carry` | `realized_apr` | `apr_pct` | `14.0%` |
| `calendar` | `bps_per_day` | `bps_per_day` | `+5.0 bps/d` |
| `funding_capture` | `realized_apr` | `apr_pct` | `11.6%` |
| `dex_cex_arb` | `bps_captured` | `bps` | `−59 bps` |
| `custom` | `net_pnl_quote` | `usd` | `$1,389.40` |

**Frontend rule:** never write `if spread_type === ...` to choose a label. Read `card_headline_format` and switch on the format string instead.

---

## 6. Open-intent fields (`spreads` table)

Fields the trader fills in when opening the spread. These power the post-trade "Was the thesis right?" review.

| Field | Type | Applies to | Use in review |
|---|---|---|---|
| `target_apr_at_open` | decimal | cash-carry, funding-capture | Compare `realized_apr / target_apr_at_open` → `realized_vs_expected_apr` |
| `expected_holding_days` | int | all | Compare to actual `days_held` |
| `expected_basis_convergence_date` | date | cash-carry basis-version | Did basis converge by this date? |
| `exit_plan` | text | all | Free-text exit thesis; shown verbatim on review |
| `borrow_cost_assumed_bps` | decimal | cash-carry basis with margin spot | Compare to realized borrow cost |
| `close_threshold_apr` | decimal | funding-capture | Was the trade closed near this threshold? |
| `close_threshold_periods` | int | funding-capture | How many periods of breach before alert fired |
| `max_gas_budget_usd` | decimal | DEX-CEX | Compare to actual gas paid |
| `slippage_tolerance_bps` | decimal | cross-exchange, DEX-CEX | Compare to actual slippage per leg |

`regime_tags: string[]` and `custom_tags: string[]` also captured at open. `regime_tags` is operator-set market-state ("high_funding", "Fed_week", "BTC_ETF_inflow"); `custom_tags` is freeform.

---

## 7. Per-leg execution review (`spread_legs` table)

For the "Was execution clean?" review section:

| Field | Type | Notes |
|---|---|---|
| `intended_price` | decimal | Operator's target entry price |
| `intended_price_set_at` | timestamptz | When the target was set |
| Derived: `slippage_bps` | decimal | `(avg_fill_price − intended_price) / intended_price × 10000` |
| Derived: `time_to_fill_seconds` | int | First fill timestamp − `intended_price_set_at` |

Cross-leg derived metric — **fill-time skew** — is the largest gap between any two legs' first-fill timestamps. Surfaces as "directional exposure window" on review.

---

## 8. Filter / sort dimensions (priority order)

These are the filters the spread trader actually uses. Build the UI in this order.

**Primary filters (most-used):**
1. Spread type (multi-select)
2. Status (multi-select, default: `open` + `winding_down` + `orphaned`)
3. Asset (`primary_base`, multi-select)
4. Date range (default: `opened_at`; toggle to `closed_at`)
5. Exchange (filter where `exchanges` array contains any selected)

**Secondary filters:**
6. Regime tag (multi-select from `regime_tags`)
7. Holding-period bucket (`days_held` buckets: `<1d`, `1–7d`, `7–30d`, `>30d`)
8. Capital bucket (`capital_deployed_usd` buckets: `<$10k`, `$10–50k`, `$50–250k`, `>$250k`)
9. APR / bps bucket

**Sort dimensions:**
- `realized_apr` (default for cash-carry + funding-capture)
- `bps_captured_net` (default for cross-exchange + DEX-CEX)
- `bps_per_day` (default for calendars)
- `capital_deployed_usd`
- `days_held`
- `opened_at`, `closed_at`
- `net_pnl_quote` (fallback)

**Explicitly NOT a primary filter:**
- Notional (use `capital_deployed_usd`)
- Win/loss boolean (use `realized_vs_expected_apr`)

---

## 9. Cross-language enum mapping

| Concept | TS const | Python enum | DB column type |
|---|---|---|---|
| Spread type | `SpreadType.CASH_CARRY` | `SpreadType.CASH_CARRY` | `text` referencing `spread_type_catalog(code)` |
| Spread variant | `SpreadVariant.CASH_CARRY_FUNDING` | `SpreadVariant.CASH_CARRY_FUNDING` | `text`, value = `'funding'` |
| Status | `SpreadStatus.WINDING_DOWN` | `SpreadStatus.WINDING_DOWN` | `spread_status` enum, value = `'winding_down'` |
| Headline metric | `CardHeadlineMetric.REALIZED_APR` | `CardHeadlineMetric.REALIZED_APR` | `text`, value = `'realized_apr'` |
| Headline format | `CardHeadlineFormat.APR_PCT` | `CardHeadlineFormat.APR_PCT` | `text`, value = `'apr_pct'` |

All enum string values are byte-identical across TS / Python / DB. Adding a new value requires:
1. New SQL migration to extend the column type / constraint
2. `src/types/canonical.ts` — add to the const + type
3. `src/lib/db/zod-schemas.ts` — add to the `z.enum([...])`
4. `worker/csj_worker/types.py` — add to the enum class
5. This doc — update the relevant table
