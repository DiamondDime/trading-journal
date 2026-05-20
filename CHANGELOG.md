# Changelog

All notable changes to Journal are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once a 1.0 ships.

## [Unreleased]

## [0.1.0] - 2026-05-20

First tagged release. Desktop installers for macOS and Windows.

### Added

- **Desktop app for macOS and Windows.** Downloadable `.dmg` / `.exe` installers — no database, runtime, or command line to set up. The app carries an in-process [PGlite](https://pglite.dev) database (Postgres compiled to WebAssembly); the schema's 22 migrations apply automatically on first launch. Auto-update via GitHub Releases.
- **`pglite-shim.ts`** — a `postgres.js`-compatible layer (tagged templates, transactions with SAVEPOINT-backed nesting, `sql()` identifier helpers, `sql.json()`, the snake_case → camelCase row transform) so every existing query runs unchanged against PGlite with no TCP connection. 30 unit tests against a live PGlite instance.
- **Russian locale** with cookie-driven switcher in the sidebar; full translation pass across analytics, wizard fields/review pages, detail pages, settings, and the `/add` flow.
- **`/partners` marketing page** with nine referral cards and a savings calculator.
- **Universal CCXT-backed adapter** covering 10 exchanges (Binance, Bybit, OKX, BingX, Gate, MEXC, KuCoin, Bitget, HTX, Phemex) via per-venue `VenueConfig` modules. Adding a new ccxt-supported exchange is now ~30 LOC of config plus a catalog row.
- **Exchange catalog UI** with venue logos, referral section, and archive deep-QA fixes.
- **OHLC candlestick chart** on trade and spread detail pages (lightweight-charts).
- **Screenshot attachments** with MarkerJS2 in-browser annotation (arrows, boxes, text labels).
- **MFE-R metric**, tag editor, satisfaction toggle, and per-tag aggregations.
- **MAE/MFE excursion backfill** worker command reading public klines (no credentials required, idempotent).
- **Real-data calendar heatmap** with intensity scaling over the activity history.
- **Dashboard KPI row**, real equity curve, and R-distribution histogram.
- **Analytics suite**: drawdown, win/loss streaks, R-distribution, Sharpe and Sortino.
- **Per-activity satellite tables** for tags, excursions, screenshots, and satisfaction.
- **Settings → Exchanges** page for managing connections (connect / disconnect / re-validate).
- **Vitest + Playwright + worker pytest** test scaffolding and a pre-launch checklist.

### Changed

- **Desktop database path rebuilt.** The earlier experimental `@electric-sql/pglite-socket` wire-protocol bridge — which produced `ECONNRESET` on the first query of every page — is removed. PGlite now runs in-process inside the Next.js server via the new shim. No socket, no protocol gaps.
- **Editorial debug pass** across pages with logo coverage sweep.
- **i18n quality pass** plus retrofit on seven additional page groups; settings shell forced to dynamic rendering with translated layout chrome.
- **Status enum expansion** alongside detail-page i18n retrofit.
- **Wizard navigation** breadcrumb and back/continue translated; "Крипто-журнал" renamed to "Журнал".
- **Dashboard** real funding rates and action wiring (previously placeholder).
- **Dead `href="#"` links** replaced with disabled affordances across the UI.
- Resolved adversarial-review blockers and major findings from Wave 8.

### Security

- Exchange credentials encrypted at rest with AES-256-GCM in both the TypeScript and Python paths; ciphertext is byte-identical across runtimes.
- Adapter `connect()` rejects API keys that grant withdraw permission; venues without permission introspection surface `withdraw:unverified` and force UI attestation.

[Unreleased]: https://github.com/DiamondDime/trading-journal/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DiamondDime/trading-journal/releases/tag/v0.1.0
