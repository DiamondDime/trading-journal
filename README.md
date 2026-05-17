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

On first install, run `pnpm db:seed` to populate 27 demo activities so the UI isn't empty.

## Architecture

Three services, one Postgres.

- **web** — Next.js 16 (App Router, React 19). Renders the journal, exposes `/api/*` for activity CRUD and exchange connection management. Single-user-per-instance by default (`APP_USER_ID` env var).
- **worker** — Python 3.12 ingestion service. Connects to exchanges via [ccxt] (CEX) and custom httpx clients (Hyperliquid), normalises fills into a canonical schema, folds fills into positions, and runs the leg matcher that proposes spread candidates.
- **postgres** — schema lives in `supabase/migrations/`. The supabase/ path is retained for stability; the project no longer depends on Supabase services.

The data model is a multi-activity journal. The atomic unit is an `activity` (supertype) with four subtypes: **Spread** (multi-leg, often cross-venue), **Trade** (single venue, single position), **Sale** (token allocation event — IDO, premarket, OTC), **Airdrop** (token receipt event). See `docs/specs/2026-05-16-multi-activity-journal-design.md` for the full design.

[ccxt]: https://github.com/ccxt/ccxt

## Supported exchanges

All CEX adapters share a single `CcxtUniversalAdapter` (see [`worker/csj_worker/adapters/generic.py`](worker/csj_worker/adapters/generic.py)) driven by per-venue `VenueConfig` modules. Adding a new ccxt-supported exchange is now ~30 LOC of config plus an `exchange_catalog` row.

| Exchange | Kind | Auth | Adapter | Notes |
|---|---|---|---|---|
| Binance | CEX | api_key | `CcxtUniversalAdapter(BINANCE_CONFIG)` | Spot + USD-M perp + coin-M perp |
| Bybit | CEX | api_key | `CcxtUniversalAdapter(BYBIT_CONFIG)` | v5 unified, linear + spot |
| OKX | CEX | api_key + passphrase | `CcxtUniversalAdapter(OKX_CONFIG)` | SPOT + SWAP + FUTURES + OPTION |
| BingX | CEX | api_key | `CcxtUniversalAdapter(BINGX_CONFIG)` | Withdraw status unverifiable — UI attestation required |
| Gate | CEX | api_key | `CcxtUniversalAdapter(GATE_CONFIG)` | Spot + perp + dated futures |
| MEXC | CEX | api_key | `CcxtUniversalAdapter(MEXC_CONFIG)` | Withdraw status unverifiable — UI attestation required |
| KuCoin | CEX | api_key + passphrase | `CcxtUniversalAdapter(KUCOIN_CONFIG)` | Defaults to `kucoinfutures` for perps |
| Bitget | CEX | api_key + passphrase | `CcxtUniversalAdapter(BITGET_CONFIG)` | v2 api-key-info endpoint |
| HTX | CEX | api_key | `CcxtUniversalAdapter(HTX_CONFIG)` | Formerly Huobi |
| Phemex | CEX | api_key | `CcxtUniversalAdapter(PHEMEX_CONFIG)` | Withdraw status unverifiable — UI attestation required |
| Hyperliquid | DEX | wallet_address | `HyperliquidAdapter` (bespoke) | Not on ccxt — uses proprietary `/info` endpoint |

Planned (declared in `Exchange` enum, no adapter yet): Deribit, OKX DEX, Aster, Kraken.

### Adding a new exchange

If the exchange is supported by [ccxt](https://github.com/ccxt/ccxt/wiki/Exchange-Markets):

1. **Create `worker/csj_worker/adapters/configs/<code>.py`** — define `CONFIG = VenueConfig(code='<code>', ccxt_id='<ccxt_id>', ccxt_options={...}, requires_passphrase=...)`.
2. **Implement `_fetch_permissions`, `_has_withdraw`, `_extract_permissions`** per the exchange's API docs. The framework rejects keys where `_has_withdraw` returns true. For venues without an introspection endpoint, surface `"withdraw:unverified"` in `_extract_permissions` so the UI can force user attestation.
3. **Register in `csj_worker/adapters/configs/__init__.py`** (`ALL_CONFIGS` dict).
4. **Add a row to the `exchange_catalog` migration** with the canonical code, display name, and capability flags.
5. **Smoke-test in `tests/adapters/test_generic_adapter.py`** — copy one of the existing per-venue `TestWithdrawPermissionRejection` tests as a template.

For venues NOT on ccxt (DEXes, regional venues), implement a bespoke `ExchangeAdapter` subclass under `csj_worker/adapters/legacy/` and register it directly in `ADAPTER_REGISTRY`.

### Legacy fallback

The hand-built Binance and Bybit adapters (~700 LOC each) are preserved under `worker/csj_worker/adapters/legacy/`. To roll back to them for any specific venue, set the env var `CSJ_USE_LEGACY_ADAPTER_<EXCHANGE>=1` (e.g. `CSJ_USE_LEGACY_ADAPTER_BINANCE=1`). The factory consults this flag at adapter resolution time, so per-connection toggling is possible.

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
| `pnpm worker:dev` | Run the Python worker daemon against your local DB |
| `pnpm worker:once` | Run a single sync+match cycle then exit |
| `pnpm worker:match` | Run the leg matcher only (no exchange sync) |
| `pnpm worker:test` | pytest in `worker/` |

## Worker (exchange ingestion)

The worker is a Python daemon that pulls fills from connected exchanges and
runs the leg matcher.

```bash
# One-shot (useful for development):
pnpm worker:once

# Long-running (production):
pnpm worker:dev

# Matcher only (no sync):
pnpm worker:match

# Backfill MAE/MFE excursions for closed trades & spreads
# (reads public klines, no credentials required, idempotent):
pnpm worker:backfill-excursions
pnpm worker:backfill-excursions --activity-id <uuid>     # one activity
pnpm worker:backfill-excursions --force                  # overwrite existing
```

Environment: `DATABASE_URL`, `CREDENTIALS_MASTER_KEY` (required), optional
`WORKER_POLL_INTERVAL_SECONDS` (default 300), `WORKER_LOOKBACK_DAYS` (default
30), `WORKER_LOG_LEVEL` (default INFO). Logs are JSON lines on stdout.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — covers issue templates, feature proposals, adding a new exchange adapter, and the commit conventions used in this repo.

## License

[MIT](LICENSE). Copyright 2026 Andrew Shvoev and crypto-journal contributors.
