# Multi-activity journal — design spec

**Date:** 2026-05-16
**Status:** Approved (brainstorming → implementation)
**Supersedes:** Implicit single-spread-type scope of `2026-05-15-architecture.md` (extends, does not replace)

## TL;DR

Extend the project from a spreads-only journal into a complete crypto trading journal supporting four activity types — Spread, Trade, Sale, Airdrop — with both auto-imported and manually-entered data paths. Ship as an open-source self-hosted product. The existing schema gets a supertype refactor (`activity` base + subtype tables); the UI grows a unified archive, a `+ Add` wizard at `/add`, and per-activity detail pages.

## Vision

A complete, well-designed trading journal that crypto traders actually want to use. Tax tools (Koinly, Coinpanda) cover compliance. Stock-trade journals (TradeZella, Edgewonk) ignore crypto-native activities like premarket sales, airdrops, and multi-leg spreads. This product fills the gap.

- **Atomic units, plural** — a Spread is a multi-leg construct; a Trade is one-venue; a Sale is an allocation event; an Airdrop is a receipt event. The journal models each on its own terms.
- **Editorial aesthetic** — the existing visual language (Source Serif 4 titles, signature amber on hero metrics, mono numerics, dense data layouts) stays. It's the product's voice.
- **Self-hosted by default** — `docker compose up -d` and a trader has their own instance. No vendor lock-in, no data exfiltration, no SaaS billing.
- **Exchange-connected when it can be, manual when it can't** — the picker shows your imported fills first; manual entry is always available.

## Locked decisions (from Q&A rounds)

| Question | Decision |
|---|---|
| Audience for v1 | Open-source self-hosted; single-user-per-instance default; multi-user-per-instance opt-in via env config (deferred) |
| v1 activity types | Spread + Trade + Sale + Airdrop (4 types) |
| Entry mode | Both paths — from-exchange (via Phase 5 worker) AND manual; combined into one unified picker page |
| Information architecture | Unified archive with type filter chips; per-type detail pages |
| Wizard pattern | Dedicated page routes (`/add/<type>/<step>`), browser back works, draft state persisted |
| Picker UX | Matcher suggestions on top + browse imported positions + inline manual-leg form, all on one page |
| Schema model | Activity supertype + per-type subtype tables (Approach A) |
| Trade ↔ Position | `activity_trade.position_id → position.id` — Trade is a journaled Position |
| Repo name | Rename `crypto-spread-journal` → `crypto-journal` |
| License | MIT |

## Data model

### Tables

```sql
-- Base supertype
create table activity (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  type                 activity_type not null,       -- 'spread' | 'trade' | 'sale' | 'airdrop'
  status               activity_status not null,
  name                 text not null,
  opened_at            timestamptz,
  closed_at            timestamptz,
  capital_deployed_usd numeric,
  realized_pnl_usd     numeric,
  unrealized_pnl_usd   numeric,
  fees_usd             numeric default 0,
  net_pnl_usd          numeric,
  regime_tags          text[] default '{}',
  custom_tags          text[] default '{}',
  -- Note is attached via inverse FK: `notes.activity_id` with UNIQUE(activity_id)
  -- and ON DELETE CASCADE. This keeps note lifecycle bound to its parent
  -- activity (delete activity → note dies). The activity table has no
  -- notes_id column.
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_dates check (closed_at is null or opened_at is null or closed_at >= opened_at)
);

-- Subtype: spread (existing `spread` table, trimmed)
create table activity_spread (
  activity_id                      uuid primary key references activity(id) on delete cascade,
  spread_type                      spread_type not null,
  variant                          spread_variant,
  origin                           spread_origin not null default 'manual',
  primary_base                     text not null,
  match_confidence                 numeric,
  -- open-intent (existing fields preserved)
  target_apr_at_open               numeric,
  expected_holding_days            integer,
  expected_basis_convergence_date  timestamptz,
  exit_plan                        text,
  borrow_cost_assumed_bps          numeric,
  close_threshold_apr              numeric,
  close_threshold_periods          integer,
  max_gas_budget_usd               numeric,
  slippage_tolerance_bps           numeric,
  -- aggregates
  gross_pnl_usd                    numeric,
  funding_pnl_usd                  numeric,
  basis_pnl_usd                    numeric,
  realized_apr                     numeric,
  bps_captured_net                 numeric,
  bps_per_day                      numeric,
  leg_count                        integer not null default 0,
  exchanges                        text[] default '{}'
);

-- Subtype: trade (new)
create table activity_trade (
  activity_id      uuid primary key references activity(id) on delete cascade,
  position_id      uuid not null references position(id),
  symbol           text not null,
  exchange         text not null,
  instrument_kind  instrument_kind not null,
  side             position_side not null,
  entry_thesis     text,
  exit_plan        text,
  target_price     numeric,
  stop_price       numeric,
  qty              numeric not null,
  avg_entry_price  numeric not null,
  avg_exit_price   numeric,
  realized_apr     numeric
);

-- Subtype: sale (new)
create table activity_sale (
  activity_id          uuid primary key references activity(id) on delete cascade,
  token_symbol         text not null,
  token_name           text,
  token_chain          text,
  sale_kind            sale_kind not null,           -- 'ido' | 'launchpad' | 'premarket' | 'otc'
  sale_venue           text,
  sale_date            timestamptz not null,
  usd_paid             numeric not null,
  tokens_allocated     numeric not null,
  effective_price_usd  numeric generated always as (
    case when tokens_allocated > 0 then usd_paid / tokens_allocated else null end
  ) stored,
  vesting_schedule     jsonb,                        -- {tge_pct, cliff_days, linear_days, custom?}
  claim_events         jsonb default '[]',           -- [{date, qty, tx_hash}]
  total_claimed        numeric default 0,
  remaining_locked     numeric
);

-- Subtype: airdrop (new)
create table activity_airdrop (
  activity_id           uuid primary key references activity(id) on delete cascade,
  token_symbol          text not null,
  token_name            text,
  token_chain           text,
  protocol              text not null,
  snapshot_date         timestamptz,
  eligibility_reason    text,
  qty_received          numeric not null,
  claim_date            timestamptz,
  claim_tx_hash         text,
  value_at_receipt_usd  numeric,
  current_price_usd     numeric,
  current_price_at      timestamptz
);
```

Note: `activity_sale` also carries `current_price_usd` + `current_price_at` so
the cross-activity feed's MTM multiplier can be computed for sales (current
value of tokens allocated, divided by USD paid). Mirror of the airdrop pattern.

### Enums

```sql
create type activity_type as enum ('spread', 'trade', 'sale', 'airdrop');

create type activity_status as enum (
  -- shared, but each type uses a subset
  'pending',       -- sale: allocation paid, pre-TGE; airdrop: eligible not claimed
  'open',          -- trade: position active; spread: legs open
  'winding_down',  -- spread: some legs closed
  'orphaned',      -- spread: one leg open with no hedge (alert state)
  'vesting',       -- sale: tokens being claimed over time
  'claimed',       -- airdrop: tokens received
  'liquidated',    -- trade: position was liquidated
  'expired',       -- spread: dated future settled
  'closed'         -- terminal: fully done
);

create type sale_kind as enum ('ido', 'launchpad', 'premarket', 'otc');
```

### Cross-activity view

```sql
create view v_activity_feed as
select
  a.id, a.user_id, a.type, a.status, a.name,
  a.opened_at, a.closed_at,
  a.capital_deployed_usd, a.realized_pnl_usd, a.unrealized_pnl_usd,
  a.fees_usd, a.net_pnl_usd,
  a.regime_tags, a.custom_tags, a.notes_id,
  -- polymorphic card headline
  case a.type
    when 'spread'  then s.realized_apr
    when 'trade'   then t.realized_apr
    when 'sale'    then (sa.tokens_allocated * coalesce(sa.effective_price_usd, 0))  -- placeholder; MTM lives in app layer
    when 'airdrop' then case
      when ad.value_at_receipt_usd > 0
        then (ad.current_price_usd * ad.qty_received) / ad.value_at_receipt_usd * 100
      else null end
  end as headline_value,
  case a.type
    when 'spread'  then 'realized_apr'
    when 'trade'   then 'realized_apr'
    when 'sale'    then 'mtm_multiplier'
    when 'airdrop' then 'mtm_multiplier'
  end as headline_kind,
  a.created_at, a.updated_at
from activity a
left join activity_spread  s  on s.activity_id  = a.id and a.type = 'spread'
left join activity_trade   t  on t.activity_id  = a.id and a.type = 'trade'
left join activity_sale    sa on sa.activity_id = a.id and a.type = 'sale'
left join activity_airdrop ad on ad.activity_id = a.id and a.type = 'airdrop';
```

### Migration plan

1. New tables: `activity`, `activity_trade`, `activity_sale`, `activity_airdrop` (additive).
2. Insert **confirmed** spread rows from existing `spread` into `activity` (preserve UUIDs). Move common columns. Rename `spread` table → `activity_spread`. **Rows with `status IN ('candidate', 'rejected')` are NOT migrated** — those stay as `spread_candidate` table entries (matcher-output domain), not journaled activities. Only confirmed activities (`origin IN ('manual', 'auto_confirmed')`) get an `activity` row.
3. Rename `spread_leg.spread_id` → `spread_leg.activity_id` (same UUIDs, FK preserved).
4. Rebuild `v_spread_pnl` to JOIN through `activity` (UI components keep working unchanged).
5. Update `canonical.ts`, `zod-schemas.ts`, Pydantic `types.py`. New types: `ActivityType`, `ActivityStatus`, `Activity`, `ActivityTrade`, `ActivitySale`, `ActivityAirdrop`, `SaleKind`. `SpreadStatus` deprecates `candidate`/`rejected` (those move to `CandidateState` exclusively).
6. Update API routes: keep `/api/spreads/*` for back-compat; add `/api/activities/*` for cross-activity reads.
7. ~30 files touched. Estimate: one focused implementation session.

Note: the matcher pipeline is unchanged — it still writes `spread_candidate` rows. The wizard's "confirm suggestion" step is what creates an `activity` (type=spread) + `activity_spread` pair from a candidate.

## Information architecture

### Routes

```
/                         The Book (dashboard, cross-activity)
/archive                  unified archive (chip filter: Activity type)
/spreads | /trades | /sales | /airdrops    aliases of /archive?type=<x>
/spreads/[id]             spread detail (existing template)
/trades/[id]              trade detail (new)
/sales/[id]               sale detail (new)
/airdrops/[id]            airdrop detail (new)
/add                      wizard step 1 (type picker)
/add/<type>/...           wizard subsequent steps
/calendar                 cross-activity calendar
/analytics                cross-activity track record
/exchanges                connection settings
/notes                    notes feed
```

### Sidebar (post-rebuild)

```
The Book
  Overview          → /
  All activity      → /archive
  Calendar view     → /calendar

Analytics
  Track record
  Activity mix
  Regime distribution

Workshop
  Notes
  Saved views
  Exchanges

Saved views
  All activity / Spreads / Trades / Sales / Airdrops / Winners / Losers
  Cash-and-carry / Funding captures / Cross-exchange / Calendar / DEX-CEX

Quick
  + Add (→ /add)
  + Connect exchange
```

### Dashboard composition ("The Book" at `/`)

- Hero strip — title, subtitle showing activity counts by type, action buttons
- KPI row — Net P&L YTD (hero amber), Activities closed, Win rate, Weighted return, Best activity, Worst activity (all cross-activity)
- Heatmap (cross-activity daily P&L) + Funding ticker
- Recent closes (8 cards, mixed activity types — each card shows type badge + type-specific headline)
- Equity curve (stacked by activity type)
- Activity mix (top-level: 4 types; nested: spread subtypes)
- Notes feed (cross-activity)

### Archive (`/archive`)

Current `/spreads/archive` page extends:
- New top chip row: **Activity type** (Spread / Trade / Sale / Airdrop)
- Existing chip rows (Type / Asset / Status / Outcome) scope to selected Activity type when applicable
- Table view shows polymorphic headline column based on `headline_kind`
- Card view uses one of four card templates based on activity type

## Wizard flows

### Common entry — `/add` (step 1, all flows)

Four cards: Spread · Trade · Sale · Airdrop. Click one to advance.

### Spread flow

```
/add/spread                                       subtype picker (5 cards)
/add/spread/<subtype>                             variant picker (only for cash_carry, funding_capture)
/add/spread/<subtype>/<variant>/pick              unified picker (see below)
/add/spread/<subtype>/<variant>/journal           postmortem → save → /spreads/[id]
```

### Trade flow

```
/add/trade                                        unified picker
/add/trade/journal                                notes → save → /trades/[id]
```

### Sale flow (all manual)

```
/add/sale                                         token info
/add/sale/allocation                              usd_paid, tokens_allocated
/add/sale/vesting                                 schedule type + parameters
/add/sale/claims                                  optional past claims
/add/sale/journal                                 notes → save → /sales/[id]
```

### Airdrop flow (all manual)

```
/add/airdrop                                      token info
/add/airdrop/claim                                qty, claim_date, tx, value
/add/airdrop/journal                              notes → save → /airdrops/[id]
```

### Shared wizard chrome

- Breadcrumb top: `Add → Spread → Cash-and-carry → Pick fills`
- Cancel (top-right) → `/`
- Back (top-left) → browser back
- Continue (bottom-right) → next step (disabled until required inputs satisfied)
- Draft persistence: shallow steps in URL params; deep steps (manual legs, vesting schedule) auto-save to a draft `activity` row with `status = 'draft'`

## Unified picker

The most product-critical page. Single page handling three workflows: confirm a matcher suggestion, build manually from imported positions, mix imported + manual legs.

### Layout

```
┌─ Header: Pick fills for cash-and-carry · funding ─────────────────────┐
│  ← Back to variant                                  Cancel  Continue → │
├────────────────────────────────────────────────────────────────────────┤
│  Suggested matches                                                     │
│  ──────────────────────────────────────────────────────────────────    │
│  Cards listing SpreadCandidate rows with reasons + [Use this] button   │
│                                                                        │
│  ───────── or build the spread yourself ─────────                     │
│                                                                        │
│  ┌─ Your imported positions ──────┐  ┌─ Your spread ─────────────┐    │
│  │ [Search] [Venue ▾] [Date ▾]    │  │ Leg 1: BTC spot · Coinb.   │   │
│  │ Multi-select Position list     │  │  long · 0.500 · $47.3k     │   │
│  │ Sortable columns               │  │  [× Remove]                │   │
│  │ [+ Add a manual leg]           │  │                            │   │
│  │                                │  │ Leg 2: + Add another leg   │   │
│  │                                │  │                            │   │
│  │                                │  │ Auto-detected:             │   │
│  │                                │  │  cash-carry funding (92%)  │   │
│  │                                │  │ ⚠ Need 1 more leg          │   │
│  └────────────────────────────────┘  └────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### Behaviors

| Trigger | Effect |
|---|---|
| Click **Use this** on a suggestion | All proposed legs populate right-rail. Continue button enables. |
| Click **Reject** on a suggestion | Suggestion hides. `SpreadCandidate.state = rejected` persisted. |
| Check a Position in the list | Added as a leg to right-rail. Auto-detection + validation re-run. |
| Click **+ Add a manual leg** | Inline form appears (slides into right rail): venue, instrument, side, qty, entry/exit, dates. Saved on blur. |
| Right-rail validation | Live: leg count, auto-detected subtype confidence, missing-leg warnings. |
| Continue button | Disabled until validation passes (leg count + subtype-shape match). |

### Empty states

- **No connected exchanges**: Suggestions panel shows "Connect an exchange to get auto-matched suggestions" + CTA. Positions list shows "No imported positions yet" + hint pointing to + Add a manual leg.
- **Connected but no matches**: Suggestions panel shows "No likely matches found in the last 90 days." Positions list browseable for manual selection.

## Per-activity detail page templates

All four share editorial template family. Title block + meta strip + hero metric + middle sections + postmortem.

### Spread detail (`/spreads/[id]`) — existing

Current `/spreads/demo` template. Hero metric in signature amber, decomposition bars, funding bars + basis line charts, legs comparison table, postmortem with verdict row. No changes besides query refactor to `activity` + `activity_spread`.

### Trade detail (`/trades/[id]`) — new

Single leg, single venue. Drops the leg comparison table and funding/basis charts. Adds an Execution section reading slippage + time-to-fill from the linked Position.

Sections: Title → Meta → Hero metric (realized APR) → Thesis → Execution (single leg) → Postmortem.

### Sale detail (`/sales/[id]`) — new

Hero metric is **MTM multiplier** (current value / paid). Vesting schedule visualization is the centerpiece: TGE marker, cliff bar, linear-vest gradient, vested-today %, claim events plotted. Plus claim-history table and an Add claim affordance.

Sections: Title → Meta → Hero (MTM mult) → Vesting timeline → Claim history → Thesis + notes.

### Airdrop detail (`/airdrops/[id]`) — new

Hero metric is the qty + token. Receipt detail + valuation evolution.

Sections: Title → Meta → Hero (qty received) → Receipt detail (snapshot, eligibility, claim tx, value at claim) → Valuation (current vs claim) → Thesis + notes.

## Open-source operations

### Repo

- **Rename:** `crypto-spread-journal` → `crypto-journal`. Update package.json, READMEs, GitHub URL.
- **GitHub:** create public repo under the user's account; push the existing history.
- **License:** **MIT** — text in `LICENSE`, header reference in `package.json`.
- **Tagline:** "An editorial trading journal for serious crypto traders. Self-hosted, exchange-aware, never sells your data."

### Repo files (additions)

```
LICENSE                       MIT
README.md                     rewrite (tagline, screenshot, quick start, security, exchanges)
CONTRIBUTING.md               adapter writing guide, test running, feature proposals
SECURITY.md                   responsible disclosure; CREDENTIALS_MASTER_KEY threat model
CODE_OF_CONDUCT.md            standard
docker-compose.yml            postgres + web + worker
Dockerfile.web                Next.js standalone build
worker/Dockerfile             Python uv-based
.github/workflows/ci.yml      typecheck · test · lint · build
.github/workflows/release.yml docker image publish to ghcr.io on tags
.github/ISSUE_TEMPLATE/       bug · feature · adapter-request · question
```

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/crypto-journal/main/install.sh | sh
```

Generates `CREDENTIALS_MASTER_KEY`, sets up Postgres volume, runs `docker compose up -d`, prints the URL.

### Demo deployment

Public demo at a domain to be picked (e.g., `demo.crypto-journal.dev` — domain selection deferred until repo is named on GitHub). Fixture data only. Read-only — exchanges connection disabled. Lets prospective adopters see the journal before installing.

## Implementation decomposition

Single-design-doc, multi-plan-doc execution. Each chunk gets its own `docs/specs/2026-MM-DD-<chunk>.md` implementation plan when work begins.

1. **Schema migration** — `activity` supertype + 3 new subtype tables, view rebuild, types regen, API back-compat. ~30 files. One session.
2. **Cross-activity archive + dashboard** — extend `/archive` with Activity-type chip row; rebuild `/` to be `The Book` (activity-agnostic); sidebar update; saved-view URLs update. ~10 files. One session.
3. **`/add` wizard scaffold + Trade flow end-to-end** — wizard chrome (breadcrumb/cancel/back), routes, draft persistence, Trade picker + Trade journal. Trade detail page. Proves the pattern.
4. **Sale + Airdrop flows + detail pages** — multi-step manual forms, vesting timeline component, claim-events JSONB editing.
5. **Spread wizard + unified picker with matcher integration** — the hard one. Suggestions panel rendering `SpreadCandidate` rows, browse + multi-select, manual-leg inline form, right-rail composition + validation.
6. **Open-source repo setup** — rename, license, README, CONTRIBUTING, docker-compose, GitHub workflows, demo deploy.
7. **Phase 5 worker** (the deferred backend) — ccxt-based ingestion, fills → Postgres, position aggregation, matcher invocation. Unblocks "from-exchange" UX for users.

## Out of scope for v1 (intentionally deferred)

- **Multi-user-per-instance** — single tenant is the default; multi-user opt-in is a v1.1 toggle.
- **Stripe billing / hosted SaaS** — open-source self-host only; hosted version is a possible later product.
- **Activity types beyond the core 4** — Staking, Lending, LP/Yield farming, Liquidation-as-its-own-type, OTC, NFT trades. Schema extends cleanly.
- **Cmd+K command palette** — useful but not required for v1.
- **Mobile-optimized layouts** — desktop-first; mobile is a later concern.
- **Importable price-history MTM for Sales/Airdrops** — manual entry of current price in v1; auto-MTM later.
- **Tax export reports** — out of scope; users use Koinly/Coinpanda for tax.

## Risks & open questions

- **Schema migration touches 30+ files.** Risk: subtle bug in spread-PnL view rebuild. Mitigation: do migration with full test suite running, screenshot the dashboard before + after.
- **Vesting schedule JSONB shape.** Risk: drift between TS Zod schema, Pydantic schema, and DB checks. Mitigation: single canonical shape declared in `canonical.ts` + Zod runtime validation at API boundary.
- **Matcher returning low-confidence noise.** Risk: suggestions panel becomes a graveyard. Mitigation: cutoff confidence threshold (e.g., > 0.6) for inclusion; lower-confidence matches are reachable through manual browse.
- **`/add` draft persistence.** Risk: orphaned draft rows accumulate if users abandon mid-wizard. Mitigation: drafts auto-expire after 7 days via a periodic cleanup job.
- **Currency normalization.** All `*_usd` fields assume USD. If a user trades USDT-quoted on Bybit, do we convert at the time of fill? At report time? Decision: time of fill (immutable). Spec this in `docs/vocabulary.md`.
- **Position deletion when underlying fills are dropped.** Risk: orphaned `activity_trade.position_id` references. Mitigation: ON DELETE RESTRICT — deleting a Position is blocked if it's linked to an activity_trade.

## Approval

| Section | Status |
|---|---|
| 1 — Data model | ✅ Approved 2026-05-16 |
| 2 — IA + dashboard | ✅ Approved 2026-05-16 |
| 3 — Wizard flows | ✅ Approved 2026-05-16 (with addendum: source picker dropped, unified picker is the entry point for Spread/Trade) |
| 4 — Unified picker | ✅ Approved 2026-05-16 |
| 5 — Detail pages + OSS ops | ✅ Approved 2026-05-16 |
