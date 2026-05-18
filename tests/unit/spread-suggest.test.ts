/**
 * Unit tests for the wizard-local suggestFromLegs heuristic.
 *
 * Each test names the rule it exercises so a future regression's failure
 * message is self-explanatory. The rules — in priority order — are:
 *
 *   1. Mixed symbol roots → null (refuses cross-asset spreads)
 *   2. All same side    → null (no spread without opposite directions)
 *   3. < 2 legs         → null
 *   4. All-perp + same venue          → funding / same_venue
 *   5. All-perp + cross venue         → funding / cross_venue
 *   6. spot + perp opposite           → cash_carry / funding
 *   7. spot + dated future opposite   → cash_carry / basis
 *   8. all dated future same venue    → calendar
 *   9. mixed kinds cross venue        → cross_exchange
 */
import { describe, expect, it } from 'vitest';
import { suggestFromLegs, type SuggestLeg } from '@/app/add/spread/suggest';

function leg(
  side: 'long' | 'short',
  exchangeCode: string,
  instrumentKind: string,
  symbol = 'BTC-PERP',
): SuggestLeg {
  return { side, exchangeCode, instrumentKind, symbol };
}

describe('suggestFromLegs', () => {
  it('returns null when only one leg is selected', () => {
    expect(suggestFromLegs([leg('long', 'binance', 'perp')])).toBeNull();
  });

  it('returns null when symbol roots differ across legs', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp', 'BTC-PERP'),
        leg('short', 'bybit', 'perp', 'ETH-PERP'),
      ]),
    ).toBeNull();
  });

  it('returns null when every leg is on the same side', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp'),
        leg('long', 'bybit', 'perp'),
      ]),
    ).toBeNull();
  });

  it('matches funding/same_venue when both perps live on the same exchange', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp'),
        leg('short', 'binance', 'perp'),
      ]),
    ).toEqual({ spreadType: 'funding', variantCanonical: 'same_venue' });
  });

  it('matches funding/cross_venue when perps span two exchanges', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp'),
        leg('short', 'bybit', 'perp'),
      ]),
    ).toEqual({ spreadType: 'funding', variantCanonical: 'cross_venue' });
  });

  it('matches cash_carry/funding when spot is paired with a perp opposite side', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'spot', 'BTC'),
        leg('short', 'binance', 'perp', 'BTC-PERP'),
      ]),
    ).toEqual({ spreadType: 'cash_carry', variantCanonical: 'funding' });
  });

  it('matches cash_carry/basis when spot is paired with a dated future opposite side', () => {
    expect(
      suggestFromLegs([
        leg('long', 'okx', 'spot', 'BTC'),
        leg('short', 'okx', 'dated_future', 'BTC-26DEC25'),
      ]),
    ).toEqual({ spreadType: 'cash_carry', variantCanonical: 'basis' });
  });

  it('matches calendar when two dated futures share a venue with opposite sides', () => {
    expect(
      suggestFromLegs([
        leg('long', 'deribit', 'dated_future', 'BTC-26SEP25'),
        leg('short', 'deribit', 'dated_future', 'BTC-26DEC25'),
      ]),
    ).toEqual({ spreadType: 'calendar' });
  });

  it('falls back to cross_exchange when kinds mix across venues with same root', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp', 'BTC-PERP'),
        leg('short', 'okx', 'dated_future', 'BTC-26DEC25'),
      ]),
    ).toEqual({ spreadType: 'cross_exchange' });
  });

  it('normalises symbol roots across slash- and dash-separated symbols', () => {
    // ETH/USDT spot vs ETH-PERP perp should still match (root "ETH").
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'spot', 'ETH/USDT'),
        leg('short', 'binance', 'perp', 'ETH-PERP'),
      ]),
    ).toEqual({ spreadType: 'cash_carry', variantCanonical: 'funding' });
  });

  it('treats 3+ same-venue perps with both directions as funding/same_venue', () => {
    expect(
      suggestFromLegs([
        leg('long', 'binance', 'perp'),
        leg('short', 'binance', 'perp'),
        leg('long', 'binance', 'perp'),
      ]),
    ).toEqual({ spreadType: 'funding', variantCanonical: 'same_venue' });
  });
});
