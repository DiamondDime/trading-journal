# Crypto Spread Journal

Private, single-user spread-specialist crypto trading journal. The atomic unit is a **SPREAD** — a multi-leg, often multi-venue trade. Runs locally against your own Postgres.

## What's built

### Backend
- **9 Postgres migrations** — exchange catalog, profiles, encrypted credentials, fills/funding, positions, spreads, tags, notes, RLS policies, computed views (`spread_pnl`, daily PnL materialized view)
- **3 exchange adapters** (Python + ccxt + custom httpx): Binance, Bybit, Hyperliquid — 35 tests
- **Leg matcher** with 5 spread-type rules (TDD, 28 tests) + dedup engine
- **Canonical models** in TypeScript (branded IDs, `Decimal = string`) + Python (Pydantic v2)
- **API routes** (Next.js App Router): exchanges, spreads, candidates accept/reject, admin allowlist
- **App-layer AES-256-GCM** credential encryption (Node `crypto` + Python `cryptography`)

### What's NOT built yet
- Worker orchestrator (polls connections, runs adapters, writes fills, runs matcher) — Phase 5
- Position-builder (folds fills into positions) — Phase 5
- Live PnL / WebSocket — v2
- Tax export — v2
- Notes/media upload endpoints — Phase 9 (schema exists; endpoints not wired)
- Integration tests (E2E) — Phase 10

## Quick start

### Prerequisites
- macOS with Homebrew (or any Linux with postgresql 14+)
- `postgresql@14` running (`brew services start postgresql@14`)
- pnpm 10+
- Python 3.12+
- uv (Python package manager)

### 1. Install dependencies
```bash
pnpm install
cd worker && uv sync --extra dev && cd ..
```

### 2. Create + migrate the database
```bash
pnpm db:create     # createdb crypto_spread_journal
pnpm db:migrate    # apply all SQL files in supabase/migrations/ in order
```

`db:reset` drops + recreates + remigrates in one shot if you want to start clean.

### 3. Configure env
```bash
cp .env.example .env.local
# DATABASE_URL — connection string (default: postgresql://$USER@localhost:5432/crypto_spread_journal)
# CREDENTIALS_MASTER_KEY — `openssl rand -base64 32`
# APP_USER_ID — filled in step 4
```

Copy the same `DATABASE_URL`, `CREDENTIALS_MASTER_KEY` and `APP_USER_ID` into `worker/.env`.

### 4. Seed yourself
```sql
-- pnpm db:psql
INSERT INTO public.allowlist (email, role) VALUES ('you@example.com', 'admin');
INSERT INTO auth.users (email) VALUES ('you@example.com') RETURNING id;
-- copy that UUID into .env.local as APP_USER_ID
```

The `auth.users` insert fires the `handle_new_user` trigger that creates the matching `profiles` row.

### 5. Run
```bash
pnpm dev                       # http://localhost:3000/spreads
cd worker && uv run pytest     # worker tests
```

## Project layout

```
crypto-spread-journal/
├── src/
│   ├── app/
│   │   ├── api/                      # exchanges, spreads, candidates, admin/allowlist
│   │   └── spreads/                  # server-rendered spread list
│   ├── lib/
│   │   ├── api/                      # response envelope + withAuth/withAdmin wrappers
│   │   ├── auth/                     # APP_USER_ID-based v1 auth
│   │   ├── crypto/                   # AES-256-GCM credential helpers
│   │   └── db/                       # postgres.js singleton + Zod schemas
│   └── types/
│       └── canonical.ts              # source of truth at app layer
├── worker/                           # Python ingestion service
│   ├── csj_worker/
│   │   ├── adapters/                 # Binance, Bybit, Hyperliquid + base ABC
│   │   ├── matcher/                  # leg matcher (5 rules + engine)
│   │   ├── crypto.py                 # AESGCM mirror of src/lib/crypto
│   │   └── types.py                  # Pydantic mirror of canonical.ts
│   └── tests/                        # 63 pytest cases
├── supabase/migrations/              # 10 numbered SQL files (kept under supabase/ for path stability)
│   └── 20260515000000_local_postgres_shim.sql  # creates auth schema + auth.uid() locally
└── docs/specs/2026-05-15-architecture.md
```

## Auth model (v1)

Single-user, local-only. There is no login UI. Every request acts as the user whose UUID is `APP_USER_ID` in `.env.local`. The `auth` schema and `auth.uid()` function are simulated locally by `20260515000000_local_postgres_shim.sql`; `auth.uid()` reads `app.current_user_id` from the connection setting, which the API handler wrapper sets per-request.

When v2 invite-mode lands, the shim gets dropped and a real provider plugs in.

## Tests

```bash
pnpm test:run                         # Vitest
cd worker && uv run python -m pytest  # pytest (use `python -m` so it runs in uv venv)
pnpm typecheck                        # tsc --noEmit
```

Current: 63 Python tests pass (35 adapters + 28 matcher). TS typecheck clean.

## Security defaults

1. **Credentials encrypted with AES-256-GCM** before write — see `src/lib/crypto/credentials.ts` and `worker/csj_worker/crypto.py`.
2. **`CREDENTIALS_MASTER_KEY` never logged or returned.** Lose it = lose all stored keys.
3. **Read-only adapter enforcement** — every adapter rejects `withdraw` permission at `connect()`.
4. **RLS policies** still on every user-data table (bypassed locally as superuser; useful if you later expose the DB to a less-trusted role).
5. **No password auth in v1** — local-only product, single user.

## Adding a new exchange (~2–5 days)

1. Add row to `exchange_catalog` (new migration).
2. Create `worker/csj_worker/adapters/<exchange>.py` extending `ExchangeAdapter`.
3. Implement `connect`, `validate_credentials`, `fetch_fills`, `fetch_funding_events`, `fetch_open_positions`.
4. Write fixture-based tests in `worker/tests/adapters/test_<exchange>.py`.
5. Register adapter in `worker/csj_worker/adapters/__init__.py` and worker bootstrap.

## License
Private. No license granted.
