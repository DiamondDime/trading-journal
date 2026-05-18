/**
 * Token loader: reads ~/.journal/mcp.json (or override path) and extracts the
 * hex token used in the X-Journal-Token header.
 *
 * The Journal desktop app generates this file on first launch. We do not
 * validate the token's cryptographic shape here — that's the API's job — but we
 * do confirm the file exists and contains a string.
 */

import { readFileSync } from "node:fs";

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * Read the token from the given path.
 *
 * @throws TokenError with a user-actionable message when the file is missing
 *   or malformed. Callers should propagate the message to stderr and exit.
 */
export function loadToken(tokenPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(tokenPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TokenError(
        `Token file not found at ${tokenPath}. Start the Journal app first; it generates the token on first launch.`,
      );
    }
    if (code === "EACCES") {
      throw new TokenError(
        `Token file at ${tokenPath} is not readable (EACCES). Check file permissions.`,
      );
    }
    throw new TokenError(
      `Failed to read token file at ${tokenPath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TokenError(
      `Token file at ${tokenPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { token?: unknown }).token !== "string"
  ) {
    throw new TokenError(
      `Token file at ${tokenPath} must be a JSON object with a "token" string field.`,
    );
  }

  const token = (parsed as { token: string }).token.trim();
  if (token.length === 0) {
    throw new TokenError(
      `Token at ${tokenPath} is empty. Restart the Journal app to regenerate it.`,
    );
  }

  return token;
}
