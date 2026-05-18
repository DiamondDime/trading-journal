/**
 * Generic CSV parser — fallback when the venue isn't supported but the
 * user has manually formatted their trades into a known shape.
 *
 * Expected header (case-insensitive, columns can appear in any order):
 *
 *   executed_at, side, instrument, qty, price, fee, fee_currency
 *
 *   • executed_at  — ISO 8601 or "YYYY-MM-DD HH:MM:SS" (UTC) or unix epoch.
 *   • side         — "buy" | "sell".
 *   • instrument   — e.g. "BTC-USDT", "BTC-PERP", "BTC/USD". The normaliser
 *                    handles each common separator.
 *   • qty          — base quantity, decimal.
 *   • price        — quote per base, decimal.
 *   • fee          — decimal fee amount. Use 0 if you didn't pay one.
 *   • fee_currency — ticker (USDT, USD, ETH, ...). Defaults to the instrument
 *                    quote when blank.
 *
 * Optional columns (recognised when present):
 *   • order_id, trade_id, position_side, reduce_only, instrument_type,
 *     is_maker
 *
 * Rows without a stable `trade_id` get a synthesised id from the data —
 * re-uploads of the same file are idempotent.
 */
import { InstrumentKind, Side, FeeKind, PositionSide } from '@/types/canonical';
import type { NormalizedFill, ParserResult } from './normalized';
import { parseCsvTable, getCell } from './csv-parser';
import { normalizeSymbol } from './normalize';
import {
  decimalMul,
  parseDecimal,
  parseExecutedAt,
  deriveStableId,
  buildPayload,
} from './shared';

export function parseGeneric(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  // Validate that the required columns are present so the user gets a fast
  // failure before we start producing fills.
  for (const required of ['executed_at', 'side', 'instrument', 'qty', 'price']) {
    if (!table.headerIndex.has(required)) {
      return {
        fills,
        errors: [{
          lineNumber: 0,
          message: `Generic CSV is missing required column "${required}". Expected header: executed_at, side, instrument, qty, price, fee, fee_currency`,
        }],
      };
    }
  }

  for (const row of table.rows) {
    try {
      const time = getCell(row, table.headerIndex, 'executed_at');
      const sideRaw = getCell(row, table.headerIndex, 'side');
      const instrumentRaw = getCell(row, table.headerIndex, 'instrument');
      const qtyRaw = getCell(row, table.headerIndex, 'qty');
      const priceRaw = getCell(row, table.headerIndex, 'price');
      const feeRaw = getCell(row, table.headerIndex, 'fee');
      const feeCurrencyRaw = getCell(row, table.headerIndex, 'fee_currency');
      const tradeId = getCell(row, table.headerIndex, 'trade_id');
      const orderId = getCell(row, table.headerIndex, 'order_id');
      const positionSideRaw = getCell(row, table.headerIndex, 'position_side');
      const reduceOnlyRaw = getCell(row, table.headerIndex, 'reduce_only');
      const instrumentTypeRaw = getCell(row, table.headerIndex, 'instrument_type');
      const isMakerRaw = getCell(row, table.headerIndex, 'is_maker');

      const lowerSide = sideRaw.toLowerCase();
      if (lowerSide !== 'buy' && lowerSide !== 'sell') {
        errors.push({
          lineNumber: row.lineNumber,
          message: `Generic CSV: "side" must be "buy" or "sell" (got "${sideRaw}")`,
        });
        continue;
      }
      const side = lowerSide === 'buy' ? Side.BUY : Side.SELL;

      const hint = parseInstrumentType(instrumentTypeRaw);
      const symbol = normalizeSymbol('generic', instrumentRaw, hint);
      const qty = parseDecimal(qtyRaw);
      const priceDec = parseDecimal(priceRaw);
      const notional = decimalMul(qty, priceDec);
      const fee = feeRaw ? parseDecimal(feeRaw) : '0';
      const executedAt = parseExecutedAt(time);
      const positionSide = parsePositionSide(positionSideRaw);
      const reduceOnly = parseBool(reduceOnlyRaw);
      const isMaker = /TRUE|YES|1/i.test(isMakerRaw);

      const rawExchangeId = tradeId
        ? `generic:${tradeId}`
        : deriveStableId('generic', 'trade', [executedAt, symbol.instrument, side, qty, priceDec]);

      fills.push({
        rawExchangeId,
        rawSymbol: instrumentRaw,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide,
        reduceOnly,
        qty,
        price: priceDec,
        notional,
        fee,
        feeCurrency: feeCurrencyRaw.toUpperCase() || symbol.quote,
        feeKind: isMaker ? FeeKind.MAKER : FeeKind.TAKER,
        isMaker,
        liquidityRole: isMaker ? 'maker' : 'taker',
        orderId: orderId || null,
        executedAt,
        rawPayload: buildPayload(table.headers, row.values),
        warnings: symbol.warnings.map((m) => ({ message: m, lineNumber: row.lineNumber })),
      });
    } catch (e) {
      errors.push({
        lineNumber: row.lineNumber,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { fills, errors };
}

function parseInstrumentType(raw: string): InstrumentKind | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === 'spot') return InstrumentKind.SPOT;
  if (lower === 'perp' || lower === 'perpetual') return InstrumentKind.PERP;
  if (lower === 'dated_future' || lower === 'future') return InstrumentKind.DATED_FUTURE;
  if (lower === 'option') return InstrumentKind.OPTION;
  return undefined;
}

function parsePositionSide(raw: string): PositionSide | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'long') return PositionSide.LONG;
  if (lower === 'short') return PositionSide.SHORT;
  return null;
}

function parseBool(raw: string): boolean | null {
  if (!raw) return null;
  if (/TRUE|YES|1/i.test(raw)) return true;
  if (/FALSE|NO|0/i.test(raw)) return false;
  return null;
}
