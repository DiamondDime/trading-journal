import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Vertex CSV parser', () => {
  it('parses venue-style Trade History export', () => {
    const csv = [
      'Time,Product,Side,Size,Price,Notional,Fee,Tx Hash',
      '2024-09-01T12:34:01Z,BTC-PERP,Buy,0.1,65000,6500,0.5,0xabc',
      '2024-09-02T08:00:00Z,ETH-USDC,Sell,1,3500,3500,0.25,0xdef',
    ].join('\n');

    const result = parseCsv(csv, 'vertex');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    const perp = result.fills[0];
    expect(perp.instrument).toBe('BTC-PERP');
    expect(perp.instrumentType).toBe('perp');
    expect(perp.rawExchangeId).toBe('vertex:0xabc');

    const spot = result.fills[1];
    expect(spot.instrument).toBe('ETH-USDC');
    expect(spot.instrumentType).toBe('spot');
  });

  it('returns an informative error for explorer-style exports', () => {
    const csv = [
      'Txhash,Blockno,UnixTimestamp,DateTime,From,To,TokenValue,USDValue,ContractAddress,TokenName,TokenSymbol',
      '0xabc,123,1725193241,2024-09-01,0x,0x,0.1,6500,0x,Bitcoin,BTC',
    ].join('\n');
    const result = parseCsv(csv, 'vertex');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/venue-style/i);
  });

  it('rejects a malformed row', () => {
    const csv = [
      'Time,Product,Side,Size,Price,Notional,Fee,Tx Hash',
      ',,,,,,,,',
    ].join('\n');
    const result = parseCsv(csv, 'vertex');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('Drift CSV parser', () => {
  it('parses perp fills with long/short direction', () => {
    const csv = [
      'Timestamp,Market,Direction,Size,Price,Quote Asset Amount,Fee,Liquidity,Tx Signature',
      '2024-09-01T12:34:01Z,SOL-PERP,Long,10,140,1400,0.5,Taker,sig123',
      '2024-09-02T08:00:00Z,BTC-PERP,Short,0.1,65000,6500,2.5,Maker,sig456',
    ].join('\n');

    const result = parseCsv(csv, 'drift');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);

    const long = result.fills[0];
    expect(long.instrument).toBe('SOL-PERP');
    expect(long.side).toBe('buy');
    expect(long.positionSide).toBe('long');
    expect(long.isMaker).toBe(false);
    expect(long.rawExchangeId).toBe('drift:sig123');

    const short = result.fills[1];
    expect(short.side).toBe('sell');
    expect(short.positionSide).toBe('short');
    expect(short.isMaker).toBe(true);
  });

  it('rejects a row missing required columns', () => {
    const csv = [
      'Timestamp,Market,Direction,Size,Price,Quote Asset Amount,Fee,Liquidity,Tx Signature',
      ',,,,,,,,',
    ].join('\n');
    const result = parseCsv(csv, 'drift');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
