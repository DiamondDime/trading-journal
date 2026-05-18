/**
 * Binance CSV parser.
 *
 * Handles two common export shapes:
 *
 * 1) Spot — "Order History" / "Trade History" export:
 *    Date(UTC),Pair,Type,Order Price,Order Amount,AvgTrading Price,Filled,Total,Fee,Status
 *    e.g.   2024-09-01 12:34:01,BTCUSDT,BUY,65000,0.1,64999.5,0.1,6499.95,6.4999 USDT,FILLED
 *
 * 2) Futures — "USD-M Trade History":
 *    Time(UTC),Symbol,Side,Position Side,Order Type,Price,Quantity,Amount,Fee,Realized Profit
 *    e.g.   2024-09-01 12:34:01,BTCUSDT,BUY,LONG,MARKET,65000,0.1,6500,2.6 USDT,0
 *
 * The detector picks the right schema by checking which columns exist. Rows
 * that don't have a "FILLED" status (where the column exists) are skipped —
 * the journal's atomic unit is the fill, not the order.
 */
import { InstrumentKind, Side, FeeKind, PositionSide } from '@/types/canonical';
import type { NormalizedFill, ParserResult } from './normalized';
import { parseCsvTable, getCell } from './csv-parser';
import { normalizeSymbol } from './normalize';
import { decimalMul, parseDecimal, parseFeeWithCurrency, parseExecutedAt, deriveStableId, buildPayload } from './shared';

export function parseBinance(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  const isFutures = table.headerIndex.has('position side') || table.headerIndex.has('realized profit');
  const isSpot = !isFutures;

  for (const row of table.rows) {
    try {
      const status = getCell(row, table.headerIndex, 'Status');
      if (status && status.toUpperCase() !== 'FILLED' && status.toUpperCase() !== 'PARTIALLY_FILLED') {
        // Open / cancelled orders are not fills.
        continue;
      }

      const dateRaw =
        getCell(row, table.headerIndex, 'Date(UTC)') ||
        getCell(row, table.headerIndex, 'Time(UTC)') ||
        getCell(row, table.headerIndex, 'Date');
      const symbolRaw =
        getCell(row, table.headerIndex, 'Pair') ||
        getCell(row, table.headerIndex, 'Symbol');
      const sideRaw =
        getCell(row, table.headerIndex, 'Type') ||
        getCell(row, table.headerIndex, 'Side');
      const priceRaw =
        getCell(row, table.headerIndex, 'AvgTrading Price') ||
        getCell(row, table.headerIndex, 'Price') ||
        getCell(row, table.headerIndex, 'Order Price');
      const qtyRaw =
        getCell(row, table.headerIndex, 'Filled') ||
        getCell(row, table.headerIndex, 'Quantity') ||
        getCell(row, table.headerIndex, 'Order Amount');
      const totalRaw =
        getCell(row, table.headerIndex, 'Total') ||
        getCell(row, table.headerIndex, 'Amount');
      const feeRaw = getCell(row, table.headerIndex, 'Fee');
      const positionSideRaw = getCell(row, table.headerIndex, 'Position Side');

      if (!dateRaw || !symbolRaw || !sideRaw || !priceRaw || !qtyRaw) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing one of required columns: Date, Pair/Symbol, Type/Side, Price, Quantity/Filled',
        });
        continue;
      }

      const symbol = normalizeSymbol('binance', symbolRaw, isFutures ? InstrumentKind.PERP : InstrumentKind.SPOT);
      const side: Side = sideRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
      const price = parseDecimal(priceRaw);
      const qty = parseDecimal(qtyRaw);
      const notional = totalRaw ? parseDecimal(totalRaw) : decimalMul(qty, price);
      const fee = parseFeeWithCurrency(feeRaw);
      const executedAt = parseExecutedAt(dateRaw);
      const positionSide: PositionSide | null = isFutures
        ? positionSideRaw.toUpperCase() === 'LONG'
          ? PositionSide.LONG
          : positionSideRaw.toUpperCase() === 'SHORT'
            ? PositionSide.SHORT
            : null
        : null;

      // Binance spot CSVs don't ship a trade id at all. We derive a stable
      // hash from (timestamp + pair + qty + price) so re-imports stay
      // idempotent. The same approach is used by ccxt for venues that
      // don't expose trade ids on the order endpoint.
      const stableId = deriveStableId('binance', isSpot ? 'spot' : 'futures', [
        executedAt,
        symbol.instrument,
        side,
        qty,
        price,
      ]);

      fills.push({
        rawExchangeId: stableId,
        rawSymbol: symbolRaw,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide,
        reduceOnly: null,
        qty,
        price,
        notional,
        fee: fee.amount,
        feeCurrency: fee.currency || symbol.quote,
        feeKind: FeeKind.TAKER,
        isMaker: false,
        liquidityRole: 'taker',
        orderId: null,
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
