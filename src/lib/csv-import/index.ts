/**
 * Entrypoint for the CSV-import library.
 *
 * Usage:
 *   import { parseCsv } from '@/lib/csv-import';
 *   const result = parseCsv(fileContent, 'binance');
 *   // result.fills: NormalizedFill[]
 *   // result.errors: { lineNumber, message }[]
 *
 * Each parser handles its own header detection and decimal normalisation —
 * the caller doesn't need to know about exchange quirks. The result shape
 * is uniform across every exchange so the API route's insert path stays
 * the same regardless of source.
 */
import { parseBinance } from './binance';
import { parseBybit } from './bybit';
import { parseKraken } from './kraken';
import { parseCoinbase } from './coinbase';
import { parseBackpack } from './backpack';
import { parseVertex } from './vertex';
import { parseDrift } from './drift';
import { parseGeneric } from './generic';
import type { ParserResult, SupportedExchange } from './normalized';

export type { NormalizedFill, ParserResult, SupportedExchange } from './normalized';
export { SUPPORTED_EXCHANGES, isSupportedExchange, CsvParseError } from './normalized';

export function parseCsv(content: string, exchange: SupportedExchange): ParserResult {
  switch (exchange) {
    case 'binance':
      return parseBinance(content);
    case 'bybit':
      return parseBybit(content);
    case 'kraken':
      return parseKraken(content);
    case 'coinbase':
      return parseCoinbase(content);
    case 'backpack':
      return parseBackpack(content);
    case 'vertex':
      return parseVertex(content);
    case 'drift':
      return parseDrift(content);
    case 'generic':
      return parseGeneric(content);
  }
}

/**
 * Apply an optional date-range filter to the parsed fills. Returns the
 * fills that fall inside [from, to] inclusive. Empty bounds skip the check
 * for that side.
 */
export function filterByDateRange(
  fills: ParserResult['fills'],
  from: Date | null,
  to: Date | null,
): ParserResult['fills'] {
  if (!from && !to) return fills;
  const fromMs = from ? from.getTime() : -Infinity;
  const toMs = to ? to.getTime() : Infinity;
  return fills.filter((f) => {
    const t = new Date(f.executedAt).getTime();
    return t >= fromMs && t <= toMs;
  });
}
