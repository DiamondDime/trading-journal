/**
 * Coinbase CSV parser.
 *
 * Coinbase ships two materially different exports:
 *
 * 1) Coinbase Pro / Advanced Trade "Fills" export:
 *    portfolio,trade id,product,side,created at,size,size unit,
 *    price,fee,total,price/fee/total unit
 *    — One row per fill. The stable `trade id` is perfect for idempotency.
 *
 * 2) Retail Coinbase "Transactions" export (less common, no trade-level
 *    granularity — one row per order). Schema:
 *    Timestamp, Transaction Type, Asset, Quantity Transacted,
 *    Spot Price Currency, Spot Price at Transaction, Subtotal,
 *    Total (inclusive of fees and/or spread), Fees and/or Spread, Notes
 *    — We tolerate this format too but warn that fill-level granularity
 *      is approximate.
 *
 * The parser detects which shape is present by checking for `trade id`.
 */
import { InstrumentKind, Side, FeeKind } from '@/types/canonical';
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

export function parseCoinbase(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  const isAdvanced =
    table.headerIndex.has('trade id') || table.headerIndex.has('product');
  const isRetail =
    table.headerIndex.has('quantity transacted') ||
    table.headerIndex.has('transaction type');

  for (const row of table.rows) {
    try {
      if (isAdvanced) {
        const tradeId = getCell(row, table.headerIndex, 'trade id');
        const product = getCell(row, table.headerIndex, 'product');
        const sideRaw = getCell(row, table.headerIndex, 'side');
        const created = getCell(row, table.headerIndex, 'created at');
        const size = getCell(row, table.headerIndex, 'size');
        const price = getCell(row, table.headerIndex, 'price');
        const feeRaw = getCell(row, table.headerIndex, 'fee');
        const total = getCell(row, table.headerIndex, 'total');

        if (!product || !sideRaw || !created || !size || !price) {
          errors.push({
            lineNumber: row.lineNumber,
            message: 'Missing required column (product, side, created at, size, price)',
          });
          continue;
        }

        const symbol = normalizeSymbol('coinbase', product);
        const side: Side = sideRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
        const qty = parseDecimal(size);
        const priceDec = parseDecimal(price);
        const notional = total ? parseDecimal(total).replace(/^-/, '') : decimalMul(qty, priceDec);
        const fee = feeRaw ? parseDecimal(feeRaw) : '0';
        const executedAt = parseExecutedAt(created);

        const rawExchangeId = tradeId
          ? `coinbase:${tradeId}`
          : deriveStableId('coinbase', 'advanced', [executedAt, symbol.instrument, side, qty, priceDec]);

        fills.push({
          rawExchangeId,
          rawSymbol: product,
          instrument: symbol.instrument,
          instrumentType: symbol.instrumentType,
          side,
          positionSide: null,
          reduceOnly: null,
          qty,
          price: priceDec,
          notional,
          fee,
          feeCurrency: symbol.quote,
          feeKind: FeeKind.TAKER,
          isMaker: false,
          liquidityRole: 'taker',
          orderId: null,
          executedAt,
          rawPayload: buildPayload(table.headers, row.values),
          warnings: symbol.warnings.map((m) => ({ message: m, lineNumber: row.lineNumber })),
        });
        continue;
      }

      if (isRetail) {
        const typeRaw = getCell(row, table.headerIndex, 'Transaction Type');
        // Skip the rows that aren't buys/sells (sends, receives, conversions).
        if (typeRaw && !/^(BUY|SELL|CONVERT)/i.test(typeRaw)) continue;

        const date = getCell(row, table.headerIndex, 'Timestamp');
        const asset = getCell(row, table.headerIndex, 'Asset');
        const qtyRaw = getCell(row, table.headerIndex, 'Quantity Transacted');
        const quoteCurrency = getCell(row, table.headerIndex, 'Spot Price Currency') || 'USD';
        const priceRaw = getCell(row, table.headerIndex, 'Spot Price at Transaction');
        const subtotal = getCell(row, table.headerIndex, 'Subtotal');
        const feeRaw = getCell(row, table.headerIndex, 'Fees and/or Spread');

        if (!asset || !qtyRaw || !priceRaw) {
          errors.push({
            lineNumber: row.lineNumber,
            message: 'Retail Coinbase export missing required columns',
          });
          continue;
        }

        const side: Side = /SELL/i.test(typeRaw) ? Side.SELL : Side.BUY;
        const qty = parseDecimal(qtyRaw);
        const priceDec = parseDecimal(priceRaw);
        const notional = subtotal ? parseDecimal(subtotal) : decimalMul(qty, priceDec);
        const fee = feeRaw ? parseDecimal(feeRaw) : '0';
        const executedAt = parseExecutedAt(date);
        const instrument = `${asset}-${quoteCurrency}`;

        fills.push({
          rawExchangeId: deriveStableId('coinbase', 'retail', [executedAt, asset, side, qty, priceDec]),
          rawSymbol: instrument,
          instrument,
          instrumentType: InstrumentKind.SPOT,
          side,
          positionSide: null,
          reduceOnly: null,
          qty,
          price: priceDec,
          notional,
          fee,
          feeCurrency: quoteCurrency,
          feeKind: FeeKind.TAKER,
          isMaker: false,
          liquidityRole: 'taker',
          orderId: null,
          executedAt,
          rawPayload: buildPayload(table.headers, row.values),
          warnings: [{
            message: 'Retail Coinbase export: fill granularity is approximate (one row per order)',
            lineNumber: row.lineNumber,
          }],
        });
        continue;
      }

      errors.push({
        lineNumber: row.lineNumber,
        message: 'Could not detect Coinbase export schema (need `trade id`/`product` or `Quantity Transacted`)',
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
