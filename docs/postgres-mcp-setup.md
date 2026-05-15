# Postgres MCP setup (give Claude read access to the journal DB)

Goal: let Claude query `crypto_spread_journal` locally for trade analysis, without exposing write access.

## Option A — Official `@modelcontextprotocol/server-postgres` (read-only, simplest)

Add this entry to `~/.claude.json` under `mcpServers`:

```json
"postgres-csj": {
  "type": "stdio",
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-postgres",
    "postgresql://skywalqr@localhost:5432/crypto_spread_journal"
  ]
}
```

That's it. Restart Claude Code; you'll see `mcp__postgres-csj__query` available. It only exposes `query` (read-only SELECTs) — no INSERT/UPDATE/DELETE paths.

## Option B — `crystaldba/postgres-mcp` (richer: explain plans, index hints, schema browsing)

```json
"postgres-csj": {
  "type": "stdio",
  "command": "uvx",
  "args": [
    "postgres-mcp",
    "--access-mode=restricted",
    "postgresql://skywalqr@localhost:5432/crypto_spread_journal"
  ]
}
```

`--access-mode=restricted` blocks DDL/DML. Drop it for full read-write (not recommended).

## Quick check (without Claude)

```bash
# Option A
npx -y @modelcontextprotocol/server-postgres postgresql://skywalqr@localhost:5432/crypto_spread_journal
# Should print "Postgres MCP server running on stdio" and wait. Ctrl-C.

# Option B
uvx postgres-mcp --access-mode=restricted postgresql://skywalqr@localhost:5432/crypto_spread_journal
```

## Useful views once connected

- `public.spread_pnl` — per-spread realized/unrealized PnL, APR, days_held
- `public.position_pnl` — per-leg breakdown
- `public.daily_pnl_*` — per-user materialized view of daily PnL
- Raw tables: `spreads`, `spread_legs`, `fills`, `funding_events`, `positions`, `notes`, `tags`

## Caveats

- The DB connection bypasses RLS (you're connecting as superuser locally), so any query Claude writes sees all rows. Fine for a single-user journal.
- If you ever expose this DB to a separate machine, swap the user to one without `BYPASSRLS` and set `app.current_user_id` per session.
