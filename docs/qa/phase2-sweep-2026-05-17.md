# Phase 2 QA sweep — 2026-05-17

## Summary

- **Pages walked**: 29 / 29
- **Issues found**: 11 (4 fixed inline, 7 flagged)
- **Critical issues remaining**: 0 (one transient build error already healed by Wave 11.4 in flight)

The sweep ran concurrently with Wave 11 (OHLC chart) — a parallel agent
introduced + then resolved a klines.ts parse error during the walk. That error
is documented for completeness but is no longer present at the end of the
sweep. Verification was re-run after Wave 11.4 finished and the typecheck +
tests are clean.

## Verification

- `pnpm typecheck` — pass (no errors)
- `pnpm test:run` — pass (196/196 tests across 9 files, 1.73s)
- `pnpm e2e` — not run (no e2e change required by this sweep)
- DB + dev server: warm and healthy; all 65 activities + 4 detail-type routes
  resolved correctly.

## Page-by-page findings

### `/` redirect → `/spreads`
Status: passing. `curl` returns 307 → `/spreads`. No console errors.

### `/spreads` dashboard
Status: passing.

Walked:
- KPI row 1 (6 cards): Net P&L YTD, Activities Closed, Win Rate, Weighted
  Return, Best Activity, Worst Activity — all values render and reconcile
  against the underlying API at `/api/activities`.
- KPI row 2 (6 cards): Profit Factor 44.09, Payoff 4.32:1, Expectancy
  +$1,032.27, Max DD 41.3%, Loss Streak 2, Sharpe 8.58 — sensible numbers,
  helper copy correct.
- Calendar heatmap (13 weeks, all 91 cells have aria-labels with date + P&L).
- Funding ticker (10 rows, sorted by APR; "12s ago" badge static).
- Recent closes (8 of 65) — every row click-throughs to the correct detail
  route. `/spreads/`, `/trades/`, `/sales/`, `/airdrops/` variants all verified.
- Equity curve (recharts) renders with ATH dotted line.
- R-multiple distribution (17 buckets, median +3.71R).
- Performance by tag (3 distinct tags: breakout, london, scalp).
- Recent notes feed (2 notes click-through correctly).
- Activity mix (4 types) + Spread subtypes (5 types).

Issues:
- **[FIXED]** `Full year` link in heatmap header pointed to `#`. Replaced with
  a disabled `<span>` (`Coming soon`).
- **[FLAG]** `FILTER`, `EXPORT`, `SYNC` buttons in the page header are no-op
  decoration. They don't open dialogs, don't trigger network requests, and
  don't show disabled state. Either wire them up or change visual treatment.

### `/spreads/archive`
Status: passing.

Walked:
- Filter rail (5 chip groups: activity, type, asset, status, outcome).
  Clicking `TRADE · 22` filtered to 22 trade rows and updated URL to
  `?activity=trade`.
- Search box filters live with debounce — typing `BTC` reduces 22 trades to
  3 BTC trades, URL becomes `?activity=trade&q=BTC`.
- Table sort columns (`CAPITAL`, `HELD`, `CLOSED`, `HEADLINE`, `NET P&L`)
  are clickable.
- `TABLE` / `CARDS` view toggle present.
- `EXPORT CSV` button present.
- Results summary row shows `65 of 65 activities · +$67,307.36 · 92.3% WR ·
  $521,500 capital · +$1,035.50 avg`.
- Empty state: not directly exercised, but the matcher for `?activity=trade&q=NONEXISTENT`
  returns a non-broken render.

Issues:
- None blocking.

### `/spreads/demo`
Status: passing. Renders the editorial showcase ("BTC cash-and-carry").
H2s: Thesis / Decomposition / Execution / Legs / Postmortem.

### `/trades`, `/sales`, `/airdrops` alias redirects
Status: passing. All three return 307 to the correct
`/spreads/archive?activity=…` query.

### `/spreads/[id]` detail (verified with `72ca2022-…`)
Status: passing.

Walked: meta row, title block, hero metric, satisfaction toggle (▲ / — / ▼),
excursion R-units strip + Backfill button, Thesis, Decomposition table
(side, qty, prices, gross/fees/net, APR), Regime tags, Notes editor +
Save button, Tag editor + remove buttons + Add tag input, Screenshots
section + Add screenshot dialog button, Edit link, Delete button.

Edit link routes correctly to `/add/spread/fields?edit={uuid}`. Delete
button is a confirm-dialog trigger (not exercised destructively in QA).

### `/trades/[id]` detail (verified with `94603055-…`)
Status: passing. Same checklist as `/spreads/[id]`.

Tested: satisfaction toggle (clicked "Clean execution", reloaded — persisted
correctly; restored "No rating" afterward). Tag editor shows existing tags
(`breakout`, `london`). All sections render.

### `/sales/[id]` detail (verified with `9368bf31-…`)
Status: passing.

Sections: Allocation, Regime tags, Notes, Tags, Screenshots, Actions. (No
excursion strip — by design, since spot-only sales don't have intra-position
prices.) Edit link routes to `/add/sale/fields?edit={uuid}`.

### `/airdrops/[id]` detail (verified with `fe142bf3-…`)
Status: passing.

Sections: Thesis, Claim, Regime tags, Notes, Tags, Screenshots, Actions.
(No decomposition or excursion — airdrops have receipt-only economics.)
Edit link routes correctly.

### Detail-page 404 handling
- `/{trades,spreads,sales,airdrops}/00000000-0000-0000-0000-000000000000` →
  404 (not 500).
- `/trades/not-a-uuid` → 404.
- `/spreads/not-a-uuid` → 404. ✅

### `/add` type picker
Status: passing. 4 cards (Spread / Trade / Sale / Airdrop). Sale + Airdrop
correctly skip the source/pick step and go straight to `/add/sale/fields`
and `/add/airdrop/fields` (manual-only entries).

### `/add/trade/*` flow
- `/add/trade/source`: 2 cards (Auto / Manual). Correct routing.
- `/add/trade/pick`: ≥10 mock fills rendered. Click pre-fills correctly.
- `/add/trade/fields`: 16 inputs (exchange, symbol, instrument radio×3,
  side radio×2, capital, qty, entry, exit, fees, openedAt, closedAt, note,
  regimeTags). All labelled.
- `/add/trade/review`: shows the per-section breakdown with EDIT links per
  field; "Log trade" button.

### `/add/sale/*` flow
- `/add/sale/fields`: 16 inputs incl. saleKind radio×4, venue, asset, USD
  paid, tokens allocated, TGE date, TGE unlock %, vesting cliff/duration,
  current price, opened at, note, regime tags.
- `/add/sale/review`: "Log sale" button.

### `/add/airdrop/*` flow
- `/add/airdrop/fields`: 8 inputs (protocol, asset, tokens claimed, claim
  date, USD value at claim, current price, note, regime tags).
- `/add/airdrop/review`: "Log airdrop" button.

### `/add/spread/*` flow
- `/add/spread/source`: 2 cards (Auto matcher / Manual entry).
- `/add/spread/pick`: 5 matcher suggestions (each "USE THESE LEGS" link
  includes valid `legs=…&spreadType=…&matcher=auto` params) +
  manual builder with checkboxes.
- `/add/spread/type`: 5 cards (Cash-and-carry, Funding capture,
  Cross-exchange, Calendar, DEX-CEX) as `<label>` wrapping `sr-only`
  radio inputs. Fieldset+legend used (radiogroup semantics correct).
- `/add/spread/fields`: empty-state guard if no `legs` — shows "Pick some
  legs first" and back link. With valid legs → 14 inputs (hidden state +
  name, variant, opened/closed, capital, netPnl, headlineUnit radio, value,
  thesis, regimeTags).
- `/add/spread/review`: gated on prior steps; renders "Log spread" CTA.

### `/settings` redirect → `/settings/exchanges`
Status: passing.

### `/settings/exchanges`
Status: passing. List has Binance, Bybit, Hyperliquid + "Manual" sentinel
row. `ADD EXCHANGE` opens a 2-step dialog (Exchange picker → keys). Sync
+ Disconnect buttons per row.

### `/settings/profile`
Status: passing. Read-only stub showing single-user identity. No console
errors.

### `/settings/about`
Status: passing. Read-only stub. No console errors.

## Inline fixes applied (4 dead links across 3 files)

- `src/components/sidebar.tsx:38-61` — converted 6 dead `Link href="#"`
  entries (Calendar view, Track record, Activity mix, Regime distribution,
  Notes & marginalia, Saved views) into `<span aria-disabled="true">` with
  a small "soon" badge. Active routes (Overview, The archive, Exchanges)
  remain real links.
- `src/components/sidebar.tsx:117-185` — refactored render branch so disabled
  items render as `<span>` with `cursor-not-allowed` + tooltip.
- `src/components/site-header.tsx:18-28` — replaced 3 dead nav links
  (Currently held, The archive, Track record → all `href="#"`) with real
  routes (Overview, The archive, Exchanges). NB: the `SiteHeader`
  component is not currently imported anywhere — the fix protects future
  use rather than affecting any rendered page.
- `src/app/spreads/page.tsx:528-534` — replaced the dead "Full year"
  `Link` in the heatmap header with a disabled `<span>` matching the same
  styling so the click no-op doesn't surprise.

## Flagged for follow-up (ranked by severity)

1. **[MAJOR / WAVE-11 IN-FLIGHT]** During the sweep a parallel agent
   committed `src/lib/exchanges/klines.ts` with a Turbopack/SWC parse
   error (`TS1160: Unterminated template literal`) that broke any route
   importing it — including `/spreads/[id]`, `/add/spread/fields?…`,
   `/add/spread/review`, and downstream `/settings/*` because of the
   shared layout import chain. Wave 11.4 verification fixed it before
   the sweep finished (verified by re-running `pnpm typecheck` and
   reloading every affected route). Document this as a process risk —
   when running parallel agents on the same repo, the typecheck +
   chrome smoke must happen inside that agent's scope before the file is
   exposed to the dev server.

2. **[MAJOR]** Dashboard header buttons `FILTER`, `EXPORT`, `SYNC` are no-op
   decoration. They invite user clicks that do nothing. Either wire to real
   handlers or change to subtler visual treatment (e.g. ghost button with
   `aria-disabled`).

3. **[MAJOR]** Six sidebar features have no real route: Calendar view, Track
   record, Activity mix, Regime distribution, Notes & marginalia, Saved
   views. The inline fix converts them to disabled-styled spans, but the
   underlying features themselves are missing and the IA should decide
   whether to remove these links entirely or build the destinations.

4. **[MINOR]** `SiteHeader` component (`src/components/site-header.tsx`)
   is defined but never imported anywhere. Delete the file, or wire it
   into the public-facing landing route if one is planned. Current state
   is dead code.

5. **[MINOR]** Sidebar search box (`Search spreads, notes…` with `⌘K`
   kbd hint) has no handler — pressing `⌘K` doesn't open a palette,
   typing into the input doesn't trigger search. Either implement the
   palette or remove the input until it's ready.

6. **[MINOR]** Excursion R-units strip on detail pages shows "No excursion
   data yet" + Backfill button for closed activities. Need to confirm the
   Backfill action actually hits the kline endpoint and persists — not
   exercised destructively in this sweep. Wave 11 is the relevant track.

7. **[MINOR]** Wizard step indicators ("Step 1 of 4 / 2 of 4 / …") are
   visually present but not interactive — you can't click back to step 1
   from step 4. Acceptable UX for now; flagged so a future polish pass
   can decide.

## Accessibility light pass

- Every form input has a `<label>` (verified via `i.labels[0]`).
- Spread-type cards correctly use `<fieldset><legend>` + `name="spreadType"`
  radio inputs (radiogroup semantics).
- Sidebar settings link has `aria-label="Settings"`; theme toggle has
  `aria-label="Toggle theme"`.
- Modals (Add exchange, Add screenshot) open with `role="dialog"` and
  trap focus.
- Heatmap cells have descriptive aria-labels.

Not exercised: full keyboard-only navigation through the wizard end-to-end;
screen reader pass. Recommend a deeper a11y sweep before public launch.

## What I did NOT touch

- Wave 11 files (`src/lib/exchanges/`, `src/app/api/activities/[id]/klines/`,
  `src/components/activity/ohlc-chart.tsx`, `src/app/spreads/[id]/page.tsx`,
  `src/app/trades/[id]/page.tsx`, `package.json`, `pnpm-lock.yaml`,
  `tests/unit/klines.test.ts`) — Wave 11.4 owns these.
- Test files — no test changes required by this sweep.
- DB / migrations — no schema changes.
