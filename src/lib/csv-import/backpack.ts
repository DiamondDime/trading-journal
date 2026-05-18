/**
 * Backpack CSV parser.
 *
 * Backpack's "Trade History" export (as of 2025-2026):
 *   Trade ID, Order ID, Symbol, Side, Quantity, Price, Quote Quantity,
 *   Fee, Fee Symbol, Maker, Time
 *
 * Symbols use underscore separators: BTC_USDC, BTC_USDC_PERP. The
 * normaliser handles both.
 *
 * Backpack is one of the venues we DON'T have a ccxt adapter for in v1, so
 * this CSV path is the only ingest route. The schema is documented in
 * Backpack's API docs and stable in our testing.
 */
import { Side, FeeKind } from '@/types/canonical';
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

export function parseBackpack(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  for (const row of table.rows) {
    try {
      const tradeId = getCell(row, table.headerIndex, 'Trade ID');
      const orderId = getCell(row, table.headerIndex, 'Order ID');
      const symbolRaw = getCell(row, table.headerIndex, 'Symbol');
      const sideRaw = getCell(row, table.headerIndex, 'Side');
      const qtyRaw = getCell(row, table.headerIndex, 'Quantity');
      const priceRaw = getCell(row, table.headerIndex, 'Price');
      const quoteQty = getCell(row, table.headerIndex, 'Quote Quantity');
      const feeRaw = getCell(row, table.headerIndex, 'Fee');
      const feeSym = getCell(row, table.headerIndex, 'Fee Symbol');
      const makerRaw = getCell(row, table.headerIndex, 'Maker');
      const time = getCell(row, table.headerIndex, 'Time');

      if (!symbolRaw || !sideRaw || !qtyRaw || !priceRaw || !time) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing required column (Symbol, Side, Quantity, Price, Time)',
        });
        continue;
      }

      const symbol = normalizeSymbol('backpack', symbolRaw);
      const side: Side = sideRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
      const qty = parseDecimal(qtyRaw);
      const priceDec = parseDecimal(priceRaw);
      const notional = quoteQty ? parseDecimal(quoteQty) : decimalMul(qty, priceDec);
      const fee = feeRaw ? parseDecimal(feeRaw) : '0';
      const executedAt = parseExecutedAt(time);
      const isMaker = /TRUE|YES|1/i.test(makerRaw);

      const rawExchangeId = tradeId
        ? `backpack:${tradeId}`
        : deriveStableId('backpack', 'trade', [executedAt, symbol.instrument, side, qty, priceDec]);

      fills.push({
        rawExchangeId,
        rawSymbol: symbolRaw,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide: null,
        reduceOnly: null,
        qty,
        price: priceDec,
        notional,
        fee,
        feeCurrency: feeSym || symbol.quote,
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
