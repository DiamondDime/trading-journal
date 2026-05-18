/**
 * Symbol normalization.
 *
 * Different venues use different symbol formats for the same logical
 * instrument. Examples:
 *   • Binance spot:  BTCUSDT
 *   • Binance perp:  BTCUSDT (suffix is in a separate column or filename)
 *   • Bybit:         BTCUSDT, BTCUSD, BTCPERP, BTC-26DEC25
 *   • Kraken:        XXBTZUSD, XBTUSDT (X/Z legacy prefixes), BTC/USD
 *   • Coinbase:      BTC-USD, BTC-USDT
 *   • Backpack:      BTC_USDC, BTC_USDC_PERP
 *   • Hyperliquid:   BTC (perp), HYPE/USDC (spot)
 *   • Drift:         BTC-PERP, SOL-PERP, 1000PEPE-PERP
 *   • Vertex:        BTC-USDC (spot), BTC-PERP
 *
 * This module returns a canonical shape:
 *   { instrument, instrumentType, base, quote }
 *
 * `instrument` is normalised to `${base}-${quote}` for spot and
 * `${base}-PERP` for perpetuals (matching the convention used by the wizard
 * pickers). `base` and `quote` are uppercased ticker strings.
 *
 * We do NOT try to be exhaustive — venues regularly add new quote currencies
 * and weird symbol formats. The function returns warnings rather than
 * throwing so the user gets a chance to fix it up in a re-import.
 */
import { InstrumentKind } from '@/types/canonical';
import type { SupportedExchange } from './normalized';

export interface NormalizedSymbol {
  instrument: string;
  instrumentType: InstrumentKind;
  base: string;
  quote: string;
  /** Non-fatal hints surfaced in the import preview. */
  warnings: string[];
}

/**
 * Common stable / quote-currency tickers. Order matters: longer first so
 * "USDC" doesn't get matched as a "USD" prefix.
 */
const COMMON_QUOTES = [
  'USDT',
  'USDC',
  'BUSD',
  'TUSD',
  'FDUSD',
  'PYUSD',
  'EURUSD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'TRY',
  'BRL',
  'BTC',
  'ETH',
  'BNB',
  'SOL',
  'DAI',
] as const;

/** Kraken legacy prefixes — strip when present to recover the modern ticker. */
const KRAKEN_PREFIX_MAP: Record<string, string> = {
  XBT: 'BTC',
  XXBT: 'BTC',
  XETH: 'ETH',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XXMR: 'XMR',
  XXRP: 'XRP',
  XZEC: 'ZEC',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZGBP: 'GBP',
  ZJPY: 'JPY',
  ZCAD: 'CAD',
};

export function normalizeSymbol(
  exchange: SupportedExchange,
  raw: string,
  /** When the parser knows from a separate column (e.g. Binance "Type" or
   *  Bybit "Contract Type"), it can pass an instrument-kind hint to override
   *  the heuristic that infers from the symbol shape. */
  hint?: InstrumentKind,
): NormalizedSymbol {
  const warnings: string[] = [];
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) {
    return makeFallback(raw, hint, ['Empty symbol — defaulted to spot UNKNOWN/UNKNOWN']);
  }

  switch (exchange) {
    case 'binance':
      return parseBinance(cleaned, hint, warnings);
    case 'bybit':
      return parseBybit(cleaned, hint, warnings);
    case 'kraken':
      return parseKraken(cleaned, hint, warnings);
    case 'coinbase':
      return parseCoinbase(cleaned, hint, warnings);
    case 'backpack':
      return parseBackpack(cleaned, hint, warnings);
    case 'vertex':
      return parseVertex(cleaned, hint, warnings);
    case 'drift':
      return parseDrift(cleaned, hint, warnings);
    case 'generic':
      return parseGeneric(cleaned, hint, warnings);
  }
}

function parseBinance(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Spot: BTCUSDT, ETHBTC. Perp: BTCUSDT (with hint=perp) or
  // BTCUSDT_PERP / BTCUSDT-PERP (some legacy exports). Dated futures:
  // BTCUSDT_241227 or BTC-241227.
  const datedMatch = /^([A-Z0-9]+?)(?:USDT|USDC|BUSD|USD)?[-_]?(\d{6})$/.exec(raw);
  if (datedMatch) {
    const base = datedMatch[1];
    return {
      instrument: `${base}-${datedMatch[2]}`,
      instrumentType: InstrumentKind.DATED_FUTURE,
      base,
      quote: 'USDT',
      warnings: [...warnings, `Dated future expiry ${datedMatch[2]} carried through verbatim`],
    };
  }

  const stripped = raw.replace(/[-_](PERP|PERPETUAL)$/i, '');
  const isPerpSuffix = stripped !== raw;
  const { base, quote, ok } = splitOnQuoteSuffix(stripped);
  const instrumentType =
    hint ??
    (isPerpSuffix ? InstrumentKind.PERP : InstrumentKind.SPOT);
  if (!ok) warnings.push(`Could not split Binance symbol "${raw}" on a known quote currency`);
  const instrument =
    instrumentType === InstrumentKind.PERP
      ? `${base}-PERP`
      : `${base}-${quote}`;
  return { instrument, instrumentType, base, quote, warnings };
}

function parseBybit(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Bybit uses BTCUSDT for both linear perp and spot — the export's
  // Category column distinguishes them. PERP suffix only appears on
  // a few legacy products.
  if (/PERP$/i.test(raw)) {
    const base = raw.replace(/PERP$/i, '');
    return {
      instrument: `${base}-PERP`,
      instrumentType: hint ?? InstrumentKind.PERP,
      base,
      quote: 'USDT',
      warnings,
    };
  }

  // Inverse perps end in USD without the "T".
  const datedMatch = /^([A-Z0-9]+)-(\d{1,2}[A-Z]{3}\d{2})$/.exec(raw);
  if (datedMatch) {
    return {
      instrument: raw,
      instrumentType: InstrumentKind.DATED_FUTURE,
      base: datedMatch[1],
      quote: 'USD',
      warnings,
    };
  }

  const { base, quote, ok } = splitOnQuoteSuffix(raw);
  const instrumentType = hint ?? InstrumentKind.SPOT;
  if (!ok) warnings.push(`Could not split Bybit symbol "${raw}" on a known quote currency`);
  return {
    instrument:
      instrumentType === InstrumentKind.PERP
        ? `${base}-PERP`
        : `${base}-${quote}`,
    instrumentType,
    base,
    quote,
    warnings,
  };
}

function parseKraken(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Kraken has the friendly BTC/USD form AND the legacy XXBTZUSD form.
  // Normalize the friendly one first.
  if (raw.includes('/')) {
    const [b, q] = raw.split('/');
    return {
      instrument: `${KRAKEN_PREFIX_MAP[b] ?? b}-${KRAKEN_PREFIX_MAP[q] ?? q}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base: KRAKEN_PREFIX_MAP[b] ?? b,
      quote: KRAKEN_PREFIX_MAP[q] ?? q,
      warnings,
    };
  }
  // Try splitting on a known quote suffix first — modern Kraken returns
  // symbols like "XBTUSDT" (legacy base + modern quote) where the legacy
  // regex would chew through the boundary. The longest-quote-first walk in
  // COMMON_QUOTES makes "XBTUSDT" → ("XBT", "USDT") cleanly, after which
  // the legacy prefix map turns "XBT" into "BTC".
  const split = splitOnQuoteSuffix(raw);
  if (split.ok) {
    return {
      instrument: `${KRAKEN_PREFIX_MAP[split.base] ?? split.base}-${KRAKEN_PREFIX_MAP[split.quote] ?? split.quote}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base: KRAKEN_PREFIX_MAP[split.base] ?? split.base,
      quote: KRAKEN_PREFIX_MAP[split.quote] ?? split.quote,
      warnings,
    };
  }
  // Last resort — the long-form double-prefixed legacy. e.g. "XXBTZUSD".
  const legacyMatch = /^(X[A-Z]{3,4}|Z[A-Z]{3})(X[A-Z]{3,4}|Z[A-Z]{3})$/.exec(raw);
  if (legacyMatch) {
    const base = KRAKEN_PREFIX_MAP[legacyMatch[1]] ?? legacyMatch[1];
    const quote = KRAKEN_PREFIX_MAP[legacyMatch[2]] ?? legacyMatch[2];
    return {
      instrument: `${base}-${quote}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base,
      quote,
      warnings,
    };
  }
  warnings.push(`Unknown Kraken symbol format "${raw}"`);
  return {
    instrument: `${split.base}-${split.quote}`,
    instrumentType: hint ?? InstrumentKind.SPOT,
    base: split.base,
    quote: split.quote,
    warnings,
  };
}

function parseCoinbase(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Coinbase Pro / Advanced Trade: BTC-USD, ETH-USDC. Perps (intl): BTC-PERP-INTX.
  if (/-PERP/i.test(raw)) {
    const base = raw.replace(/-PERP.*$/i, '');
    return {
      instrument: `${base}-PERP`,
      instrumentType: hint ?? InstrumentKind.PERP,
      base,
      quote: 'USD',
      warnings,
    };
  }
  if (raw.includes('-')) {
    const [base, quote] = raw.split('-');
    return {
      instrument: `${base}-${quote}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base,
      quote,
      warnings,
    };
  }
  const { base, quote, ok } = splitOnQuoteSuffix(raw);
  if (!ok) warnings.push(`Could not split Coinbase symbol "${raw}"`);
  return {
    instrument: `${base}-${quote}`,
    instrumentType: hint ?? InstrumentKind.SPOT,
    base,
    quote,
    warnings,
  };
}

function parseBackpack(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Backpack: BTC_USDC (spot) | BTC_USDC_PERP (perp)
  const parts = raw.split('_');
  if (parts.length >= 2) {
    const isPerp = parts[parts.length - 1] === 'PERP' || hint === InstrumentKind.PERP;
    const base = parts[0];
    const quote = isPerp && parts.length >= 3 ? parts[1] : parts[1];
    return {
      instrument: isPerp ? `${base}-PERP` : `${base}-${quote}`,
      instrumentType: isPerp ? InstrumentKind.PERP : InstrumentKind.SPOT,
      base,
      quote,
      warnings,
    };
  }
  warnings.push(`Unknown Backpack symbol format "${raw}"`);
  return makeFallback(raw, hint, warnings);
}

function parseVertex(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Vertex: BTC-USDC (spot), BTC-PERP (perp)
  if (/-PERP/i.test(raw)) {
    const base = raw.replace(/-PERP$/i, '');
    return {
      instrument: `${base}-PERP`,
      instrumentType: hint ?? InstrumentKind.PERP,
      base,
      quote: 'USDC',
      warnings,
    };
  }
  if (raw.includes('-')) {
    const [base, quote] = raw.split('-');
    return {
      instrument: `${base}-${quote}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base,
      quote,
      warnings,
    };
  }
  const { base, quote, ok } = splitOnQuoteSuffix(raw);
  if (!ok) warnings.push(`Unknown Vertex symbol "${raw}"`);
  return {
    instrument: `${base}-${quote}`,
    instrumentType: hint ?? InstrumentKind.SPOT,
    base,
    quote,
    warnings,
  };
}

function parseDrift(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Drift is perps-only in v1. Format: SOL-PERP, BTC-PERP, 1000PEPE-PERP.
  if (/-PERP$/i.test(raw)) {
    const base = raw.replace(/-PERP$/i, '');
    return {
      instrument: `${base}-PERP`,
      instrumentType: hint ?? InstrumentKind.PERP,
      base,
      quote: 'USDC',
      warnings,
    };
  }
  warnings.push(`Unknown Drift symbol "${raw}" — Drift v1 supports only -PERP suffixes`);
  return makeFallback(raw, hint, warnings);
}

function parseGeneric(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  // Generic accepts BASE-QUOTE / BASE/QUOTE / BASEQUOTE.
  const delim = raw.includes('-') ? '-' : raw.includes('/') ? '/' : null;
  if (delim) {
    const [b, q] = raw.split(delim);
    if (q?.toUpperCase() === 'PERP') {
      return {
        instrument: `${b}-PERP`,
        instrumentType: hint ?? InstrumentKind.PERP,
        base: b,
        quote: 'USDT',
        warnings,
      };
    }
    return {
      instrument: `${b}-${q}`,
      instrumentType: hint ?? InstrumentKind.SPOT,
      base: b,
      quote: q,
      warnings,
    };
  }
  const { base, quote, ok } = splitOnQuoteSuffix(raw);
  if (!ok) warnings.push(`Generic symbol "${raw}" did not match any known quote-currency suffix`);
  return {
    instrument: `${base}-${quote}`,
    instrumentType: hint ?? InstrumentKind.SPOT,
    base,
    quote,
    warnings,
  };
}

/**
 * Walk the COMMON_QUOTES list and try to peel each one off the end of the
 * symbol. Returns `ok=false` when nothing matched — the caller decides
 * whether to add a warning or fail outright.
 */
function splitOnQuoteSuffix(raw: string): {
  base: string;
  quote: string;
  ok: boolean;
} {
  for (const q of COMMON_QUOTES) {
    if (raw.endsWith(q) && raw.length > q.length) {
      return { base: raw.slice(0, raw.length - q.length), quote: q, ok: true };
    }
  }
  return { base: raw, quote: 'UNKNOWN', ok: false };
}

function makeFallback(
  raw: string,
  hint: InstrumentKind | undefined,
  warnings: string[],
): NormalizedSymbol {
  return {
    instrument: raw || 'UNKNOWN-UNKNOWN',
    instrumentType: hint ?? InstrumentKind.SPOT,
    base: raw || 'UNKNOWN',
    quote: 'UNKNOWN',
    warnings,
  };
}
