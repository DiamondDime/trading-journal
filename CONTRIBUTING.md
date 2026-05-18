# Contributing to Journal

Thanks for showing up. This is a small project; contributions land faster when they line up with the conventions below.

## Filing an issue

Use the templates under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/):

- **Bug report** — for anything that misbehaves, regresses, or contradicts the docs.
- **Feature request** — for new behaviour or workflow changes.
- **Adapter request** — for a new exchange integration.

Questions and design discussions go in GitHub Discussions, not Issues.

## Branch flow

- Feature work happens on topic branches off `main`.
- Branch names: `<area>/<short-slug>` — e.g. `worker/okx-fills`, `ui/sale-vesting-step`.
- Open a PR back to `main` when the branch is ready. Squash-merge is the default; the per-commit story should still make sense for the reviewer.
- Long-lived release branches don't exist yet — tagged releases are cut from `main`.

## Commit conventions

Atomic commits. One logical change per commit. Short conventional prefixes:

- `feat:` — new behaviour
- `fix:` — bug fix
- `refactor:` — internal reshuffle, no behaviour change
- `docs:` — documentation only
- `test:` — tests only
- `perf:` — performance change
- `chore:` — tooling, deps, config

Imperative mood, lowercase after the prefix:

```
feat: add OKX spot fills adapter
fix: reject withdraw permission in bybit connect
docs: clarify CREDENTIALS_MASTER_KEY rotation
```

Never use `--no-verify` to skip hooks. If a hook fails, fix the underlying issue and recommit. If a hook is wrong, fix the hook in the same PR.

## Pre-commit checks

The following must pass locally before you push:

```bash
$ pnpm typecheck
$ pnpm test:run
```

For worker changes, also run:

```bash
$ cd worker && uv run pytest
```

CI runs the same set on every push and PR — see `.github/workflows/ci.yml`.

## Code style

- **Decimals as strings.** Never `number` for money or quantity. TypeScript uses `decimal.js` at the UI edge. Python uses `Decimal` everywhere internally. Wire format is always a string.
- **Branded IDs** in TS (`SpreadId`, `FillId`, etc) for compile-time safety. Don't unwrap them outside type-level conversions.
- **No `console.log` in production code.** Use the project logger (`src/lib/logger.ts` for TS, `pino` for the Node worker, `structlog` for the Python worker). Stray `console.log` calls will be flagged in review and must be removed before merge.
- **Pydantic v2** in Python with `extra='forbid'` everywhere.
- **One-to-one** Note ↔ Activity in v1.
- New files: follow the conventions of neighbouring files. The existing tree is small enough to read.
- Don't refactor adjacent code in a feature PR. Split it.

## Proposing a feature

1. Open a feature request issue describing the problem before the solution — what hurts today, what you wish worked, who else has the same problem.
2. Wait for a maintainer to ack the direction before writing code on anything non-trivial. We turn down PRs that don't match the editorial-journal product vision; that is faster to catch in an issue than in a PR.
3. Implementation PRs should reference the issue (`Closes #123`).

## Adding a new exchange adapter

Adapters live under `worker/csj_worker/adapters/` (Python, webapp) and `worker-ts/src/adapters/` (TypeScript, desktop). The abstract base class is `worker/csj_worker/adapters/base.py` — read that first. It is the contract; every adapter must satisfy it.

Methods to implement on a subclass of `ExchangeAdapter`:

| Method | What it does |
|---|---|
| `connect(credentials)` | One light authenticated request. Capture permissions, **reject withdraw permission**, capture server-time skew. |
| `validate_credentials(credentials)` | Cheap re-check for periodic health monitoring. Must not mutate session state. |
| `fetch_fills(credentials, *, since, until)` | Async-iterator of pages of `CanonicalFill` in `[since, until]`, ascending by `filled_at`. |
| `fetch_funding_events(credentials, *, since, until)` | Async-iterator of `CanonicalFundingEvent`. If the venue has no funding, declare it in `capabilities` and raise `AdapterUnsupportedError`. |
| `fetch_open_positions(credentials)` | Snapshot of currently-open positions for drift detection. |

Also declare class attributes: `exchange`, `exchange_kind`, `auth_mode`, `capabilities`, `rate_limit`.

If the exchange is supported by [ccxt](https://github.com/ccxt/ccxt/wiki/Exchange-Markets), use the universal adapter:

1. **Create `worker/csj_worker/adapters/configs/<code>.py`** — define `CONFIG = VenueConfig(...)`.
2. **Implement `_fetch_permissions`, `_has_withdraw`, `_extract_permissions`** per the exchange's API docs.
3. **Register in `csj_worker/adapters/configs/__init__.py`** (`ALL_CONFIGS` dict).
4. **Add a row to the `exchange_catalog` migration.**
5. **Smoke-test in `tests/adapters/test_generic_adapter.py`** — copy the existing `TestWithdrawPermissionRejection` cases as a template.
6. **Mirror in `worker-ts/src/adapters/`** so the desktop bundle gets the same venue.
7. **Update the "Supported exchanges" section of `README.md`** (or the relevant spec doc).

For venues NOT on ccxt (DEXes, regional venues), implement a bespoke `ExchangeAdapter` subclass under `csj_worker/adapters/legacy/` and register it directly in `ADAPTER_REGISTRY`.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The short version: be kind, give and accept feedback well, focus on what's best for the community.
