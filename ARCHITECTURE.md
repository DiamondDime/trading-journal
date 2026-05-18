# Architecture

This document describes the system at a level a contributor can navigate. It covers both flavors of the app (webapp + desktop), the data flow from exchange APIs to the journal UI, the encryption layer, the locale system, and the rationale behind the major dependencies. Open questions live at the bottom.

For the desktop port specifically, see [ELECTRON.md](ELECTRON.md). For exhaustive design history, see `docs/specs/`.

## System overview

There are two flavors of the same codebase.

### Webapp flavor

```
+--------+   HTTPS    +----------------------+   SQL    +-------------+
| Browser| <--------> | Next.js 16 (web)     | <-----> | Postgres 16 |
+--------+            |  - App Router        |         |             |
                      |  - Server Components |         +------^------+
                      |  - Server Actions    |                |
                      |  - API routes        |                | SQL
                      +----------------------+         +------v------+
                                                       | Python      |
                                                       | worker      |
                                                       | (ccxt)      |
                                                       +------^------+
                                                              |
                                                              | REST
                                                       +------v------+
                                                       | Exchange    |
                                                       | APIs        |
                                                       +-------------+
```

- **Web**: Next.js 16 (App Router, React 19, Tailwind v4) on Node 22.
- **Database**: Postgres 16 reached over `postgres://` via [postgres.js](https://github.com/porsager/postgres).
- **Worker**: Python 3.12 daemon under `worker/`, ccxt for CEX adapters, custom httpx clients for Hyperliquid.

Operators run all three. Docker Compose is the default deployment path.

### Desktop flavor

```
+--------+   IPC     +----------------------+
| BrowserWindow      | Electron main         |
|  (renderer)|<----->|  - PGlite (embedded)  |
+--------+           |  - electron-updater   |
                     |  - keychain access    |
                     +----------+------------+
                                |
                  spawns        |   spawns
              +-----------------+-----------------+
              |                                   |
   +----------v---------+                +--------v---------+
   | Next.js subprocess |                | Node worker      |
   | (next start)       |                | (worker-ts)      |
   +----------+---------+                +--------+---------+
              |                                   |
              | SQL                          SQL  |
              +-----------------+-----------------+
                                |
                          +-----v-----+
                          | PGlite    |
                          +-----------+
```

PGlite replaces external Postgres. The Node worker replaces the Python worker. The Next.js server runs as a subprocess of the Electron main process and serves the renderer over `http://localhost`. The journal UI and the data model are identical between flavors.

## Data flow

The ingestion pipeline is the same in both flavors; only the worker runtime differs.

```
Exchange REST API
       |
       v
   Adapter.fetch_fills()       (paginated, async-iter, since/until window)
       |
       v
   CanonicalFill[]              (Pydantic / Zod validated, decimals as strings)
       |
       v
   UPSERT fills                 (idempotent on raw_exchange_id)
       |
       v
   Position builder             (FIFO/LIFO fold of fills into positions)
       |
       v
   Leg matcher                  (heuristic rules -> SpreadCandidate proposals)
       |
       v
   Spread aggregates            (gross/funding/fees/net/APR recomputed)
       |
       v
   UI                           (Server Components read the same tables)
```

The matcher's rules are documented in `docs/specs/2026-05-15-architecture.md` under "Leg matcher". It does not auto-create spreads — every proposal needs explicit user accept/reject in the UI. This is intentional: false positives on spread detection cause more analytical damage than missed matches.

The worker also fetches funding events and open-position snapshots on the same poll cycle. Open positions are reconciled against the matcher's running position state to detect drift between our model and the venue's truth.

## Encryption layer

Exchange credentials and wallet addresses are encrypted at the column level with AES-256-GCM before insert. The implementation is small, audited, and mirrored across three runtimes:

| Runtime | Location |
|---|---|
| TypeScript (webapp + worker-ts + Electron main) | `src/lib/crypto/credentials.ts` |
| Python (webapp worker) | `worker/csj_worker/crypto.py` |
| TypeScript (desktop worker) | `worker-ts/src/crypto.ts` |

All three produce byte-identical ciphertext for the same plaintext and key. The serialisation format is `{ ciphertext, iv, tag }` packed as `bytea` in Postgres.

The master key is 32 random bytes:

- **Webapp**: `CREDENTIALS_MASTER_KEY` env var, base64-encoded. The operator generates it via `openssl rand -base64 32` and stores it out-of-band.
- **Desktop**: generated on first launch by the Electron main process and stored in the OS keychain (`Journal: master-key`). Never written to disk in plaintext.

Plaintext credentials are decrypted exactly once per request, inside the API handler that needs them (worker poll, adapter `connect()`), and immediately discarded. They never appear in logs, never appear in API responses, and never leave the server-side request scope.

Adapters reject any API key that grants `withdraw` permission at `connect()`. This is enforced by the ABC contract, not just a UI hint — a venue without permission introspection (BingX, MEXC, Phemex) surfaces `"withdraw:unverified"` and the UI forces an explicit user attestation before the key is stored.

## Locale system

Two locales in v1: `en` and `ru`. The active locale is stored in a cookie and switched via a Server Action — there is no client-side i18n bundle.

```
User clicks locale switcher
       |
       v
   Server Action: setLocale("ru")
       |
       v
   Set-Cookie: NEXT_LOCALE=ru
       |
       v
   revalidatePath("/")  (re-renders Server Components with new dictionary)
       |
       v
   Server Components import messages/ru.ts at render time
```

Dictionaries live under `src/lib/i18n/messages/{en,ru}.ts`. The server helper is `getT(namespace)`; the client helper is `useT(namespace)`. Both return a `t(key, params?)` function with compile-time-checked keys per namespace.

This design is cookie-driven on purpose: the URL doesn't carry the locale (no `/en/...` or `/ru/...` prefix), so links shared between users render in the recipient's locale. The trade-off is that locale-specific SEO is weaker; that's acceptable for an app whose entry point is a self-hosted dashboard, not search.

## Why each major dep

| Dependency | Reason |
|---|---|
| **Next.js 16** | App Router + Server Components let the journal render directly from Postgres without an API client. Server Actions remove a layer of `/api/*` plumbing for mutations. React 19 ships with it. Note: the repo's `AGENTS.md` warns that Next 16 has breaking changes — read `node_modules/next/dist/docs/` before assuming an API from earlier versions still works. |
| **postgres.js** | Tagged-template SQL, camelCase transform, native `bytea` handling, and no ORM abstraction. The schema is hand-written; an ORM would obscure that without adding value at this size. Singleton in `src/lib/db/client.ts`. |
| **PGlite** | Embedded Postgres for the desktop bundle. WebAssembly build of Postgres 16 — same SQL dialect, same migrations, no separate binary per platform. Single-writer is acceptable because only the worker subprocess writes. |
| **ccxt** | Covers 10 of 11 v1 exchanges via one universal adapter (`CcxtUniversalAdapter`). Adding a new ccxt-supported venue is ~30 LOC of config plus a catalog row. Hyperliquid is bespoke because it isn't on ccxt. |
| **Tailwind v4** | Compiled-CSS, no PostCSS plugin pipeline, native cascade layers. Plays well with React Server Components — no runtime style cost. |
| **decimal.js / Decimal** | Money and quantity are always strings at the wire and `Decimal` at the boundary. `number` is forbidden for either; `0.1 + 0.2` is not a quantity. |
| **Zod 4 / Pydantic v2** | Schema validation at every system boundary (request body, API response, adapter output). Both run in strict mode (`extra='forbid'` / `.strict()`); unknown fields fail loudly. |
| **electron + electron-updater** | Standard pairing for cross-platform desktop with auto-update against GitHub Releases. Trade-off accepted: ~120 MB bundle floor from the Chromium runtime. |
| **MarkerJS2** | Screenshot annotation in the journal. Off-the-shelf for arrows, boxes, text labels. |
| **Recharts + lightweight-charts** | Recharts for analytics panels (PnL series, breakdowns); lightweight-charts for OHLC on trade and spread detail pages. Two libraries because one (Recharts) is composable but not great at financial chart density, the other (lightweight-charts) is the inverse. |

## Open questions

Not yet resolved. We're tracking these explicitly so they don't get lost.

- **Multi-user mode.** The schema supports it (`user_id` everywhere, RLS policies in place), but the single-user `APP_USER_ID` shim is wired through the auth layer. Lifting it requires a real login UI and decisions about invite vs. open signup. Deferred to v2.
- **Key versioning for `CREDENTIALS_MASTER_KEY`.** Rotating it today requires re-encrypting every credential row in a one-shot script. A `key_version` column would let rotation be lazy. Cost: every credential read needs a key lookup. Not yet worth the complexity.
- **Webapp ↔ desktop data migration.** No guided import yet. A user moving from a self-hosted webapp to the desktop app currently has to `pg_dump` the source DB and `psql` it into PGlite by hand. Planned for v1.
- **Python ↔ TypeScript worker parity.** Both implement the same adapter contract, but the Python worker is the reference today. We need a parity test suite that runs both against recorded fixtures and asserts identical canonical output. Tracked in `worker-ts/` as a v1 ship blocker.
- **Spread-candidate confidence threshold.** The matcher emits candidates with a confidence score in `[0, 1]`; the UI shows all of them. Whether to auto-hide candidates below some threshold (and what that threshold should be) is open. Probably needs real-world fill data to decide.
- **Locale URL design.** Cookie-driven works today; if we ever ship a public marketing site, locale-prefixed URLs (`/ru/...`) are likely required. Decoupled question from the in-app journal.
