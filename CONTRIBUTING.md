# Contributing to crypto-journal

Thanks for showing up. This is a small project; contributions land faster when they line up with the conventions below.

## Filing an issue

Use the templates at [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/):

- **Bug report** — for anything that misbehaves, regresses, or contradicts the docs.
- **Feature request** — for new behaviour or workflow changes.
- **Adapter request** — for a new exchange integration.

Questions and design discussions go in GitHub Discussions, not Issues.

## Proposing a feature

1. Open a feature request issue describing the problem before the solution — what hurts today, what you wish worked, who else has the same problem.
2. Wait for a maintainer to ack the direction before writing code on anything non-trivial. We turn down PRs that don't match the editorial-journal product vision; that is faster to catch in an issue than in a PR.
3. Implementation PRs should reference the issue (`Closes #123`).

## Adding a new exchange adapter

Adapters live under `worker/csj_worker/adapters/`. The abstract base class is `worker/csj_worker/adapters/base.py` — read that first. It is the contract; every adapter must satisfy it.

Methods to implement on a subclass of `ExchangeAdapter`:

| Method | What it does |
|---|---|
| `connect(credentials)` | One light authenticated request. Capture permissions, **reject withdraw permission**, capture server-time skew. |
| `validate_credentials(credentials)` | Cheap re-check for periodic health monitoring. Must not mutate session state. |
| `fetch_fills(credentials, *, since, until)` | Async-iterator of pages of `CanonicalFill` in `[since, until]`, ascending by `filled_at`. |
| `fetch_funding_events(credentials, *, since, until)` | Async-iterator of `CanonicalFundingEvent`. If the venue has no funding, declare it in `capabilities` and raise `AdapterUnsupportedError`. |
| `fetch_open_positions(credentials)` | Snapshot of currently-open positions for drift detection. |

Also declare class attributes: `exchange`, `exchange_kind`, `auth_mode`, `capabilities`, `rate_limit`.

Checklist before opening a PR:

1. New row in `exchange_catalog` via a fresh migration in `supabase/migrations/`.
2. New value (if needed) in `src/types/canonical.ts` `Exchange` enum.
3. Adapter class registered in `worker/csj_worker/adapters/__init__.py`.
4. Fixture-based tests in `worker/tests/adapters/test_<exchange>.py`. Use recorded HTTP fixtures via `respx`. Cover: successful fills, pagination boundary, rate-limit retry, withdraw-permission rejection, server-time skew warning.
5. Update the "Supported exchanges" table in `README.md`.

## Tests

Run all three before pushing:

```bash
pnpm typecheck
pnpm test:run
cd worker && uv run pytest
```

CI runs the same set on every push and PR — see `.github/workflows/ci.yml`.

## Commit conventions

This repo uses short conventional prefixes:

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

Atomic commits. Keep one logical change per commit; squashing on merge is fine, but the per-commit story should still make sense.

## Code style

- Decimals as strings at every boundary — TypeScript uses `decimal.js`, Python uses `Decimal`. Never `number` for money or quantity.
- New files: follow the conventions of neighbouring files. The existing tree is small enough to read.
- Don't refactor adjacent code in a feature PR. Split it.
