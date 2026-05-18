/**
 * Drift CSV parser.
 *
 * Drift v2 (Solana perp DEX) doesn't ship a first-party CSV but the user
 * can pull trade history via the Drift API and dump it to CSV, or use the
 * Drift Stats explorer's "Export Trades" button. Either path produces:
 *
 *   Timestamp, Market, Direction, Size, Price, Quote Asset Amount,
 *   Fee, Liquidity, Tx Signature
 *
 *   • Direction is `long` | `short` — we convert to buy/sell (long ↔ buy).
 *   • Liquidity is `maker` | `taker`.
 *   • Tx Signature is the on-chain signature → perfect idempotency key.
 *
 * Drift is perps-only in v1; spot trades go through Drift Spot which has a
 * different export format (and we don't support it yet).
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

export function parseDrift(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  for (const row of table.rows) {
    try {
      const time = getCell(row, table.headerIndex, 'Timestamp');
      const marketRaw = getCell(row, table.headerIndex, 'Market');
      const directionRaw = getCell(row, table.headerIndex, 'Direction');
      const sizeRaw = getCell(row, table.headerIndex, 'Size');
      const priceRaw = getCell(row, table.headerIndex, 'Price');
      const quoteAmount = getCell(row, table.headerIndex, 'Quote Asset Amount');
      const feeRaw = getCell(row, table.headerIndex, 'Fee');
      const liquidityRaw = getCell(row, table.headerIndex, 'Liquidity');
      const sig = getCell(row, table.headerIndex, 'Tx Signature') || getCell(row, table.headerIndex, 'Signature');

      if (!time || !marketRaw || !directionRaw || !sizeRaw || !priceRaw) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing required Drift column (Timestamp, Market, Direction, Size, Price)',
        });
        continue;
      }

      const symbol = normalizeSymbol('drift', marketRaw, InstrumentKind.PERP);
      const isLong = /LONG/i.test(directionRaw);
      const side: Side = isLong ? Side.BUY : Side.SELL;
      const positionSide: PositionSide = isLong ? PositionSide.LONG : PositionSide.SHORT;
      const qty = parseDecimal(sizeRaw);
      const priceDec = parseDecimal(priceRaw);
      const notional = quoteAmount ? parseDecimal(quoteAmount) : decimalMul(qty, priceDec);
      const fee = feeRaw ? parseDecimal(feeRaw) : '0';
      const executedAt = parseExecutedAt(time);
      const isMaker = /MAKER/i.test(liquidityRaw);

      const rawExchangeId = sig
        ? `drift:${sig}`
        : deriveStableId('drift', 'perp', [executedAt, symbol.instrument, side, qty, priceDec]);

      fills.push({
        rawExchangeId,
        rawSymbol: marketRaw,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide,
        reduceOnly: null,
        qty,
        price: priceDec,
        notional,
        fee,
        feeCurrency: symbol.quote,
        feeKind: isMaker ? FeeKind.MAKER : FeeKind.TAKER,
        isMaker,
        liquidityRole: isMaker ? 'maker' : 'taker',
        orderId: sig || null,
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
