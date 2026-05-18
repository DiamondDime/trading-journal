/**
 * `NormalizedFill` — the shape every CSV parser must produce. Matches the
 * subset of the `public.fills` table that a CSV import is allowed to write.
 *
 * Why decimals as strings?
 * ────────────────────────
 * The Postgres `numeric(38,18)` columns happily store values that lose
 * precision when round-tripped through IEEE-754 doubles (e.g. a 18-decimal
 * stable-asset price). Every layer of this codebase keeps prices/qty as
 * strings until the very last formatting step — see CLAUDE.md "Decimals as
 * strings." A parser that hands us numbers is a parser that has already lost
 * data.
 *
 * Why no `user_id` / `exchange_connection_id`?
 * ────────────────────────────────────────────
 * Those are bound at insert time by the API route, not by the parser. The
 * parser only knows about the file contents.
 *
 * `rawExchangeId` is the dedup key combined with the connection id by the
 * unique constraint `uq_fill_idempotency`. For CSVs that don't ship a stable
 * trade id (some Coinbase exports), the parser MUST synthesise a stable one
 * (e.g. `${hash(executed_at)}-${hash(qty+price)}`). Using `crypto.randomUUID`
 * here would break idempotency on re-import.
 */
import type { InstrumentKind, Side, FeeKind, PositionSide } from '@/types/canonical';

export interface NormalizationWarning {
  /** Human-readable warning for the preview UI. */
  message: string;
  /** Source row line number (1-based, including header). */
  lineNumber: number;
}

export interface NormalizedFill {
  /** Stable exchange-side trade id. Used for idempotency. Required. */
  rawExchangeId: string;
  /** Native symbol as it appeared in the export, e.g. "BTCUSDT" or "BTC-PERP". */
  rawSymbol: string;
  /** Normalised instrument label, e.g. "BTC-USDT" or "BTC-PERP". */
  instrument: string;
  instrumentType: InstrumentKind;
  side: Side;
  positionSide: PositionSide | null;
  /** True if the fill closed/reduced a position. Null when the venue doesn't surface this. */
  reduceOnly: boolean | null;
  /** Decimal string, no trailing zeros required. */
  qty: string;
  /** Decimal string. */
  price: string;
  /** qty * price as a decimal string. */
  notional: string;
  /** Fee in `feeCurrency`, decimal string. Empty exports return "0". */
  fee: string;
  feeCurrency: string;
  feeKind: FeeKind;
  isMaker: boolean;
  /** 'maker' | 'taker' | null — duplicated from `feeKind` for direct fills_table writes. */
  liquidityRole: 'maker' | 'taker' | null;
  /** Optional exchange-side order id, when the row exposes it. */
  orderId: string | null;
  /** ISO 8601 timestamp string in UTC. Caller persists as `timestamptz`. */
  executedAt: string;
  /**
   * Verbatim source row as parsed (header → value). Lands in `raw_payload` for
   * audit/debug. Sensitive columns should already have been stripped by the
   * parser — we don't strip again here.
   */
  rawPayload: Record<string, string>;
  /** Soft warnings (unknown quote currency, missing fee, etc.) surfaced in the preview. */
  warnings: NormalizationWarning[];
}

/** Subset of the exchanges we ship CSV parsers for. */
export type SupportedExchange =
  | 'binance'
  | 'bybit'
  | 'kraken'
  | 'coinbase'
  | 'backpack'
  | 'vertex'
  | 'drift'
  | 'generic';

export const SUPPORTED_EXCHANGES: readonly SupportedExchange[] = [
  'binance',
  'bybit',
  'kraken',
  'coinbase',
  'backpack',
  'vertex',
  'drift',
  'generic',
] as const;

export function isSupportedExchange(s: string): s is SupportedExchange {
  return (SUPPORTED_EXCHANGES as readonly string[]).includes(s);
}

/**
 * What a parser can return. `errors` are *parser-level* failures (malformed
 * row, missing required column) — they prevent the row from being imported.
 * Per-row `warnings` go on the `NormalizedFill` itself.
 */
export interface ParserResult {
  fills: NormalizedFill[];
  errors: Array<{ lineNumber: number; message: string }>;
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    /** 1-based line number where the failure was detected, or null for file-level errors. */
    public readonly lineNumber: number | null = null,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}
