/**
 * Vertex CSV parser.
 *
 * Vertex doesn't ship a first-party CSV export — users typically pull
 * trade history from Solscan/Etherscan or the Vertex frontend's "Export
 * trades" button. We support both the explorer-style "token transfers"
 * shape and the venue-style "trade history" shape.
 *
 * Venue-style "Trade History" export (newer Vertex frontend, 2025+):
 *   Time, Product, Side, Size, Price, Notional, Fee, Filled, Tx Hash
 *   — Direct mapping; the `Tx Hash` is the chain-level idempotency key.
 *
 * Explorer-style "Token Transfers" fallback:
 *   Txhash, Blockno, UnixTimestamp, DateTime, From, To, TokenValue,
 *   USDValue, ContractAddress, TokenName, TokenSymbol
 *   — Heuristic: any IN/OUT movement of a quote token (USDC) paired with
 *     an OUT/IN of a base token on the same tx is a fill. We're not
 *     trying to reconstruct on-chain order matching here — the user is
 *     expected to import structured exports for production data.
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

export function parseVertex(content: string): ParserResult {
  const table = parseCsvTable(content);
  const fills: NormalizedFill[] = [];
  const errors: ParserResult['errors'] = [];

  if (table.headers.length === 0) {
    return { fills, errors: [{ lineNumber: 0, message: 'Empty CSV' }] };
  }

  const isVenueExport =
    table.headerIndex.has('product') && table.headerIndex.has('side');

  if (!isVenueExport) {
    return {
      fills,
      errors: [{
        lineNumber: 0,
        message:
          'Vertex import currently supports only the venue-style "Trade History" export. ' +
          'Explorer-style token-transfer CSVs are not yet wired through — re-export from the Vertex frontend.',
      }],
    };
  }

  for (const row of table.rows) {
    try {
      const time = getCell(row, table.headerIndex, 'Time');
      const productRaw = getCell(row, table.headerIndex, 'Product');
      const sideRaw = getCell(row, table.headerIndex, 'Side');
      const sizeRaw = getCell(row, table.headerIndex, 'Size');
      const priceRaw = getCell(row, table.headerIndex, 'Price');
      const notionalRaw = getCell(row, table.headerIndex, 'Notional');
      const feeRaw = getCell(row, table.headerIndex, 'Fee');
      const txHash = getCell(row, table.headerIndex, 'Tx Hash') || getCell(row, table.headerIndex, 'Txhash');

      if (!time || !productRaw || !sideRaw || !sizeRaw || !priceRaw) {
        errors.push({
          lineNumber: row.lineNumber,
          message: 'Missing required Vertex column (Time, Product, Side, Size, Price)',
        });
        continue;
      }

      const symbol = normalizeSymbol(
        'vertex',
        productRaw,
        /-PERP/i.test(productRaw) ? InstrumentKind.PERP : InstrumentKind.SPOT,
      );
      const side: Side = sideRaw.toUpperCase().startsWith('B') ? Side.BUY : Side.SELL;
      const qty = parseDecimal(sizeRaw);
      const priceDec = parseDecimal(priceRaw);
      const notional = notionalRaw ? parseDecimal(notionalRaw) : decimalMul(qty, priceDec);
      const fee = feeRaw ? parseDecimal(feeRaw) : '0';
      const executedAt = parseExecutedAt(time);

      const rawExchangeId = txHash
        ? `vertex:${txHash}`
        : deriveStableId('vertex', 'trade', [executedAt, symbol.instrument, side, qty, priceDec]);

      fills.push({
        rawExchangeId,
        rawSymbol: productRaw,
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
        orderId: txHash || null,
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
