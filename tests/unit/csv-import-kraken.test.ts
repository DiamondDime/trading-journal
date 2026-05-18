import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Kraken CSV parser', () => {
  it('parses the canonical Trades export', () => {
    const csv = [
      'txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol,margin,misc,ledgers',
      'TXAAAA1,ORDBBB1,XBTUSDT,1725193241.4239,buy,limit,65000,6500,3.25,0.1,0,,LL1',
      'TXAAAA2,ORDBBB2,XBTUSDT,1725196841.0,sell,market,65500,6550,3.27,0.1,0,,LL2',
    ].join('\n');

    const result = parseCsv(csv, 'kraken');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    const buy = result.fills[0];
    expect(buy.rawExchangeId).toBe('kraken:TXAAAA1');
    expect(buy.instrument).toBe('BTC-USDT'); // XBT → BTC mapped
    expect(buy.side).toBe('buy');
    expect(buy.qty).toBe('0.1');
    expect(buy.price).toBe('65000');
    expect(buy.fee).toBe('3.25');
    expect(buy.isMaker).toBe(true); // limit
    // Kraken's `time` is fractional unix seconds — we round to the nearest ms.
    expect(buy.executedAt).toBe(new Date(Math.round(1725193241.4239 * 1000)).toISOString());

    const sell = result.fills[1];
    expect(sell.isMaker).toBe(false); // market
  });

  it('handles the friendly BTC/USD pair format', () => {
    const csv = [
      'txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol,margin,misc,ledgers',
      'TX1,ORD1,BTC/USD,1725193241,buy,market,65000,6500,3.25,0.1,0,,',
    ].join('\n');
    const result = parseCsv(csv, 'kraken');
    expect(result.fills[0].instrument).toBe('BTC-USD');
  });

  it('flags margin trades with a position side', () => {
    const csv = [
      'txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol,margin,misc,ledgers',
      'TX1,ORD1,XBTUSDT,1725193241,buy,limit,65000,6500,3.25,0.1,1.5,,',
    ].join('\n');
    const result = parseCsv(csv, 'kraken');
    expect(result.fills[0].positionSide).toBe('long');
  });

  it('reports an error for a row missing required columns', () => {
    const csv = [
      'txid,ordertxid,pair,time,type,ordertype,price,cost,fee,vol,margin,misc,ledgers',
      'TX1,,,,buy,,,,,,,,',
    ].join('\n');
    const result = parseCsv(csv, 'kraken');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.fills).toHaveLength(0);
  });
});
