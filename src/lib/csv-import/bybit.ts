/**
 * Bybit CSV parser.
 *
 * Bybit's CSV column set changes year-over-year and differs between Spot and
 * Derivatives exports. The parser handles the two shapes the user is most
 * likely to upload — anything older than 2022 may need a re-export.
 *
 * Modern derivatives "Closed P&L" export (2023+):
 *   Contracts, Closed Direction, Qty, Entry Price, Exit Price,
 *   Trade Time(UTC), Trade Type, Created Time(UTC), Order Type,
 *   Fees Paid, Closed P&L, Order ID
 *   — One row per CLOSED leg, so each row gets reified into TWO fills
 *     (the entry and the exit) using `Entry Price`/`Exit Price`. We split
 *     the row into two synthetic fills because the journal's atomic unit
 *     is the fill, not the position.
 *
 * Modern spot "Order History" export (2023+):
 *   Symbol, Side, Order Price, Filled Qty, Filled Total,
 *   Fees Paid, Order Type, Order Status, Order Time(UTC), Order ID
 *
 * Cancelled / open orders are skipped. If `Trade Type` says "Funding" we
 * skip (funding events have their own table). Bybit's `Fees Paid` carries
 * the currency directly ("0.55 USDT"). `Side` for derivatives uses
 * Buy/Sell; "Close Long"/"Close Short" indicates a reduce-only fill.
 */
import { InstrumentKind, Side, FeeKind, PositionSide } from '@/types/canonical';
import type { NormalizedFill, ParserResult } from './normalized';
import { parseCsvTable, getCell } from './csv-parser';
import { normalizeSymbol } from './normalize';
import {
  decimalMul,
  parseDecimal,
  parseFeeWithCurrency,
  parseExecutedAt,
  deriveStableId,
  buildPayload,
} from './shared';

export function parseBybit(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  const isClosedPnl =
    table.headerIndex.has('contracts') && table.headerIndex.has('entry price');

  for (const row of table.rows) {
    try {
      const status =
        getCell(row, table.headerIndex, 'Order Status') ||
        getCell(row, table.headerIndex, 'Status');
      if (status && !/FILL|EXECUTED|DEAL|FULL|PART/i.test(status)) continue;

      const tradeType = getCell(row, table.headerIndex, 'Trade Type');
      if (tradeType && /FUNDING/i.test(tradeType)) continue;

      if (isClosedPnl) {
        const rows = expandClosedPnlRow(table.headers, row.values, row.lineNumber, table.headerIndex);
        fills.push(...rows.fills);
        errors.push(...rows.errors);
        continue;
      }

      // Spot path.
      const symbolRaw = getCell(row, table.headerIndex, 'Symbol');
      const sideRaw = getCell(row, table.headerIndex, 'Side');
      const priceRaw =
        getCell(row, table.headerIndex, 'Order Price') ||
        getCell(row, table.headerIndex, 'Avg Filled Price') ||
        getCell(row, table.headerIndex, 'Average Price');
      const qtyRaw =
        getCell(row, table.headerIndex, 'Filled Qty') ||
        getCell(row, table.headerIndex, 'Qty') ||
        getCell(row, table.headerIndex, 'Filled');
      const totalRaw =
        getCell(row, table.headerIndex, 'Filled Total') ||
        getCell(row, table.headerIndex, 'Total');
      const feeRaw = getCell(row, table.headerIndex, 'Fees Paid');
      const dateRaw =
        getCell(row, table.headerIndex, 'Order Time(UTC)') ||
        getCell(row, table.headerIndex, 'Filled Time(UTC)') ||
        getCell(row, table.headerIndex, 'Time');
      const orderId = getCell(row, table.headerIndex, 'Order ID');
      const orderType = getCell(row, table.headerIndex, 'Order Type');

      if (!symbolRaw || !sideRaw || !priceRaw || !qtyRaw || !dateRaw) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing one of required columns: Symbol, Side, Price, Qty, Time',
        });
        continue;
      }

      const symbol = normalizeSymbol('bybit', symbolRaw);
      const side: Side = sideRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
      const price = parseDecimal(priceRaw);
      const qty = parseDecimal(qtyRaw);
      const notional = totalRaw ? parseDecimal(totalRaw) : decimalMul(qty, price);
      const fee = parseFeeWithCurrency(feeRaw);
      const executedAt = parseExecutedAt(dateRaw);
      const isMaker = /LIMIT|MAKER|POST/i.test(orderType);
      const rawExchangeId = orderId
        ? `bybit:${orderId}`
        : deriveStableId('bybit', 'spot', [executedAt, symbol.instrument, side, qty, price]);

      fills.push({
        rawExchangeId,
        rawSymbol: symbolRaw,
        instrument: symbol.instrument,
        instrumentType: symbol.instrumentType,
        side,
        positionSide: null,
        reduceOnly: null,
        qty,
        price,
        notional,
        fee: fee.amount,
        feeCurrency: fee.currency || symbol.quote,
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

/**
 * Bybit's "Closed P&L" CSV gives one row per closed leg. We synthesise both
 * fills (entry + exit) so the journal's per-fill granularity is preserved.
 * Entry uses `Created Time` as `executed_at`; exit uses `Trade Time`.
 */
function expandClosedPnlRow(
  headers: string[],
  values: string[],
  lineNumber: number,
  headerIndex: Map<string, number>,
): ParserResult {
  const out: ParserResult = { fills: [], errors: [] };
  const row = { lineNumber, values };
  try {
    const symbolRaw = getCell(row, headerIndex, 'Contracts');
    const directionRaw = getCell(row, headerIndex, 'Closed Direction'); // "Buy" closes a short, "Sell" closes a long
    const qty = parseDecimal(getCell(row, headerIndex, 'Qty'));
    const entryPrice = parseDecimal(getCell(row, headerIndex, 'Entry Price'));
    const exitPrice = parseDecimal(getCell(row, headerIndex, 'Exit Price'));
    const fee = parseFeeWithCurrency(getCell(row, headerIndex, 'Fees Paid'));
    const entryAt = parseExecutedAt(getCell(row, headerIndex, 'Created Time(UTC)'));
    const exitAt = parseExecutedAt(getCell(row, headerIndex, 'Trade Time(UTC)'));
    const orderId = getCell(row, headerIndex, 'Order ID');

    const symbol = normalizeSymbol('bybit', symbolRaw, InstrumentKind.PERP);
    // "Closed Direction" tells us which side closes the position. Entry is
    // the opposite side; exit is what the row literally states.
    const closingSide: Side = directionRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
    const entrySide: Side = closingSide === Side.BUY ? Side.SELL : Side.BUY;
    const positionSide: PositionSide = closingSide === Side.BUY ? PositionSide.SHORT : PositionSide.LONG;

    const entryNotional = decimalMul(qty, entryPrice);
    const exitNotional = decimalMul(qty, exitPrice);

    out.fills.push({
      rawExchangeId: orderId
        ? `bybit:${orderId}:open`
        : deriveStableId('bybit', 'pnl-open', [entryAt, symbol.instrument, qty, entryPrice]),
      rawSymbol: symbolRaw,
      instrument: symbol.instrument,
      instrumentType: symbol.instrumentType,
      side: entrySide,
      positionSide,
      reduceOnly: false,
      qty,
      price: entryPrice,
      notional: entryNotional,
      fee: '0',
      feeCurrency: fee.currency || symbol.quote,
      feeKind: FeeKind.TAKER,
      isMaker: false,
      liquidityRole: 'taker',
      orderId: orderId || null,
      executedAt: entryAt,
      rawPayload: buildPayload(headers, values),
      warnings: [
        { message: 'Bybit Closed P&L row: opening fill synthesized from Entry Price', lineNumber },
        ...symbol.warnings.map((m) => ({ message: m, lineNumber })),
      ],
    });

    out.fills.push({
      rawExchangeId: orderId
        ? `bybit:${orderId}:close`
        : deriveStableId('bybit', 'pnl-close', [exitAt, symbol.instrument, qty, exitPrice]),
      rawSymbol: symbolRaw,
      instrument: symbol.instrument,
      instrumentType: symbol.instrumentType,
      side: closingSide,
      positionSide,
      reduceOnly: true,
      qty,
      price: exitPrice,
      notional: exitNotional,
      fee: fee.amount,
      feeCurrency: fee.currency || symbol.quote,
      feeKind: FeeKind.TAKER,
      isMaker: false,
      liquidityRole: 'taker',
      orderId: orderId || null,
      executedAt: exitAt,
      rawPayload: buildPayload(headers, values),
      warnings: [
        { message: 'Bybit Closed P&L row: closing fill carries full row fee', lineNumber },
      ],
    });
  } catch (e) {
    out.errors.push({
      lineNumber,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return out;
}
