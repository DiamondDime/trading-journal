@AGENTS.md

# Crypto Spread Journal — project notes

Private, invite-only spread-specialist trading journal. Atomic unit = SPREAD (multi-leg, multi-venue trade).

## Quick facts
- **Stack**: Next.js 16 + TS + Tailwind v4 + Supabase + Python worker (ccxt) on Hetzner.
- **Auth**: Supabase magic-link + admin allowlist (RLS everywhere).
- **v1 exchanges**: Binance, Bybit, Hyperliquid. Adapter framework supports all 13.
- **Critical security**: Service-role key on Hetzner worker only. Plaintext API keys NEVER decrypted in Next.js. Reject API keys with withdraw permission.

## Where things live
- `supabase/migrations/` — DB schema (9 files, 2026-05-15)
- `src/types/canonical.ts` — TS source of truth (mirror of Postgres)
- `worker/csj_worker/types.py` — Python mirror, byte-identical enum values
- `worker/csj_worker/adapters/base.py` — ExchangeAdapter ABC
- `docs/specs/2026-05-15-architecture.md` — full architecture spec

## Conventions
- **Decimals as strings.** Never `number` for money/qty. Use `decimal.js` at UI edge.
- **Branded IDs** in TS (SpreadId, FillId, etc) — compile-time safety.
- **Pydantic v2** in Python with `extra='forbid'` everywhere.
- **One-to-one** Note ↔ Spread in v1.
- **Adapter `fetch_fills` returns async iterator of pages** — Hyperliquid can dump 10K/call.

## Common commands
```bash
# Frontend
pnpm dev               # Next.js dev server
pnpm typecheck         # tsc --noEmit
pnpm test              # Vitest watch
pnpm test:run          # Vitest run once
pnpm test:coverage     # with coverage

# DB
pnpm db:start          # supabase start (needs Docker)
pnpm db:reset          # apply all migrations from scratch
pnpm db:types          # regenerate src/types/database.types.ts

# Worker
cd worker && uv sync   # install deps
cd worker && uv run pytest
cd worker && uv run python -m csj_worker.main
```

## v1 ship checklist
See `docs/specs/2026-05-15-architecture.md` § "Out of scope" for v2/v3.
