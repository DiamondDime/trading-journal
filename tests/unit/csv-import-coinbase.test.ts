import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Coinbase CSV parser', () => {
  it('parses Advanced Trade fills export', () => {
    const csv = [
      'portfolio,trade id,product,side,created at,size,size unit,price,fee,total,price/fee/total unit',
      'default,T-001,BTC-USD,BUY,2024-09-01T12:34:01Z,0.1,BTC,65000,6.5,6506.5,USD',
      'default,T-002,ETH-USD,SELL,2024-09-02T08:00:00Z,1,ETH,3500,3.5,3496.5,USD',
    ].join('\n');

    const result = parseCsv(csv, 'coinbase');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    const buy = result.fills[0];
    expect(buy.rawExchangeId).toBe('coinbase:T-001');
    expect(buy.instrument).toBe('BTC-USD');
    expect(buy.side).toBe('buy');
    expect(buy.qty).toBe('0.1');
    expect(buy.fee).toBe('6.5');
    expect(buy.executedAt).toBe('2024-09-01T12:34:01.000Z');
  });

  it('parses retail Transactions export with one row per order', () => {
    const csv = [
      'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
      '2024-09-01T12:34:01Z,Buy,BTC,0.1,USD,65000,6500,6506.5,6.5,Bought BTC',
      '2024-09-02T08:00:00Z,Send,BTC,0.1,USD,65000,6500,6500,0,Send to wallet',
    ].join('\n');

    const result = parseCsv(csv, 'coinbase');
    expect(result.errors).toEqual([]);
    // Send is filtered out.
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0].instrument).toBe('BTC-USD');
    expect(result.fills[0].warnings.length).toBeGreaterThan(0); // approx-granularity warning
  });

  it('reports an error when neither schema is detected', () => {
    const csv = 'foo,bar\n1,2\n';
    const result = parseCsv(csv, 'coinbase');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
