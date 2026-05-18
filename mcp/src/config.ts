/**
 * Configuration: resolves environment overrides and default paths.
 *
 * The Journal desktop app writes its auth token to ~/.journal/mcp.json on first
 * launch. This MCP bridge reads it from there, or from a path supplied via the
 * JOURNAL_TOKEN_PATH env var. The HTTP base URL is similarly overridable via
 * JOURNAL_API_URL.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Path to the JSON file containing `{ "token": "<hex>" }`. */
  tokenPath: string;
  /** Base URL for the Journal app's local HTTP API (no trailing slash). */
  apiBaseUrl: string;
  /** Request timeout for HTTP calls to the Journal app, in milliseconds. */
  requestTimeoutMs: number;
}

const DEFAULT_TOKEN_PATH = join(homedir(), ".journal", "mcp.json");
const DEFAULT_API_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Load configuration from environment variables, falling back to defaults.
 *
 * Reads at most once per process; the returned object is intended to be cached
 * by the caller.
 */
export function loadConfig(): Config {
  const tokenPath = process.env.JOURNAL_TOKEN_PATH?.trim() || DEFAULT_TOKEN_PATH;
  const apiBaseUrlRaw = process.env.JOURNAL_API_URL?.trim() || DEFAULT_API_BASE_URL;
  // Strip trailing slash so callers can safely concatenate "/api/..."
  const apiBaseUrl = apiBaseUrlRaw.replace(/\/+$/, "");

  return {
    tokenPath,
    apiBaseUrl,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
