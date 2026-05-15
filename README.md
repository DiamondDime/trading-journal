# Crypto Spread Journal

Private, invite-only spread-specialist crypto trading journal. The atomic unit is a **SPREAD** — a multi-leg, often multi-venue trade.

## What's built (Phase 0–6, partial Phase 2 + 8)

### Backend
- **9 Postgres migrations** with RLS on every user table, encrypted credentials via Supabase Vault, materialized views for daily PnL
- **3 exchange adapters** (Python, ccxt + custom): Binance, Bybit, Hyperliquid — 35 tests passing
- **Leg matcher** with 5 spread-type rules (TDD, 28/28 tests pass) + dedup engine
- **Canonical models** in TypeScript (branded IDs, Decimal=string) + Python (Pydantic v2)
- **API routes** (Next.js App Router): exchanges, spreads, candidates accept/reject, admin allowlist
- **Auth**: Supabase magic-link + middleware + allowlist trigger + login page

### What's NOT built yet
- Worker orchestrator (Python service that polls connections and triggers adapter sync) — Phase 5
- Position-builder (folds fills into positions) — part of Phase 5
- Live PnL / WebSocket — v2
- Telegram bot — v2
- Tax export — v2
- Notes/media upload endpoints — Phase 9 (DB schema exists; endpoints not wired)
- Integration tests (E2E) — Phase 10
- Adversarial review pass — Phase 12

## Quick start

### Prerequisites
- pnpm 10+
- Python 3.12+
- uv (Python package manager)
- Docker (only for local Supabase dev — Supabase cloud works without)

### 1. Install dependencies
```bash
pnpm install                          # Next.js side
cd worker && uv sync --extra dev && cd ..  # Python worker side (--extra dev pulls pytest/ruff/mypy)
```

### 2. Set up Supabase

**Option A — Local (needs Docker)**:
```bash
pnpm db:start                         # starts local Postgres + Auth + Storage
pnpm db:reset                         # apply migrations
pnpm db:types                         # generate src/types/database.types.ts
```

**Option B — Cloud (no Docker)**:
1. Create a project at supabase.com
2. `pnpm exec supabase link --project-ref <your-ref>`
3. `pnpm exec supabase db push` to apply migrations
4. `pnpm exec supabase gen types typescript --linked > src/types/database.types.ts`

### 3. Configure env
```bash
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Service-role key + DB URL goes in worker/.env (NEVER in Vercel env)
```

### 4. Seed yourself as admin
After Supabase is up:
```sql
INSERT INTO public.allowlist (email, role) VALUES ('you@example.com', 'admin');
```

### 5. Run

```bash
pnpm dev                              # Next.js dev server (http://localhost:3000)
cd worker && uv run pytest            # run all worker tests
```

## Project layout

```
crypto-spread-journal/
├── src/
│   ├── app/                          # Next.js routes
│   │   ├── api/                      # API routes (exchanges, spreads, admin)
│   │   ├── auth/                     # login + callback
│   │   ├── spreads/                  # spread list (placeholder)
│   │   └── page.tsx                  # redirect-by-auth landing
│   ├── lib/
│   │   ├── api/                      # response envelope + handler wrappers
│   │   ├── auth/                     # server-side auth helpers
│   │   ├── supabase/                 # SSR + middleware clients
│   │   └── db/                       # Zod schemas
│   ├── types/
│   │   ├── canonical.ts              # source of truth at app layer
│   │   └── database.types.ts         # auto-generated from schema
│   └── middleware.ts                 # auth gate
├── worker/                           # Python ingestion service
│   ├── csj_worker/
│   │   ├── adapters/                 # Binance, Bybit, Hyperliquid + base ABC
│   │   ├── matcher/                  # leg matcher (5 rules + engine)
│   │   └── types.py                  # Pydantic mirror of canonical.ts
│   └── tests/                        # pytest suite (63 passing)
├── supabase/
│   └── migrations/                   # 9 numbered SQL migrations
├── docs/specs/
│   └── 2026-05-15-architecture.md    # full architecture spec
└── tests/                            # Vitest TS tests
```

## Tests

```bash
pnpm test:run                         # Vitest (TS)
cd worker && uv run python -m pytest  # pytest (Python) — use `python -m` so it runs in uv venv
```

Current: 63 Python tests pass (35 adapters + 28 matcher). TS typecheck passes.

## Security defaults

1. **Service-role key on Hetzner worker only.** Never in Vercel env.
2. **API keys decrypted only on Hetzner** via `worker_get_exchange_credentials()`.
3. **Read-only enforcement.** Adapters reject `withdraw` permission at `connect()`.
4. **RLS everywhere.** Every user-data table.
5. **Magic-link 10 min TTL, single-use, PKCE.** Configure in Supabase Auth.
6. **Vault-stored secrets.** Plaintext only momentarily in Next.js on key creation.

See `docs/specs/2026-05-15-architecture.md` § Security model.

## Adding a new exchange (~2–5 days)

1. Add row to `exchange_catalog` (new migration).
2. Create `worker/csj_worker/adapters/<exchange>.py` extending `ExchangeAdapter`.
3. Implement `connect`, `validate_credentials`, `fetch_fills`, `fetch_funding_events`, `fetch_open_positions`.
4. Write fixture-based tests in `worker/tests/adapters/test_<exchange>.py`.
5. Register adapter in `worker/csj_worker/adapters/__init__.py` and worker bootstrap.

Adapter contract (`base.py`) is the abstraction boundary — matcher, position builder, PnL are exchange-agnostic.

## License
Private. No license granted.
