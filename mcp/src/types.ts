/**
 * Mirrors of the HTTP API contract at /api/mcp/v1/*.
 *
 * These types describe the *shape* of inputs and outputs. We deliberately do
 * not enforce runtime validation here — the MCP SDK validates inputs against
 * the JSON Schema we register, and outputs are passed through to the LLM as
 * JSON text. Decimal fields are strings (e.g. "1234.56789") to preserve
 * precision across the wire.
 */

/** Standard error envelope returned by the API on non-2xx responses. */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

// --- list_spreads ----------------------------------------------------------

export interface ListSpreadsInput {
  /** ISO-8601 timestamp (inclusive). */
  opened_after?: string;
  /** ISO-8601 timestamp (inclusive). */
  opened_before?: string;
  /** "open" | "closed" | "partial". */
  status?: "open" | "closed" | "partial";
  /** Symbol filter, e.g. "BTC-USD". Case-insensitive on the API side. */
  symbol?: string;
  /** Venue filter, e.g. "binance". */
  venue?: string;
  /** Tag filter. Multiple tags = AND. */
  tags?: string[];
  /** 1..200, default 200. */
  limit?: number;
  /** Default 0. */
  offset?: number;
}

// --- get_spread ------------------------------------------------------------

export interface GetSpreadInput {
  /** Opaque id returned by list_spreads. */
  id: string;
}

// --- recent_activity -------------------------------------------------------

export interface RecentActivityInput {
  /** 1..365, default 7. */
  days?: number;
}

// --- account_overview ------------------------------------------------------

// No inputs.
export type AccountOverviewInput = Record<string, never>;

// --- tag_glossary ----------------------------------------------------------

export interface TagGlossaryInput {
  /** When true, omit tags without a user-written definition. Default false. */
  only_with_definitions?: boolean;
}
