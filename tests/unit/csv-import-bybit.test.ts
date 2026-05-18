import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Bybit CSV parser', () => {
  it('parses modern Spot Order History export', () => {
    const csv = [
      'Symbol,Side,Order Price,Filled Qty,Filled Total,Fees Paid,Order Type,Order Status,Order Time(UTC),Order ID',
      'BTCUSDT,Buy,65000,0.1,6500,6.5 USDT,Limit,Filled,2024-09-01 12:34:01,ORD123',
      'ETHUSDT,Sell,3500,1,3500,3.5 USDT,Market,Filled,2024-09-02 08:00:00,ORD124',
      'SOLUSDT,Buy,140,2,280,0.28 USDT,Limit,Cancelled,2024-09-03 09:00:00,ORD125',
    ].join('\n');

    const result = parseCsv(csv, 'bybit');
    expect(result.errors).toEqual([]);
    // Cancelled row is filtered.
    expect(result.fills).toHaveLength(2);

    const btc = result.fills[0];
    expect(btc.instrument).toBe('BTC-USDT');
    expect(btc.side).toBe('buy');
    expect(btc.qty).toBe('0.1');
    expect(btc.fee).toBe('6.5');
    expect(btc.feeCurrency).toBe('USDT');
    expect(btc.isMaker).toBe(true); // Limit = maker per parser heuristic
    expect(btc.orderId).toBe('ORD123');
    expect(btc.rawExchangeId).toContain('bybit:');
  });

  it('expands Closed P&L row into entry + exit fills', () => {
    const csv = [
      'Contracts,Closed Direction,Qty,Entry Price,Exit Price,Trade Time(UTC),Trade Type,Created Time(UTC),Order Type,Fees Paid,Closed P&L,Order ID',
      'BTCUSDT,Sell,1,65000,66000,2024-09-02 08:00:00,Trade,2024-09-01 12:34:01,Market,5 USDT,1000,ORD500',
    ].join('\n');

    const result = parseCsv(csv, 'bybit');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    const [open, close] = result.fills;
    expect(open.executedAt).toBe('2024-09-01T12:34:01.000Z');
    expect(open.side).toBe('buy');
    expect(open.positionSide).toBe('long');
    expect(open.price).toBe('65000');
    expect(open.reduceOnly).toBe(false);

    expect(close.executedAt).toBe('2024-09-02T08:00:00.000Z');
    expect(close.side).toBe('sell');
    expect(close.reduceOnly).toBe(true);
    expect(close.price).toBe('66000');
    expect(close.fee).toBe('5'); // closing leg carries the row fee
  });

  it('rejects a row that is missing required columns', () => {
    const csv = [
      'Symbol,Side,Order Price,Filled Qty,Filled Total,Fees Paid,Order Type,Order Status,Order Time(UTC),Order ID',
      ',Buy,,,,,Limit,Filled,,',
    ].join('\n');

    const result = parseCsv(csv, 'bybit');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.fills).toHaveLength(0);
  });

  it('skips funding rows', () => {
    const csv = [
      'Symbol,Side,Order Price,Filled Qty,Filled Total,Fees Paid,Order Type,Order Status,Order Time(UTC),Order ID,Trade Type',
      'BTCUSDT,Buy,65000,0.1,6500,6.5 USDT,Limit,Filled,2024-09-01 12:34:01,ORD1,Trade',
      'BTCUSDT,Buy,65000,0.1,6500,0 USDT,Limit,Filled,2024-09-01 16:34:01,ORD2,Funding',
    ].join('\n');

    const result = parseCsv(csv, 'bybit');
    expect(result.fills).toHaveLength(1);
  });
});
