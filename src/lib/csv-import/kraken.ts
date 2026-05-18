/**
 * Kraken CSV parser.
 *
 * Kraken's "Trades" export is one of the cleanest in the industry — one row
 * per fill, stable trade id, and a published column contract. Schema (as of
 * 2024-2026):
 *
 *   txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol,margin,misc,ledgers
 *
 *   • txid       — Kraken's stable trade id → perfect rawExchangeId.
 *   • ordertxid  — parent order id, exposed via `orderId`.
 *   • pair       — legacy form (e.g. XXBTZUSD) or modern (e.g. BTC/USD).
 *   • time       — Unix seconds with decimal microseconds, e.g. "1725193241.4239".
 *   • type       — "buy" | "sell".
 *   • ordertype  — "limit" | "market" | "stop-loss" | ...
 *   • price      — Numeric, quote per base.
 *   • cost       — Notional (price * vol), quote currency.
 *   • fee        — Quote currency, ALREADY signed.
 *   • vol        — Base quantity.
 *   • margin     — Set when the trade used margin; we use it to flag
 *                  futures vs spot.
 *
 * Kraken's Pro CSV uses the same column names but ships modern symbols, no
 * X/Z prefixes. The parser handles both.
 */
import { Side, FeeKind, PositionSide } from '@/types/canonical';
import type { NormalizedFill, ParserResult } from './normalized';
import { parseCsvTable, getCell } from './csv-parser';
import { normalizeSymbol } from './normalize';
import {
  parseDecimal,
  parseExecutedAt,
  deriveStableId,
  buildPayload,
} from './shared';

export function parseKraken(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  for (const row of table.rows) {
    try {
      const txid = getCell(row, table.headerIndex, 'txid');
      const ordertxid = getCell(row, table.headerIndex, 'ordertxid');
      const pair = getCell(row, table.headerIndex, 'pair');
      const time = getCell(row, table.headerIndex, 'time');
      const typeRaw = getCell(row, table.headerIndex, 'type');
      const orderType = getCell(row, table.headerIndex, 'ordertype');
      const price = getCell(row, table.headerIndex, 'price');
      const cost = getCell(row, table.headerIndex, 'cost');
      const fee = getCell(row, table.headerIndex, 'fee');
      const vol = getCell(row, table.headerIndex, 'vol');
      const margin = getCell(row, table.headerIndex, 'margin');

      if (!pair || !time || !typeRaw || !price || !vol) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing required column (pair, time, type, price, vol)',
        });
        continue;
      }

      const symbol = normalizeSymbol('kraken', pair);
      const side: Side = typeRaw.toLowerCase().startsWith('b') ? Side.BUY : Side.SELL;
      const priceDec = parseDecimal(price);
      const qty = parseDecimal(vol);
      const notional = cost ? parseDecimal(cost) : parseDecimal('0');
      const feeAmount = fee ? parseDecimal(fee) : '0';
      const executedAt = parseExecutedAt(time);
      const isMargin = !!margin && parseDecimal(margin) !== '0';
      const isMaker = /LIMIT/i.test(orderType);

      const positionSide: PositionSide | null = isMargin
        ? side === Side.BUY
          ? PositionSide.LONG
          : PositionSide.SHORT
        : null;

      const rawExchangeId = txid
        ? `kraken:${txid}`
        : deriveStableId('kraken', 'trade', [executedAt, symbol.instrument, side, qty, priceDec]);

      fills.push({
        rawExchangeId,
        rawSymbol: pair,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide,
        reduceOnly: null,
        qty,
        price: priceDec,
        notional,
        fee: feeAmount,
        feeCurrency: symbol.quote,
        feeKind: isMaker ? FeeKind.MAKER : FeeKind.TAKER,
        isMaker,
        liquidityRole: isMaker ? 'maker' : 'taker',
        orderId: ordertxid || null,
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
