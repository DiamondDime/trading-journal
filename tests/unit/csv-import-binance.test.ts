import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Binance CSV parser', () => {
  it('recognises spot Order History header and parses sample rows', () => {
    const csv = [
      'Date(UTC),Pair,Type,Order Price,Order Amount,AvgTrading Price,Filled,Total,Fee,Status',
      '2024-09-01 12:34:01,BTCUSDT,BUY,65000,0.1,64999.5,0.1,6499.95,6.4999 USDT,FILLED',
      '2024-09-02 08:00:00,ETHUSDT,SELL,3500,1,3500,1,3500,3.5 USDT,FILLED',
      '2024-09-03 09:00:00,SOLUSDT,BUY,140,2,140,2,280,0.28 USDT,CANCELLED',
    ].join('\n');

    const result = parseCsv(csv, 'binance');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2); // CANCELLED skipped

    const btc = result.fills[0];
    expect(btc.instrument).toBe('BTC-USDT');
    expect(btc.instrumentType).toBe('spot');
    expect(btc.side).toBe('buy');
    expect(btc.qty).toBe('0.1');
    expect(btc.price).toBe('64999.5');
    expect(btc.fee).toBe('6.4999');
    expect(btc.feeCurrency).toBe('USDT');
    expect(btc.executedAt).toBe('2024-09-01T12:34:01.000Z');

    const eth = result.fills[1];
    expect(eth.side).toBe('sell');
    expect(eth.instrument).toBe('ETH-USDT');
  });

  it('parses USD-M futures header and reads position side', () => {
    const csv = [
      'Time(UTC),Symbol,Side,Position Side,Order Type,Price,Quantity,Amount,Fee,Realized Profit',
      '2024-09-01 12:34:01,BTCUSDT,BUY,LONG,MARKET,65000,0.1,6500,2.6 USDT,0',
      '2024-09-01 13:34:01,BTCUSDT,SELL,LONG,MARKET,65500,0.1,6550,2.62 USDT,50',
    ].join('\n');

    const result = parseCsv(csv, 'binance');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0].instrumentType).toBe('perp');
    expect(result.fills[0].positionSide).toBe('long');
    expect(result.fills[1].side).toBe('sell');
  });

  it('reports an error for a row missing required columns', () => {
    const csv = [
      'Date(UTC),Pair,Type,Order Price,Order Amount,AvgTrading Price,Filled,Total,Fee,Status',
      '2024-09-01 12:34:01,,,65000,,,,,,FILLED',
    ].join('\n');

    const result = parseCsv(csv, 'binance');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.fills).toHaveLength(0);
  });

  it('produces stable, idempotent ids', () => {
    const csv =
      'Date(UTC),Pair,Type,Order Price,Order Amount,AvgTrading Price,Filled,Total,Fee,Status\n' +
      '2024-09-01 12:34:01,BTCUSDT,BUY,65000,0.1,64999.5,0.1,6499.95,6.4999 USDT,FILLED';
    const a = parseCsv(csv, 'binance').fills[0];
    const b = parseCsv(csv, 'binance').fills[0];
    expect(a.rawExchangeId).toBe(b.rawExchangeId);
  });
});
