/**
 * HTTP client for the Journal app's local MCP API.
 *
 * All requests are localhost-only and authenticated with the X-Journal-Token
 * header. Errors are normalized into structured `JournalApiError` instances
 * with user-actionable messages — the MCP server layer turns these into MCP
 * tool errors.
 */

import type { ApiErrorEnvelope } from "./types.js";

/**
 * Structured error thrown by every client call. The MCP server catches this
 * and surfaces `.message` to the LLM. `.code` is included for logging /
 * future-proofing but isn't shown to the user.
 */
export class JournalApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "JournalApiError";
    this.code = code;
  }
}

export interface JournalClientOptions {
  /** Base URL with no trailing slash, e.g. http://127.0.0.1:3000 */
  apiBaseUrl: string;
  /** Hex token from ~/.journal/mcp.json */
  token: string;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
}

export class JournalClient {
  private readonly apiBaseUrl: string;
  private readonly token: string;
  private readonly requestTimeoutMs: number;

  constructor(opts: JournalClientOptions) {
    this.apiBaseUrl = opts.apiBaseUrl;
    this.token = opts.token;
    this.requestTimeoutMs = opts.requestTimeoutMs;
  }

  /**
   * Call a tool endpoint. Always POST with JSON body, X-Journal-Token header.
   * Returns the raw parsed JSON body on success.
   *
   * @throws JournalApiError on network failure, auth failure, or non-2xx.
   */
  async callTool(tool: string, input: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}/api/mcp/v1/${tool}`;
    return this.doRequest(url, {
      method: "POST",
      headers: {
        "X-Journal-Token": this.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input ?? {}),
    });
  }

  /**
   * GET /api/mcp/v1/health. No token required by contract; we send it anyway
   * because some deployments may enforce it and ignoring is cheap.
   */
  async health(): Promise<unknown> {
    const url = `${this.apiBaseUrl}/api/mcp/v1/health`;
    return this.doRequest(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  }

  private async doRequest(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      // fetch throws on network failure, DNS error, or AbortError on timeout.
      const cause = err as Error & { code?: string; cause?: { code?: string } };
      const errCode = cause.code ?? cause.cause?.code;

      if (cause.name === "AbortError") {
        throw new JournalApiError(
          "REQUEST_TIMEOUT",
          `Journal app did not respond within ${this.requestTimeoutMs}ms. Is it running and responsive?`,
        );
      }
      if (errCode === "ECONNREFUSED" || errCode === "ENOTFOUND" || errCode === "EHOSTUNREACH") {
        throw new JournalApiError(
          "APP_NOT_RUNNING",
          "Journal app is not running. Launch it from /Applications/Journal.app (Mac) or Start Menu (Windows).",
        );
      }
      throw new JournalApiError(
        "NETWORK_ERROR",
        `Failed to reach the Journal app at ${this.apiBaseUrl}: ${cause.message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) {
      // Drain the body so the connection can be reused.
      await response.text().catch(() => "");
      throw new JournalApiError(
        "TOKEN_MISMATCH",
        "Token mismatch — regenerate by restarting the Journal app and re-reading ~/.journal/mcp.json",
      );
    }

    const rawBody = await response.text();

    if (!response.ok) {
      // Try to extract the API's structured error message.
      let message = `Journal API returned HTTP ${response.status}`;
      let code = `HTTP_${response.status}`;
      try {
        const parsed = JSON.parse(rawBody) as Partial<ApiErrorEnvelope>;
        if (parsed.error?.message && typeof parsed.error.message === "string") {
          message = parsed.error.message;
        }
        if (parsed.error?.code && typeof parsed.error.code === "string") {
          code = parsed.error.code;
        }
      } catch {
        // Body wasn't JSON; keep the default message.
        if (rawBody.trim().length > 0 && rawBody.length < 500) {
          message = `${message}: ${rawBody.trim()}`;
        }
      }
      throw new JournalApiError(code, message);
    }

    // Parse the success body. An empty body is treated as null.
    if (rawBody.trim().length === 0) {
      return null;
    }
    try {
      return JSON.parse(rawBody);
    } catch (err) {
      throw new JournalApiError(
        "INVALID_RESPONSE",
        `Journal API returned non-JSON response: ${(err as Error).message}`,
      );
    }
  }
}
