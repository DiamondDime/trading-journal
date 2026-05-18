import { describe, it, expect } from 'vitest';
import { parseCsv } from '@/lib/csv-import';

describe('Backpack CSV parser', () => {
  it('parses spot trades', () => {
    const csv = [
      'Trade ID,Order ID,Symbol,Side,Quantity,Price,Quote Quantity,Fee,Fee Symbol,Maker,Time',
      'T1,O1,BTC_USDC,Buy,0.1,65000,6500,3.25,USDC,true,2024-09-01T12:34:01Z',
      'T2,O2,ETH_USDC,Sell,1,3500,3500,1.75,USDC,false,2024-09-02T08:00:00Z',
    ].join('\n');

    const result = parseCsv(csv, 'backpack');
    expect(result.errors).toEqual([]);
    expect(result.fills).toHaveLength(2);
    expect(result.fills[0].rawExchangeId).toBe('backpack:T1');
    expect(result.fills[0].instrument).toBe('BTC-USDC');
    expect(result.fills[0].isMaker).toBe(true);
    expect(result.fills[1].isMaker).toBe(false);
  });

  it('parses perp trades', () => {
    const csv = [
      'Trade ID,Order ID,Symbol,Side,Quantity,Price,Quote Quantity,Fee,Fee Symbol,Maker,Time',
      'T1,O1,BTC_USDC_PERP,Buy,0.1,65000,6500,3.25,USDC,false,2024-09-01T12:34:01Z',
    ].join('\n');
    const result = parseCsv(csv, 'backpack');
    expect(result.errors).toEqual([]);
    expect(result.fills[0].instrument).toBe('BTC-PERP');
    expect(result.fills[0].instrumentType).toBe('perp');
  });

  it('rejects a malformed row', () => {
    const csv = [
      'Trade ID,Order ID,Symbol,Side,Quantity,Price,Quote Quantity,Fee,Fee Symbol,Maker,Time',
      ',,,,,,,,,,',
    ].join('\n');
    const result = parseCsv(csv, 'backpack');
    expect(result.fills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
