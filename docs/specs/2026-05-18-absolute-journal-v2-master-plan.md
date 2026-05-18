# Absolute Journal v2 — Master Plan

**Date**: 2026-05-18
**Scope**: Make the crypto journal best-in-class on the market. Three workstreams executed in parallel: wizard correctness, auto-import pipeline, new activity types.
**Constraint**: System must be "absolute" — every wizard writes every schema column, every flow lands on a reachable status, every claim in the UI matches the persisted data.

---

## 0. Audit findings (the punch list)

From 5 parallel deep audits — full reports preserved in the agent transcripts. Headline findings the design must answer:

- **Auto-import is a Potemkin village.** Pickers read `src/lib/data/exchange-fills-mock.ts`. Matcher reads `positions` — but no code inserts positions. `fills.position_id` is always NULL. The matcher is mathematically guaranteed to return zero candidates today.
- **`sync_jobs` is write-only** from the API side; the worker never reads them. "Sync now" returns 202 and queues a row that stays `queued` forever.
- **Funding events ingestion is missing entirely** — adapters expose `fetch_funding_events`, but no `insert_funding_events` exists. `funding_capture` matcher math is sourced from a perpetually empty table.
- **Wizards write ~30–40% of their schema columns.** Migration 010 added 9 open-intent + per-leg `intended_price` columns to spreads; the wizard collects none. `actions.ts` hardcodes `status='closed'`, `fees_usd='0'`, `leg_count=0`, skips `spread_legs` inserts. Trade ignores `target_price/stop_price/exit_plan` despite columns. Sale never writes `token_chain/claim_events/claim_wallet`. Airdrop hardcodes `status='claimed'` — pre-claim watchlist is structurally unreachable.
- **No `useFormStatus` on submit anywhere** — every wizard double-submits if `/review` refreshes after save.
- **Only `/source` has `force-dynamic`** — other step pages get statically prerendered by Next 16 because they read searchParams.
- **Sidebar counts are hardcoded fake numbers** (27/16/5/3/3); saved views are hardcoded URLs.
- **Universal CCXT adapter scans every market** — Binance has ~1500 spot + ~400 perp markets → ~2000 calls per sync. No "discover symbols user actually trades" shortcut.
- **Withdraw-permission check is lazy** — fires on first worker cycle, not at POST. BingX/MEXC/Phemex permissive (config-stamped `withdraw:unverified`) despite CLAUDE.md mandating rejection.
- **No `pending` status reachable in airdrop wizard** — kills the watchlist use case.
- **Vesting schedule UI renders 3 of 4 variants** — `custom` (date/pct entries) has zero UI.
- **`sale_kind` enum is stale** — missing `ieo`, `private_round`, `otc_allocation`, `vesting_claim`.
- **Trade has no `kind` discriminator** — OTC and NFT cannot be journaled.

---

## 1. Workstreams

### W1 — Wizard correctness
Make existing wizards honestly write the schema they own. Reachable statuses. Real validation. Real card previews on review.

### W2 — Auto-import pipeline
Build the fills→positions aggregator. Funding events ingestion. Sync-jobs ↔ worker handshake. Picker reads real DB. Eager withdraw-permission check.

### W3 — New activity types
`yield_position` (kinds: stake/lend/farm/lp/validator/mining) and `option` (kinds: single_leg/option_spread). Extend `trade_kind` (spot/perp/option/dated_future/otc/nft) and `sale_kind` (add ieo/private_round/otc_allocation/vesting_claim).

### Above-and-beyond features (added during iteration)
- **Movement event log** — bridge/convert/transfer/deposit/withdraw/NFT/loss in a separate `event_log` table (NOT in activity supertype since these are accounting, not strategy).
- **Trade ↔ spread conversion paths** — promote a standalone trade to a spread leg; demote a leg to standalone.
- **Wallet-paste airdrop claim fetcher** — Etherscan/Solscan integration to auto-fill claim_tx_hash, qty_received, value_at_receipt_usd.
- **CSV import for unsupported exchanges** — Backpack, Vertex, Drift, etc.
- **Strategy attribution** — tag activities by strategy name, roll-up P&L per strategy.
- **Watchlist** — pre-claim airdrops, pre-TGE sales, upcoming option expiries.
- **Calendar overlays** — vesting unlocks, option expiries, funding rate windows.
- **MAE/MFE backfill trigger UI** — button on review step (schema + worker already support it).
- **Tax-event flag** — boolean per activity for tax classification, with jurisdiction hint.
- **Strategy templates** — "copy from prior spread" with all params pre-filled.
- **Search** — wire the empty `⌘K` placeholder in sidebar to a global activity search.
- **Sidebar counts from real data** — `v_activity_feed` aggregations replace hardcoded 27/16/5/3/3.
- **Naming evolution** — "Crypto Spread Journal" → "Journal" / "Trading Journal" once it covers options/yield.

---

## 2. Schema additions (Migration v5)

**File**: `supabase/migrations/20260518000000_v5_yield_option_kinds_movement.sql`

Adds (in one migration, transactional where possible):

1. **Enums:**
   - `yield_kind` — `stake|lend|farm|lp|validator|mining`
   - `trade_kind` — `spot|perp|dated_future|option|otc|nft`
   - `option_subtype_kind` — `single_leg|option_spread`
   - `option_side` — `long|short`
   - `option_cp` — `call|put`
   - `option_spread_style` — `vertical|iron_condor|calendar|strangle|butterfly|custom`
   - `movement_event_kind` — `bridge|convert|transfer|deposit|withdrawal|nft_trade|loss|other`

2. **Enum extensions:**
   - `activity_type` ADD VALUES `yield_position`, `option`
   - `activity_status` ADD VALUE `unwinding`
   - `sale_kind` ADD VALUES `ieo`, `private_round`, `otc_allocation`, `vesting_claim`

3. **New tables:**
   - `activity_yield_position` (subtype, FK to activity)
   - `activity_option` (subtype, FK to activity)
   - `activity_option_leg` (1..N legs per option activity)
   - `event_log` (separate from activity supertype — accounting movements)

4. **Column additions:**
   - `activity_trade.kind trade_kind not null default 'spot'`
   - `activity_trade.leverage numeric(10,4)`
   - `activity_trade.margin_mode text` (CHECK in cross|isolated)
   - `activity_trade.target_price numeric(38,18)` — already exists per agent, verify
   - `activity_trade.stop_price numeric(38,18)` — already exists per agent, verify
   - `activity_trade.exit_plan text` — already exists per agent, verify
   - `activity_sale.token_chain text`
   - `activity_sale.claim_wallet text`
   - `activity_sale.sale_date date` (separate from tge_date)
   - `activity_sale.fundraising_round text` (seed|private|public|strategic|other)
   - `activity_sale.allocation_method text` (fcfs|lottery|staking|whitelist|other)
   - `activity_sale.tier text`
   - `activity_sale.bonus_pct numeric(10,4)`
   - `activity_airdrop.token_chain text`
   - `activity_airdrop.snapshot_date date`
   - `activity_airdrop.claim_tx_hash text`
   - `activity_airdrop.claim_wallet text`
   - `activity_airdrop.eligibility_reason text` (separate from `entry_thesis` notes)
   - `activity_airdrop.gas_cost_usd numeric(38,8)`
   - `activity_airdrop.claim_window_start date`
   - `activity_airdrop.claim_window_end date`
   - `activity.tax_taxable boolean not null default false`
   - `activity.tax_jurisdiction text` (hint, free text)
   - `activity.strategy_tag text` (rollup grouping)

5. **Constraints:**
   - `chk_activity_status_by_type` rewritten to cover yield_position + option
   - `chk_yield_amounts`, `chk_option_style` on new tables
   - `uq_option_leg_index` on `activity_option_leg`

6. **`v_activity_feed` view rebuilt** to emit headline metrics for the 2 new types and surface `strategy_tag` for grouping.

7. **`check_activity_subtype_exists()` extended** with cases for yield_position + option.

---

## 3. New routes and components

```
src/app/
├── add/
│   ├── yield/                     [NEW]
│   │   ├── source/page.tsx
│   │   ├── kind/page.tsx
│   │   ├── fields/page.tsx
│   │   ├── review/page.tsx
│   │   └── actions.ts
│   ├── option/                    [NEW]
│   │   ├── source/page.tsx
│   │   ├── kind/page.tsx
│   │   ├── legs/page.tsx
│   │   ├── fields/page.tsx
│   │   ├── review/page.tsx
│   │   └── actions.ts
│   ├── movement/                  [NEW]
│   │   ├── kind/page.tsx
│   │   ├── fields/page.tsx
│   │   └── actions.ts
│   ├── trade/
│   │   ├── kind/page.tsx          [NEW - between source and pick]
│   │   └── ... (existing pages get rewrites)
│   ├── sale/
│   │   ├── kind/page.tsx          [NEW - step 1 sub-kind picker]
│   │   └── ... (existing pages get rewrites)
│   └── ... (other existing pages rewritten)
├── yield-positions/               [NEW]
│   ├── page.tsx                   (redirect to /spreads/archive?activity=yield_position)
│   └── [id]/page.tsx              [NEW detail page]
├── options/                       [NEW]
│   ├── page.tsx                   (redirect to /spreads/archive?activity=option)
│   └── [id]/page.tsx              [NEW detail page]
├── movement-events/               [NEW]
│   ├── page.tsx                   (list)
│   └── [id]/page.tsx              [NEW detail page]
└── api/
    ├── activities/
    │   ├── yield/route.ts         [NEW]
    │   └── option/route.ts        [NEW]
    └── events/
        └── route.ts               [NEW for event_log]

src/components/
├── wizard/
│   ├── wizard-radio-row.tsx       [NEW shared primitive — lifted from inline impls]
│   ├── wizard-leg-list.tsx        [NEW — for option spread legs]
│   ├── wizard-vesting-editor.tsx  [NEW — 4-variant editor incl. custom]
│   ├── wizard-card-preview.tsx    [NEW — renders v_activity_feed-style card]
│   ├── wizard-submit-button.tsx   [NEW — useFormStatus-aware]
│   └── wizard-validation-summary.tsx [NEW]
├── activity/
│   ├── yield-position-card.tsx    [NEW]
│   ├── option-card.tsx            [NEW]
│   └── option-payoff-chart.tsx    [NEW — SVG payoff curve]
└── event/
    └── event-card.tsx             [NEW for movement events]
```

---

## 4. Parallel agent dispatch table

### Wave 1 — Foundation (1 agent, runs first)
| Agent | Scope | Files |
|---|---|---|
| **F** | Migration v5 + canonical types + zod + wizard primitives + i18n key stubs + WizardShell type extension | `supabase/migrations/20260518000000_v5_...sql`, `src/types/canonical.ts`, `src/lib/db/zod-schemas.ts`, `src/components/wizard/{wizard-shell.tsx,wizard-radio-row.tsx,wizard-card-preview.tsx,wizard-submit-button.tsx,wizard-validation-summary.tsx,wizard-vesting-editor.tsx,wizard-leg-list.tsx}`, `src/lib/i18n/messages/{en,ru}.ts` (stubs only) |

### Wave 2 — Wizards (6 agents, parallel after Wave 1)
| Agent | Scope | Files |
|---|---|---|
| **W2a** | Spread wizard correctness | `src/app/add/spread/*` (5 pages + actions), `src/lib/db/activity.ts` (extend `createSpread`/`updateSpread`) |
| **W2b** | Trade wizard + kind step | `src/app/add/trade/*` (existing pages rewritten + new `kind/page.tsx`), `src/lib/db/activity.ts` (extend `createTrade`) |
| **W2c** | Sale wizard + sub-kind picker + custom vesting | `src/app/add/sale/*` (existing pages + new `kind/page.tsx`), `src/lib/db/activity.ts` (extend `createSale`) |
| **W2d** | Airdrop wizard + pending status + wallet-paste stub | `src/app/add/airdrop/*` (existing pages + new `wallet/page.tsx`), `src/lib/db/activity.ts` (extend `createAirdrop`) |
| **W2e** | Yield wizard from scratch | `src/app/add/yield/*` (4 pages + actions), `src/lib/db/activity.ts` (add `createYieldPosition`), new `/yield-positions/[id]/page.tsx`, `src/components/activity/yield-position-card.tsx` |
| **W2f** | Option wizard from scratch | `src/app/add/option/*` (5 pages + actions), `src/lib/db/activity.ts` (add `createOption`), new `/options/[id]/page.tsx`, `src/components/activity/{option-card.tsx,option-payoff-chart.tsx}` |

### Wave 3 — Auto-import + cross-cutting (4 agents, parallel)
| Agent | Scope | Files |
|---|---|---|
| **W3a** | Python worker — fills→positions aggregator + funding events ingestion + sync-jobs handshake | `worker/csj_worker/{db.py,main.py,positions_aggregator.py [NEW]}`, `worker/csj_worker/adapters/generic.py` |
| **W3b** | Picker reads real DB + eager connect-time validation | `src/app/add/{spread,trade}/pick/page.tsx`, `src/app/api/exchanges/route.ts` (eager connect), `src/lib/data/exchange-fills-mock.ts` (deprecated) |
| **W3c** | Cross-cutting UI polish — force-dynamic everywhere, useFormStatus, validation summaries, card previews, screenshot/satisfaction/tag editor on review pages | All `/add/*/review/page.tsx` files, all `/add/*/fields/page.tsx` files (add `force-dynamic`) |
| **W3d** | Sidebar real counts + new types in saved views + movement event UI + branding evolution | `src/components/sidebar.tsx`, `src/lib/db/activity.ts` (add `countActivitiesByType`), `src/app/add/page.tsx` (add yield/option/movement tiles), new `/movement-events/` routes, `src/lib/i18n/messages/{en,ru}.ts` (full translations) |

### Wave 4 — Quality + verification (sequential, in main session)
- Typecheck across the whole repo
- Run any existing test suites (Vitest, pytest)
- Hand-verify each wizard end-to-end in a dev server (Chrome MCP if available)
- Iterate on any regression until clean

---

## 5. Quality bar (the "absolute" standard)

A wizard ships only when:
- Every schema column it owns is reachable via the UI
- Every status enum value valid for that type is reachable
- Back-nav from any step preserves form state (including empty strings)
- `force-dynamic` set on every step that reads `searchParams`
- Submit button is wrapped in `useFormStatus` — no double-submits
- Validation surfaces inline before submit (no redirect-with-error-string)
- `/review` shows the actual activity card the user will see, derived from `v_activity_feed`'s headline contract
- Status badge on `/review` shows the actual status that will be inserted
- i18n keys are wired in both `en.ts` and `ru.ts`
- Adversarial-review skill run after the change set lands

Auto-import is ready when:
- `positions` rows are built from fills by the worker
- `funding_events` rows are populated alongside fills
- "Sync now" updates UI status within 30 seconds
- Matcher emits ≥1 candidate per known synthetic spread test fixture
- Picker queries `spread_candidates` + `positions`, never `IMPORTED_FILLS`
- Connect-time check rejects withdraw-permitted keys before persisting

---

## 6. Ship order

1. Wave 1 foundation lands → commit
2. Waves 2 + 3 dispatched in parallel
3. As each agent lands, commit its scope
4. Wave 4 verification — adversarial review, type check, test runs
5. Iterate on any agent that returns broken / incomplete
6. Final commit with comprehensive changelog

Each wave commit is independent and reversible. The schema migration is forward-only.

---

## 7. Beyond v2 (backlog, not in scope this round)

- Multi-tax-jurisdiction rules (US/UK/EU/SG/UAE)
- Annual tax-ready exports (8949, CSV)
- Cost basis tracking (FIFO/LIFO/HIFO)
- Portfolio snapshots (periodic NAV captures)
- Risk dashboard (concentration, drawdown, exposure)
- Multi-user (still single-user product per CLAUDE.md)
- Notifications (claim window expiring, funding threshold, expiry near)
- Public read-only sharing links
- Auto-import from launchpad CSVs (CoinList, Polkastarter exports)
- Exchange Earn API integrations (Binance Earn, Bybit Earn, Kraken Stake)
- On-chain RPC integration for DeFi yield positions

These are noted; not built this round. They land in v3 after v2 is "absolute".
