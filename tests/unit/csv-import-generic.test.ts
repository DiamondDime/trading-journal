import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Generic CSV parser', () => {
  it('parses the documented header', () => {
    const csv = [
      'executed_at,side,instrument,qty,price,fee,fee_currency',
      '2024-09-01T12:34:01Z,buy,BTC-USDT,0.1,65000,6.5,USDT',
      '2024-09-02T08:00:00Z,sell,ETH-USD,1,3500,3.5,USD',
    ].join('\n');

    const result = parseCsv(csv, 'generic');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    expect(result.fills[0].instrument).toBe('BTC-USDT');
    expect(result.fills[0].side).toBe('buy');
    expect(result.fills[0].fee).toBe('6.5');
    expect(result.fills[0].feeCurrency).toBe('USDT');
    expect(result.fills[1].side).toBe('sell');
  });

  it('respects optional instrument_type to override the spot default', () => {
    const csv = [
      'executed_at,side,instrument,qty,price,fee,fee_currency,instrument_type,position_side',
      '2024-09-01T12:34:01Z,buy,BTC-PERP,0.1,65000,6.5,USDT,perp,long',
    ].join('\n');

    const result = parseCsv(csv, 'generic');
    expect(result.fills[0].instrumentType).toBe('perp');
    expect(result.fills[0].positionSide).toBe('long');
  });

  it('returns a file-level error when required columns are missing', () => {
    const csv = 'foo,bar\n1,2\n';
    const result = parseCsv(csv, 'generic');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/missing required column/i);
  });

  it('rejects an invalid side', () => {
    const csv = [
      'executed_at,side,instrument,qty,price,fee,fee_currency',
      '2024-09-01T12:34:01Z,maybe,BTC-USDT,0.1,65000,6.5,USDT',
    ].join('\n');
    const result = parseCsv(csv, 'generic');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/side/i);
  });

  it('synthesises stable ids when no trade_id column is provided', () => {
    const csv = [
      'executed_at,side,instrument,qty,price,fee,fee_currency',
      '2024-09-01T12:34:01Z,buy,BTC-USDT,0.1,65000,6.5,USDT',
    ].join('\n');
    const a = parseCsv(csv, 'generic').fills[0].rawExchangeId;
    const b = parseCsv(csv, 'generic').fills[0].rawExchangeId;
    expect(a).toBe(b);
    expect(a.startsWith('csv:')).toBe(true);
  });

  it('uses the supplied trade_id when present', () => {
    const csv = [
      'executed_at,side,instrument,qty,price,fee,fee_currency,trade_id',
      '2024-09-01T12:34:01Z,buy,BTC-USDT,0.1,65000,6.5,USDT,T-XYZ',
    ].join('\n');
    expect(parseCsv(csv, 'generic').fills[0].rawExchangeId).toBe('generic:T-XYZ');
  });
});
