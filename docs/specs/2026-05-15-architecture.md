# Crypto Spread Journal — Architecture Spec

**Created**: 2026-05-15
**Status**: v1 in implementation
**Spec author**: Claude (Opus 4.7) under user direction

## Product summary

A private/invite-only crypto trading journal where the atomic unit is a **SPREAD** — a multi-leg, often multi-venue trade. Differentiates from TradeZella, Tradervue, Edgewonk, TraderSync, TradesViz, TraderMake.Money — none of which model spreads as a first-class entity. Identified gap: no existing tool treats multi-leg multi-venue trades as one analyzable unit, attributes funding correctly across the lifecycle, or surfaces APR as the primary performance metric.

## High-level architecture

```
                       ┌─────────────────────────┐
                       │   User (web browser)    │
                       └────────────┬────────────┘
                                    │ HTTPS
                       ┌────────────▼────────────┐
                       │   Next.js 16 (Vercel)   │
                       │   - App Router          │
                       │   - API routes          │
                       │   - Server Components   │
                       │   - Magic-link auth UI  │
                       └────────────┬────────────┘
                                    │
                       ┌────────────▼────────────┐
                       │   Supabase (managed)    │
                       │   - Auth (magic link)   │
                       │   - Postgres + RLS      │
                       │   - Vault (secrets)     │
                       │   - Storage (files)     │
                       └─────┬──────────────┬────┘
                             │              │
                             │  ┌───────────▼──────────┐
                             │  │  Hetzner Python      │
                             │  │  ingestion worker    │
                             │  │  - ccxt for CEX      │
                             │  │  - custom for DEX    │
                             │  │  - canonical models  │
                             │  │  - leg matcher       │
                             │  │  - position builder  │
                             │  └────────┬─────────────┘
                             │           │
                       ┌─────▼───────────▼─────┐
                       │   13+ exchange APIs   │
                       │   (Binance, Bybit,    │
                       │    Hyperliquid, ...)  │
                       └───────────────────────┘
```

### Trust zones
1. **Browser** — untrusted. Receives only data scoped to the authenticated user.
2. **Vercel (Next.js)** — semi-trusted. Holds Supabase anon key + user JWTs. NEVER holds: service-role key, plaintext API keys/secrets, decryption capability.
3. **Hetzner worker** — most-trusted. Holds service-role key. Only zone that decrypts user API keys; uses them briefly to call exchanges, then zeros memory.
4. **Supabase** — assumed-eventually-breached. All sensitive data is encrypted at rest (Vault for API secrets, pgsodium AEAD for wallet addresses) so a DB compromise yields ciphertext only.

## Canonical data model

The atomic unit is a **Spread** — N positions linked as one strategy.

```
Fill (one exchange execution)
  ↓ aggregated by position-builder
Position (one logical position on one instrument)
  ↓ matched into spread by leg-matcher
SpreadLeg (one position in a Spread, with role label)
  ↓ N legs make up...
Spread (multi-leg strategy)
```

Plus:
- **FundingEvent** — per funding payment, linked to position, attributed to spread via spread_leg.
- **SpreadCandidate** — matcher's proposal awaiting user accept/reject.
- **Note**, **NoteAttachment** — user-facing markdown + screenshots per spread.
- **Tag**, **SpreadTag** — controlled-vocabulary tags.
- **SavedView** — persisted filters for spread/position/fill list.

Full schema in `supabase/migrations/`. Canonical TypeScript types in `src/types/canonical.ts`. Python mirror in `worker/csj_worker/types.py`.

## Adapter pattern

Every exchange supported by one `ExchangeAdapter` implementation. The ABC defines:

```python
class ExchangeAdapter(ABC):
    exchange: Exchange
    auth_mode: AuthMode  # API_KEY | WALLET_ADDRESS
    capabilities: AdapterCapabilities
    rate_limit: RateLimitPolicy

    async def connect(creds) -> ConnectionStatusResult: ...
    async def validate_credentials(creds) -> bool: ...
    def fetch_fills(creds, since, until) -> AsyncIterator[list[CanonicalFill]]: ...
    def fetch_funding_events(creds, since, until) -> AsyncIterator[list[CanonicalFundingEvent]]: ...
    async def fetch_open_positions(creds) -> list[CanonicalPosition]: ...
```

CEX adapters take `ApiKeyCredentials`. DEX adapters take `WalletCredentials`. The matcher, position builder, and PnL computer are exchange-agnostic — they operate on canonical models only.

**v1 adapters**: Binance, Bybit, Hyperliquid.
**v2 adapters** (each ~2–5 days work given framework): OKX, Deribit, OKX DEX, Aster, Phemex, Bitget, MEXC, KuCoin, Kraken, Gate, BingX.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind v4 |
| State / data | Supabase JS client (`@supabase/ssr` for SSR) + Server Components |
| Validation | Zod 4 |
| Decimals | `decimal.js` (string serialization wire-side) |
| Backend (API routes) | Next.js API routes (App Router) |
| Database | Supabase Postgres (managed) |
| Auth | Supabase Auth (magic-link), admin allowlist enforced via DB trigger |
| Secrets | Supabase Vault (v1), envelope encryption + KMS (v2 if public) |
| Storage | Supabase Storage (private buckets, signed URLs) |
| Ingestion | Python 3.12, FastAPI (admin endpoints) + scheduler |
| Exchange APIs | ccxt for CEX, custom adapters for DEX |
| Test | Vitest (TS), pytest (Python) |
| Deploy | Vercel (Next.js), Hetzner (Python worker) |
| Package mgmt | pnpm 10 (TS), uv (Python) |

## Security model

(See full threat model in adjacent doc and CLAUDE.md research notes.)

### Critical defaults

1. **Service-role key on Hetzner worker only.** Never in Vercel env. Next.js uses anon key + user JWT.
2. **API keys/secrets in Supabase Vault.** Connection rows hold opaque secret UUIDs.
3. **Plaintext decryption only on Hetzner.** Worker fetches via `worker_get_exchange_credentials(connection_id)` security-definer function (service-role only).
4. **Read-only API key enforcement.** Adapter `connect()` checks reported permissions; rejects keys with `withdraw` scope at connect time.
5. **RLS on every user-data table.** Tested via pgTAP. All policies: `user_id = auth.uid()`.
6. **Magic-link OTP**: 10 min expiry, single-use, PKCE.
7. **Cookies**: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
8. **CSP** nonce-based, no inline scripts.
9. **Markdown rendering** via `react-markdown` + `rehype-sanitize` with strict allowlist.
10. **Wallet addresses** encrypted at column level via pgsodium AEAD.

### v1 → v2 security migration path
- v1 uses Supabase Vault (pgsodium-backed). Acceptable for private/invite-only.
- v2 migration if going public: envelope encryption with external KMS (AWS KMS recommended). DEKs wrap-encrypted in KMS, encrypted payload in DB. Worker decrypts via KMS at runtime.
- The `worker_get_exchange_credentials()` function is the abstraction boundary — only that function changes.

## Auth flow (invite-only)

1. Admin adds email to `allowlist` via `/api/admin/allowlist`.
2. User visits `/login`, enters email.
3. Server checks allowlist; if absent, responds 200 anyway (anti-enumeration) but doesn't send a link.
4. If allowed, Supabase sends magic link.
5. User clicks link → `/api/auth/callback` → session cookie set.
6. DB trigger `handle_new_user` enforces allowlist server-side at signup (defense in depth), creates `profiles` row.
7. RLS policies enforce per-user data isolation thereafter.

## Sync flow

1. User adds exchange connection via `POST /api/exchanges`. API route:
   - Creates `exchange_connections` row with status='pending'.
   - Calls `store_exchange_api_credentials()` (or `store_wallet_address()`) to put plaintext into Vault.
   - Plaintext is GC'd by Node runtime shortly after.
   - Returns 201.
2. Worker polls `exchange_connections WHERE status='active' AND last_sync_at < now() - interval '5 min'`.
3. For each due connection:
   - Worker fetches plaintext via `worker_get_exchange_credentials()`.
   - Worker calls adapter's `fetch_fills()` and `fetch_funding_events()` with windowed cursor.
   - Each page of canonical fills/funding written via UPSERT (idempotent on `raw_exchange_id`).
   - Position-builder folds fills into positions (FIFO/LIFO accounting in worker code).
   - Leg-matcher scans new positions for spread candidates → writes `spread_candidates`.
   - Spread cached aggregates (gross/funding/fees/net/APR) recomputed for any spreads touched.
   - `last_sync_at` updated, `sync_jobs` row finalized.
4. UI polls `/api/exchanges/:id/sync-status` while sync is running.

## Leg matcher

Heuristic rules (configurable):
- **Cross-Exchange Perp Arb**: same `(base, kind=perp)`, opposite `side`, on different `connection_id` with different `exchange_code`, opened within ±60s, qty within ±5%.
- **Cash-and-Carry**: same `base`, one `kind=spot` + one `kind=perp`, opposite directions, same `connection_id` (or different), within ±5 min, qty within ±2%.
- **Calendar**: same `base, kind=dated_future`, different `expiry`, opposite directions, same connection, qty within ±2%.
- **Funding Capture**: single `kind=perp` position held >24h with significant funding accrual (heuristic: funding > 5% of notional annualized).
- **DEX/CEX Arb**: same `base, kind=perp`, one `exchange_kind=dex` and one `exchange_kind=cex`, opposite directions, within ±5 min.

Confidence score (0–1) computed from: rule match quality (time delta, qty delta, exchange diversity, notional similarity). Matcher writes candidates to `spread_candidates` table; user accepts/rejects in UI.

## API contract

(Full contract in `docs/specs/api-contract.md` — derived from backend-architect output.)

Key endpoints:
- **Auth**: `POST /api/auth/magic-link`, `POST /api/auth/callback`
- **Exchanges**: `GET/POST/DELETE /api/exchanges`, `POST /api/exchanges/:id/sync`, `GET /api/exchanges/:id/sync-status`
- **Spreads**: `GET/POST /api/spreads`, `GET/PATCH/DELETE /api/spreads/:id`
- **Candidates**: `GET /api/spreads/candidates`, `POST /api/spreads/candidates/:id/accept`, `POST /api/spreads/candidates/:id/reject`
- **Fills**: `GET /api/fills?unmatched=true`
- **Analytics**: `GET /api/analytics/overview`, `GET /api/analytics/pnl-series`, `GET /api/analytics/breakdown`
- **Notes**: `POST/PATCH /api/notes/:id`, `POST /api/notes/:id/attachments`
- **Tags + Views**: `GET/POST /api/tags`, `GET/POST/PATCH/DELETE /api/saved-views`
- **Admin**: `GET/POST/DELETE /api/admin/allowlist`

Response envelope: `{ data, error }`. Errors: `{ error: { code, message, details? } }`.

## Decisions & trade-offs

| Decision | Trade-off |
|---|---|
| Supabase Vault for v1 secrets (not envelope+KMS) | Faster ship vs slightly weaker security posture if Supabase compromised. Acceptable for invite-only. Migration path defined. |
| Decimals as strings everywhere | Wire-format ugliness vs. avoiding f64 precision loss on BTC qty * USD price. |
| Branded TypeScript IDs | Compile-time safety on ID mixups (SpreadId vs FillId). Zero runtime cost. |
| Cached aggregates on `spreads` table | Write amplification on sync vs. fast list reads (APR sortable, no aggregation on read). |
| `Position` materialized from fills by worker | Single source of truth (fills) vs. need for compute step. Cached column on `positions` mitigates. |
| One-to-one Note per Spread | Simpler model vs. less flexible. Multi-note history can come in v2. |
| Adapter `fetch_fills` returns async iterator of pages | Backpressure support (Hyperliquid 10K rows/page) vs. simpler list. |
| Reject API keys with withdraw permission | Lower attack surface vs. minor user friction. Worth it. |
| RLS enforced on every user table | Strong tenancy isolation vs. occasional query verbosity. Non-negotiable. |
| Magic-link auth only (no password) | Better security model vs. requires email for every login. Fine for invite-only. |

## Out of scope (v1)

- Live PnL via WebSocket (deferred to v2)
- Telegram bot (deferred to v2)
- Tax export (deferred to v2)
- Mobile app (deferred to v3)
- AI Q&A on trade history (deferred to v3)
- Public marketing / SEO / signup flow (never — invite-only)

## Open questions (left for follow-up)

1. Match-confidence threshold for auto-confirm: should candidates above 0.95 confidence auto-create spreads, or always require user accept? Currently **always require accept** in v1.
2. Soft-delete recovery UI: should we add a "Trash" page for restoring soft-deleted spreads/connections? Currently no UI; admin SQL access only.
3. Multi-position legs (rolled positions): v1 supports one position per leg. Future: a rolled-into / split-out chain — represent as ordered position list per leg.
4. Cross-spread analytics (e.g., "all my BTC spreads"): supported via filter UI; no dedicated screen in v1.

## Where things live

- `supabase/migrations/` — 9 numbered SQL migrations
- `src/types/canonical.ts` — canonical TypeScript types (source of truth at app layer)
- `src/types/database.types.ts` — auto-generated from `supabase gen types`
- `src/lib/exchanges/` — exchange-related helpers, validation
- `src/lib/matcher/` — TypeScript port of matcher logic for manual spread composer UI
- `src/lib/analytics/` — PnL/APR formula helpers
- `src/lib/auth/` — auth helpers, middleware
- `src/lib/db/` — Supabase client helpers (anon + RPC)
- `src/app/` — Next.js app router routes (UI + API)
- `worker/` — Python ingestion service
- `worker/csj_worker/adapters/` — exchange adapters
- `worker/csj_worker/matcher/` — leg matcher (canonical)
- `tests/` — Vitest TS tests + pytest Python tests
- `docs/specs/` — this doc + API contract + adapter authoring guide
