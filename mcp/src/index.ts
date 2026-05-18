#!/usr/bin/env node
/**
 * Entry point for the `trading-journal-mcp` binary.
 *
 * Flow:
 *   1. Load env-driven config (token path, API base URL).
 *   2. Read the token from disk; exit cleanly with a helpful stderr message if
 *      the file is missing or malformed.
 *   3. Wire up the MCP Server + StdioServerTransport and start listening.
 *
 * Errors:
 *   - Token errors exit with code 2 and a single-line stderr message.
 *   - Unexpected errors propagate, get logged to stderr, and exit with code 1.
 *
 * stderr is the only place we log — stdout is reserved for the MCP wire
 * protocol when using stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { JournalClient } from "./client.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { TokenError, loadToken } from "./token.js";

async function main(): Promise<void> {
  const config = loadConfig();

  let token: string;
  try {
    token = loadToken(config.tokenPath);
  } catch (err) {
    if (err instanceof TokenError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const client = new JournalClient({
    apiBaseUrl: config.apiBaseUrl,
    token,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const server = buildServer(client);
  const transport = new StdioServerTransport();

  // Graceful shutdown on SIGINT / SIGTERM. The MCP client (Claude Desktop,
  // Cursor) sends SIGTERM when it shuts the server down. We close the server
  // explicitly so any in-flight requests get a chance to finish.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    process.stderr.write(`Received ${signal}, shutting down trading-journal-mcp...\n`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);

  // The MCP SDK keeps the event loop alive via stdin reads, so we return
  // here. Process exit happens when the transport's stdin stream closes.
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`trading-journal-mcp fatal error: ${message}\n`);
  process.exit(1);
});
