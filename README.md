# crypto-journal

An editorial trading journal for serious crypto traders. Self-hosted, exchange-aware, never sells your data.

![Dashboard screenshot — TODO: capture and commit to docs/screenshots/dashboard.png](docs/screenshots/dashboard.png)

> Status: pre-release. Schema and APIs are still moving. Not yet recommended for production journaling without backups.

## Quick start

The fastest path is Docker Compose.

```bash
git clone https://github.com/<owner>/crypto-journal.git
cd crypto-journal
cp .env.example .env
# Generate a master key for credential encryption:
echo "CREDENTIALS_MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose up -d
# Open http://localhost:3000
```

On first boot the `web` container waits for Postgres to report healthy, runs `pnpm db:migrate`, then starts. The `worker` container starts in parallel and idles until you connect an exchange.

## Architecture

Three services, one Postgres.

- **web** — Next.js 16 (App Router, React 19). Renders the journal, exposes `/api/*` for activity CRUD and exchange connection management. Single-user-per-instance by default (`APP_USER_ID` env var).
- **worker** — Python 3.12 ingestion service. Connects to exchanges via [ccxt] (CEX) and custom httpx clients (Hyperliquid), normalises fills into a canonical schema, folds fills into positions, and runs the leg matcher that proposes spread candidates.
- **postgres** — schema lives in `supabase/migrations/`. The supabase/ path is retained for stability; the project no longer depends on Supabase services.

The data model is a multi-activity journal. The atomic unit is an `activity` (supertype) with four subtypes: **Spread** (multi-leg, often cross-venue), **Trade** (single venue, single position), **Sale** (token allocation event — IDO, premarket, OTC), **Airdrop** (token receipt event). See `docs/specs/2026-05-16-multi-activity-journal-design.md` for the full design.

[ccxt]: https://github.com/ccxt/ccxt

## Supported exchanges

Currently implemented:

| Exchange | Kind | Auth | Adapter |
|---|---|---|---|
| Binance | CEX | api_key | `worker/csj_worker/adapters/binance.py` |
| Bybit | CEX | api_key | `worker/csj_worker/adapters/bybit.py` |
| Hyperliquid | DEX | wallet_address | `worker/csj_worker/adapters/hyperliquid.py` |

Planned (declared in `src/types/canonical.ts` `Exchange` enum, no adapter yet):
OKX, Deribit, OKX DEX, Aster, Phemex, Bitget, MEXC, KuCoin, Kraken, Gate, BingX. PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-new-exchange-adapter).

## Security

Exchange API keys are encrypted at rest with **AES-256-GCM** before they ever touch Postgres. The master key is supplied via the `CREDENTIALS_MASTER_KEY` env var (32 random bytes, base64-encoded — generate with `openssl rand -base64 32`). Encryption is implemented in `src/lib/crypto/credentials.ts` (Node) and mirrored byte-for-byte in `worker/csj_worker/crypto.py` (Python) so the web app and the worker can read the same ciphertext.

Plaintext credentials never appear in API responses, never get written to logs, and never leave the request handler in clear form. Adapters reject any API key that grants withdraw permission at `connect()` — this is enforced in the adapter ABC contract, not just a UI hint. If you lose `CREDENTIALS_MASTER_KEY` you lose access to every stored API key on that instance, so keep it backed up out-of-band. See [SECURITY.md](SECURITY.md) for the threat model and disclosure process.

## Local development

```bash
pnpm install
cd worker && uv sync --extra dev && cd ..

# Database (assumes postgres@14+ running locally)
pnpm db:create
pnpm db:migrate
# or: pnpm db:reset   (drop + create + migrate in one shot)

cp .env.example .env.local
# Edit DATABASE_URL, CREDENTIALS_MASTER_KEY, APP_USER_ID

pnpm dev                       # http://localhost:3000
pnpm typecheck                 # tsc --noEmit
pnpm test:run                  # Vitest run-once
cd worker && uv run pytest     # Python worker tests
```

The full set of pnpm scripts:

| Script | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server with HMR |
| `pnpm build` | Production build (standalone output) |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | `tsc --noEmit` over the whole tree |
| `pnpm test` / `pnpm test:run` | Vitest watch / run-once |
| `pnpm test:coverage` | Vitest with v8 coverage |
| `pnpm db:create` / `db:drop` / `db:reset` | Postgres lifecycle |
| `pnpm db:migrate` | Apply `supabase/migrations/*.sql` in order |
| `pnpm db:psql` | Interactive psql shell |
| `pnpm worker:dev` | Run the Python worker against your local DB |
| `pnpm worker:test` | pytest in `worker/` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — covers issue templates, feature proposals, adding a new exchange adapter, and the commit conventions used in this repo.

## License

[MIT](LICENSE). Copyright 2026 Andrew Shvoev and crypto-journal contributors.
