# Journal

A local-first crypto trading journal that models spreads, trades, sales, and airdrops as first-class activities. Self-hosted, exchange-aware, never sells your data.

![screenshot](docs/screenshot.png)

> Status: alpha (pre-v1). Schema and APIs are still moving. Keep backups.

## Two ways to run

### Desktop app (recommended)

Download the latest `.dmg` from the [Releases](https://github.com/skywalqr/crypto-spread-journal/releases) page and double-click. The app ships its own Postgres (PGlite), worker process, and Next.js server — nothing else to install. Updates download in the background and apply on relaunch.

User data lives in `~/Library/Application Support/Journal/`. See [ELECTRON.md](ELECTRON.md) for the desktop architecture.

### Self-host the webapp

Requires Node 22, Postgres 16, and pnpm.

```bash
$ git clone https://github.com/skywalqr/crypto-spread-journal
$ cd crypto-spread-journal
$ pnpm install
$ cp .env.example .env  # edit DATABASE_URL, CREDENTIALS_MASTER_KEY, APP_USER_ID
$ pnpm db:create && pnpm db:migrate
$ pnpm dev
```

Open http://localhost:3000. Run `pnpm db:seed` to populate 27 demo activities so the UI isn't empty on first install.

To run the ingestion worker against your local DB:

```bash
$ cd worker && uv sync
$ pnpm worker:dev
```

Docker Compose is also supported — see `docker-compose.yml`.

## Features

- **Four activity types, modelled separately.** Spreads (multi-leg, multi-venue strategies), Trades (single-venue positions), Sales (IDO / launchpad / premarket / OTC token allocations with vesting and claims), Airdrops (token receipts with snapshot eligibility).
- **Exchange ingestion** for 11 venues. CCXT-backed for Binance, Bybit, OKX, BingX, Gate, MEXC, KuCoin, Bitget, HTX, Phemex; bespoke for Hyperliquid. Adapters reject API keys with withdraw permission at connection time.
- **Leg matcher.** Heuristic proposals for cross-exchange perp arb, cash-and-carry, calendar, funding-capture, and DEX/CEX arb spreads. User accepts or rejects each candidate.
- **APR-first analytics.** PnL series, breakdown by exchange / asset / regime, funding attribution, MAE/MFE excursions for closed trades and spreads.
- **Editorial journal.** One Markdown note per activity, screenshot attachments with MarkerJS2 annotation, controlled-vocabulary tags, saved views.
- **i18n.** English and Russian, switched via a cookie + Server Action. No client-side i18n bundle.
- **Single-user mode.** No login UI in v1 — auth is the `APP_USER_ID` env var. RLS policies are in place for the multi-user future.
- **Calendar, partners, and dashboard** views over your activity history.

The full feature list and v2 roadmap are in `docs/specs/2026-05-15-architecture.md` and `docs/specs/2026-05-16-multi-activity-journal-design.md`.

## Architecture

The webapp is Next.js 16 (App Router, React 19) talking to Postgres via [postgres.js](https://github.com/porsager/postgres). A separate ingestion worker (Python 3.12 + ccxt today, TypeScript port in progress for the desktop bundle) polls connected exchanges, normalises fills, runs the position builder and leg matcher, and writes spread candidates back to the database.

The desktop app wraps the same Next.js server in Electron, swaps Postgres for embedded PGlite, swaps the Python worker for the Node port, and adds auto-update via GitHub Releases. The data model and the journal UI are identical between flavors.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system overview, data flow, and dependency rationale.

## Privacy

No telemetry. No analytics. No phone-home. Your data stays on your machine.

Exchange API keys are encrypted with **AES-256-GCM** before they ever touch the database. The master key lives in `CREDENTIALS_MASTER_KEY` (webapp) or in the OS keychain (desktop) — never in the database itself. Plaintext credentials never appear in API responses, never get written to logs, and never leave the request handler in clear form. Adapters reject any API key that grants withdraw permission. See [SECURITY.md](SECURITY.md) for the full threat model.

## Status

Alpha — pre-v1. The schema is stable enough to journal against, but breaking migrations may still ship without a migration path. Keep a `pg_dump` before you upgrade. The desktop port is under active development; the webapp flow is the reference implementation.

Open issues, gaps, and known limitations live in the spec docs under `docs/specs/`.

## License

[AGPL-3.0](LICENSE). If you run a modified copy on a server reachable over a network, you must offer the modified source to its users — see section 13 of the license.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests use the templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/). Adapter requests are also welcome.
