@AGENTS.md

# Crypto Spread Journal — project notes

Private, single-user spread-specialist trading journal. Atomic unit = SPREAD (multi-leg, multi-venue trade). Runs locally against your own Postgres.

## Quick facts
- **Stack**: Next.js 16 + TS + Tailwind v4 + local Postgres (postgres.js) + Python worker (ccxt) on Hetzner.
- **Auth (v1)**: Single user via `APP_USER_ID` env var. No login UI. `auth.uid()` simulated locally by a shim migration.
- **v1 exchanges**: Binance, Bybit, Hyperliquid. Adapter framework supports all 13.
- **Critical security**: AES-256-GCM at-rest encryption for API keys (`CREDENTIALS_MASTER_KEY`). Plaintext keys never leave the server-side request handler. Reject API keys with withdraw permission at `connect()`.

## Where things live
- `supabase/migrations/` — DB schema (10 files, 2026-05-15). Path retained for stability; not tied to Supabase anymore.
  - `20260515000000_local_postgres_shim.sql` — creates `auth` schema, `auth.uid()`, and `authenticated`/`service_role` roles locally.
- `src/lib/db/client.ts` — postgres.js singleton with camelCase transform + bytea handling.
- `src/lib/auth/server.ts` — v1 single-user auth (reads `APP_USER_ID`).
- `src/lib/crypto/credentials.ts` — AES-256-GCM helpers (Node `crypto`).
- `src/types/canonical.ts` — TS source of truth (mirror of Postgres).
- `worker/csj_worker/crypto.py` — Python mirror of credential encryption (`cryptography.AESGCM`).
- `worker/csj_worker/types.py` — Python mirror, byte-identical enum values.
- `worker/csj_worker/adapters/base.py` — `ExchangeAdapter` ABC.
- `docs/specs/2026-05-15-architecture.md` — full architecture spec (note: pre-Postgres-pivot, some Supabase references).

## Conventions
- **Decimals as strings.** Never `number` for money/qty. Use `decimal.js` at UI edge.
- **Branded IDs** in TS (SpreadId, FillId, etc) — compile-time safety.
- **Pydantic v2** in Python with `extra='forbid'` everywhere.
- **One-to-one** Note ↔ Spread in v1.
- **Adapter `fetch_fills` returns async iterator of pages** — Hyperliquid can dump 10K/call.

## Common commands
```bash
# Frontend
pnpm dev               # Next.js dev server (http://localhost:3000)
pnpm typecheck         # tsc --noEmit
pnpm test              # Vitest watch
pnpm test:run          # Vitest run once
pnpm test:coverage     # with coverage

# DB
pnpm db:create         # createdb crypto_spread_journal
pnpm db:migrate        # apply supabase/migrations/*.sql in order
pnpm db:reset          # drop + create + migrate
pnpm db:psql           # interactive shell

# Worker
cd worker && uv sync   # install deps
cd worker && uv run pytest
cd worker && uv run python -m csj_worker.main
```

## v1 ship checklist
See `docs/specs/2026-05-15-architecture.md` § "Out of scope" for v2/v3.
