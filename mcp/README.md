# trading-journal-mcp

`trading-journal-mcp` is the Model Context Protocol (MCP) stdio bridge between LLM clients (Claude Desktop, Cursor, Zed, anything that speaks MCP) and the **Journal** desktop app for crypto trading. The Journal app keeps your trade book, leg/fill data, notes, and tag glossary locally on your machine; this MCP server exposes that data to an LLM so you can ask it to summarize your week, profile your trading personality, surface your most expensive mistakes, or coach you on tagged setups — all without any of your trading data leaving your laptop.

## Install

```sh
npm i -g trading-journal-mcp
```

This installs a single binary, `trading-journal-mcp`, on your PATH. It has exactly one runtime dependency (`@modelcontextprotocol/sdk`).

## Configure your client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "trading-journal": {
      "command": "trading-journal-mcp"
    }
  }
}
```

Restart Claude Desktop. The journal tools should appear in the tool palette.

### Cursor

In Cursor's settings, open **MCP** and add a new server. Use the same config:

```json
{
  "mcpServers": {
    "trading-journal": {
      "command": "trading-journal-mcp"
    }
  }
}
```

### Zed and other MCP clients

Any client that supports the standard MCP stdio transport works the same way — point it at the `trading-journal-mcp` binary with no arguments.

## How it works

The Journal desktop app is a Next.js application running inside Electron. When you launch it, two things happen: it starts a local HTTP server on `127.0.0.1:3000` for its own UI, and it writes a single-use auth token to `~/.journal/mcp.json` (32 random bytes, hex-encoded). The HTTP server exposes a small read-only API at `/api/mcp/v1/*` that's gated by that token — only callers who present the right `X-Journal-Token` header get data back.

`trading-journal-mcp` is a tiny Node process that your LLM client launches over stdio. On startup it reads the token, then sits in a loop waiting for MCP tool-call requests. Each call gets translated into a localhost HTTP POST to the Journal app with the token attached. The journal app validates the token, runs the query against your local database, and returns JSON.

This means the data path is: LLM client → MCP bridge (this package) → localhost HTTP → Journal app's local database. Nothing leaves your machine. The bridge listens on stdin/stdout (no network ports), and the Journal app's HTTP server binds to `127.0.0.1` only (no network listener on your LAN).

When you tear down the LLM session, the client sends `SIGTERM` and the bridge exits. The token in `~/.journal/mcp.json` persists across runs but rotates if you reset the Journal app.

## Tools exposed

| Tool | What it does |
|---|---|
| `list_spreads` | Paginated list of spread trades with filters (date range, status, symbol, venue, tags). |
| `get_spread` | Full detail for one spread: legs, fills, notes, tags, related funding. |
| `recent_activity` | Last N days of opens/closes (default 7, max 365). |
| `account_overview` | Top-line P&L snapshot, connected exchanges, top tags, open positions. |
| `tag_glossary` | Every tag with usage count and user-written definitions. |

Plus one resource:

| Resource URI | What it is |
|---|---|
| `journal://overview` | Same payload as `account_overview`, exposed so MCP clients that pre-load resources at session start can do so without an explicit tool call. |

## Configuration

The bridge respects two environment variables. Most people don't need either.

- `JOURNAL_TOKEN_PATH` — path to the token JSON file. Defaults to `~/.journal/mcp.json`.
- `JOURNAL_API_URL` — base URL of the Journal app's HTTP API. Defaults to `http://127.0.0.1:3000`.

You can set them in your client's MCP config like so:

```json
{
  "mcpServers": {
    "trading-journal": {
      "command": "trading-journal-mcp",
      "env": {
        "JOURNAL_API_URL": "http://127.0.0.1:3050"
      }
    }
  }
}
```

## Privacy

This MCP server is the only network endpoint involved, and it only listens on stdin from your LLM client and only writes to `127.0.0.1`. **No data ever reaches the author of this package, the LLM provider's logging infrastructure, or any third party that you haven't already configured in your LLM client.** Whichever LLM you've pointed at the bridge (Claude Sonnet on Anthropic's API, a local llama.cpp model, whatever) is the one that sees your data — exactly as it would for any other MCP tool you connect to it.

If you're using a cloud LLM, treat the data you expose here the same way you'd treat anything else you paste into a chat: the provider's privacy and retention policy applies. If that's not acceptable, run a local model.

## Troubleshooting

### "Token file not found at ~/.journal/mcp.json. Start the Journal app first; it generates the token on first launch."

Launch the Journal desktop app at least once. It creates `~/.journal/mcp.json` on first start. If the file exists but the path is non-default, set `JOURNAL_TOKEN_PATH` to point at it.

### "Token mismatch — regenerate by restarting the Journal app and re-reading ~/.journal/mcp.json"

The Journal app rotated its token (e.g. you reset the app, or it was reinstalled) but your LLM client is still using a stale bridge process holding the old token. Quit the LLM client fully so the bridge process exits, then relaunch. The bridge will reload the new token on startup.

### "Journal app is not running. Launch it from /Applications/Journal.app (Mac) or Start Menu (Windows)."

The bridge couldn't connect to `127.0.0.1:3000`. The Journal app isn't running, isn't fully started, or is bound to a different port. Launch the app; if it's running on a non-standard port, set `JOURNAL_API_URL` accordingly.

### Port conflict

If `127.0.0.1:3000` is already in use by something else on your machine when the Journal app starts, the app will fall back to another port and the bridge will fail with "Journal app is not running" because it's still trying 3000. Open the Journal app, check its **Settings → Local API** screen for the actual port, and set `JOURNAL_API_URL` to match.

## License

MIT
