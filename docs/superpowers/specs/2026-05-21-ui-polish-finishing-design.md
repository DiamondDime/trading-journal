# Sub-project A — UI Polish & Finishing

**Date:** 2026-05-21
**Status:** Approved — in implementation
**Initiative:** "Complete crypto journal" — four sub-projects: **A · UI polish & finishing**, B · Desktop sync engine, C · Tax & P&L reporting, D · Alerts & reminders.

## Context

The app is already feature-built: seven activity types with working create wizards, a dashboard, a full analytics suite, balances, the leg matcher, exchange connections, and EN/RU locales. A four-agent codebase audit found the gap is not missing features — it is rough edges. This sub-project takes the app from "works, with rough edges" to "feels genuinely finished."

### Locked decisions (from brainstorming Q&A)

- **Product scope:** single-user, local, polished desktop app (plus the self-hosted web version). No auth, no billing, no multi-tenancy.
- **Mobile:** out of scope. It is a desktop app — set a minimum Electron window size so the layout never collapses; do not build phone/tablet layouts.
- **Sequencing:** this sub-project (A) ships before B, C, and D.

## Scope

No new product surface. Complete what already exists. Four workstreams.

### Workstream 1 — Kill dead ends

Interactive elements that do nothing erode trust the most.

1. **Regime "Bulk Tag" button** (`src/app/analytics/regime/page.tsx:160`) — an inert `<span>` today. Implement a minimal, real bulk-tag flow: select untagged activities, apply a tag, via a server action, reusing existing tag infrastructure.
2. **`href="#"` dead link** (`src/app/movement-events/[id]/page.tsx:130`) — the header summary card is a `<Link href="#">`. Render it as a plain non-navigating element.
3. **Airdrop "Fetch from wallet"** — on-chain import is a stub (`src/lib/onchain/claims.ts`) and on-chain tracking is out of scope. Remove the "Fetch from wallet" option from the airdrop wizard, delete the `add/airdrop/wallet/` route, and delete the now-orphaned onchain claims lib + `api/onchain/claims/` route.

### Workstream 2 — Functional correctness

Pages that work but show wrong or incomplete data.

1. **Spread detail synthetic legs** (`src/app/spreads/[id]/page.tsx`, `deriveLegs()` near line 63) — fabricates a two-leg display instead of reading real `spread_legs`. Query and render actual `spread_legs` rows; fall back to derivation only when a spread genuinely has no leg rows. Verify the manual spread wizard persists legs.
2. **Funding P&L not rolled up** — spread detail shows only activity-level `net_pnl_usd`, ignoring per-leg `funding_events`. Aggregate funding onto the spread detail. Money math uses `decimal.js`; decimals stay strings.
3. **Leg matcher has no reject** — candidates can be accepted but not dismissed. Add `PATCH /api/spreads/candidates/[id]` to set `state = 'rejected'`, plus a reject button on the pick page so dismissed candidates leave the list.

### Workstream 3 — Loading & error states

1. **Blank-flash on navigation** — `Suspense fallback={null}` on the archive, notes, and views pages. Replace with skeleton fallbacks.
2. **Analytics has no loading state** — add `src/app/analytics/loading.tsx`.
3. **Only a root error boundary** — add per-section `error.tsx` for analytics, settings, and balances.

### Workstream 4 — Visual & accessibility consistency

1. **Dark mode** — verify every chart (Recharts + lightweight-charts) renders correctly in dark mode; replace hardcoded colors with CSS variables.
2. **Accessibility** — interactive `<span>`s become `<button>`s; add a skip-link; add landmark regions; `aria-sort` on sortable tables; make the sidebar keyboard-reachable.
3. **Minimum window size** — set a minimum Electron `BrowserWindow` size so the desktop layout never collapses.

## Out of scope

Desktop sync engine (sub-project B), tax reporting (C), alerts (D), phone/tablet layouts, on-chain tracking.

## Definition of done

- No inert or dead UI elements remain.
- Every page has loading and error states.
- Spread detail renders real `spread_legs` data and rolled-up funding.
- Dark mode verified on all charts.
- `pnpm typecheck` and `pnpm test:run` are green.
- A Chrome DevTools visual pass on every route.

## Implementation approach

Five file-partitioned workstreams are executed by parallel agents, then integrated, verified (typecheck + tests + a Chrome visual pass), and adversarial-reviewed before commit.
