/**
 * MCP token plumbing.
 *
 * The Journal desktop app bridges LLM clients (Claude Desktop, Cursor, Zed)
 * to the user's local journal via the `trading-journal-mcp` npm package. That
 * package authenticates against the in-app HTTP API using a shared secret
 * stored at `~/.journal/mcp.json`.
 *
 * On first launch we generate a 32-byte cryptographically random token, write
 * it to disk with mode 0600 (owner-only), and pass it to the Next.js
 * subprocess as `MCP_TOKEN`. On subsequent launches we read the existing file
 * so the token is stable — anything cached in the user's MCP client config
 * keeps working.
 *
 * Shared contract with `mcp/src/config.ts` and `mcp/src/token.ts`:
 *   - Path: `<homedir>/.journal/mcp.json`
 *   - Body: `{"token": "<64 hex chars>"}`
 *   - File mode: 0600
 *   - Dir mode: 0700
 *
 * Never log the token value. We log only the file path + whether it was
 * loaded or generated.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const TOKEN_FILE_MODE = 0o600;
const TOKEN_DIR_MODE = 0o700;
const TOKEN_BYTES = 32;
const TOKEN_HEX_LEN = TOKEN_BYTES * 2;

export interface McpTokenResult {
  /** The 64-char hex token. NEVER log this value. */
  token: string;
  /** Whether the token was generated (true) or loaded from disk (false). */
  generated: boolean;
  /** Absolute path to the token file on disk. */
  path: string;
}

/**
 * Resolve `~/.journal/mcp.json` against the current user's home directory.
 * Extracted so tests can override the base dir.
 */
export function defaultTokenPath(): string {
  return join(homedir(), '.journal', 'mcp.json');
}

/**
 * Parse the JSON file body and return a valid 64-char hex token, or null if
 * the contents are unparseable / malformed. We deliberately treat any parse
 * failure as "regenerate" rather than throwing — the file is owned by us and
 * a corrupt file is recoverable by writing a fresh one. Throwing would brick
 * the app on a manual user edit.
 */
function parseTokenFile(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { token?: unknown }).token !== 'string'
  ) {
    return null;
  }
  const token = (parsed as { token: string }).token.trim();
  // Must be exactly 64 lowercase hex chars — anything else means the file was
  // edited externally or written by an older incompatible version.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }
  return token;
}

/**
 * Load the token from `~/.journal/mcp.json`, creating both the directory and
 * the file if either is missing or the file is malformed. Idempotent across
 * launches.
 *
 * The caller is responsible for passing the returned `token` into the
 * Next.js subprocess env as `MCP_TOKEN`. Do not log the value.
 */
export async function loadOrCreateMcpToken(
  tokenPath: string = defaultTokenPath(),
): Promise<McpTokenResult> {
  const dir = dirname(tokenPath);

  // Make sure the directory exists with 0700. `recursive: true` won't error
  // if the dir is already there. `mode` only applies to dirs we actually
  // create, but that's fine — if the user pre-created it with different
  // perms, that's their decision.
  await fs.mkdir(dir, { recursive: true, mode: TOKEN_DIR_MODE });

  // Try to read first. Three outcomes:
  //   - File exists and parses → reuse the existing token.
  //   - File exists but parse fails → regenerate, overwriting in place.
  //   - File missing (ENOENT) → generate.
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    const existing = parseTokenFile(raw);
    if (existing) {
      return { token: existing, generated: false, path: tokenPath };
    }
    // Fall through to regeneration: stale or corrupt file.
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // EACCES, EISDIR, etc — surface so the user knows something is wrong.
      throw err;
    }
    // ENOENT — fall through to generation.
  }

  const token = randomBytes(TOKEN_BYTES).toString('hex');
  // Defensive check — randomBytes can't return anything else, but if Node's
  // crypto ever changes, we'd rather fail loud than write a bad token.
  if (token.length !== TOKEN_HEX_LEN) {
    throw new Error(
      `MCP token generation produced ${token.length} chars; expected ${TOKEN_HEX_LEN}`,
    );
  }

  // `writeFile` with `mode` only applies on file CREATION. If the file
  // already exists (corrupt case above), the existing perms stick. Force
  // 0600 by chmod-ing after the write — cheap and explicit.
  const body = JSON.stringify({ token });
  await fs.writeFile(tokenPath, body, { mode: TOKEN_FILE_MODE });
  await fs.chmod(tokenPath, TOKEN_FILE_MODE);

  return { token, generated: true, path: tokenPath };
}
