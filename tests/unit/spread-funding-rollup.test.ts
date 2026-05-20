/**
 * Unit tests for `aggregateFundingEvents` — the pure funding P&L roll-up used
 * by the spread detail page (`/spreads/[id]`).
 *
 * Sign convention under test (from funding_events.amount, migration 004):
 *   positive amount = funding RECEIVED, negative amount = funding PAID.
 * So the net is a plain signed sum; received/paid are the positive/negative
 * partitions.
 *
 * The function is decimal.js-backed because funding amounts are
 * numeric(38,18) in Postgres — summing them as JS floats would drift. The
 * precision test below pins that.
 *
 * Hand-computed expected values appear inline so a future regression's
 * failure is self-explanatory.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateFundingEvents,
  type FundingEventAmount,
} from '@/app/spreads/[id]/db';

function ev(amount: string): FundingEventAmount {
  return { amount };
}

describe('aggregateFundingEvents', () => {
  it('returns an all-zero roll-up for no events', () => {
    const r = aggregateFundingEvents([]);
    expect(r.netUsd).toBe('0');
    expect(r.receivedUsd).toBe('0');
    expect(r.paidUsd).toBe('0');
    expect(r.eventCount).toBe(0);
    expect(r.positionCount).toBe(0);
  });

  it('sums purely-received funding into a positive net', () => {
    // 1.50 + 2.25 + 0.75 = 4.50 received, nothing paid.
    const r = aggregateFundingEvents([ev('1.50'), ev('2.25'), ev('0.75')]);
    expect(r.netUsd).toBe('4.5');
    expect(r.receivedUsd).toBe('4.5');
    expect(r.paidUsd).toBe('0');
    expect(r.eventCount).toBe(3);
  });

  it('sums purely-paid funding into a negative net', () => {
    // -3.00 + -1.20 = -4.20 paid, nothing received.
    const r = aggregateFundingEvents([ev('-3.00'), ev('-1.20')]);
    expect(r.netUsd).toBe('-4.2');
    expect(r.receivedUsd).toBe('0');
    expect(r.paidUsd).toBe('-4.2');
    expect(r.eventCount).toBe(2);
  });

  it('partitions mixed received/paid events and nets them', () => {
    // received: 10 + 4 = 14 ; paid: -6 + -2.5 = -8.5 ; net = 5.5
    const r = aggregateFundingEvents([
      ev('10'),
      ev('-6'),
      ev('4'),
      ev('-2.5'),
    ]);
    expect(r.receivedUsd).toBe('14');
    expect(r.paidUsd).toBe('-8.5');
    expect(r.netUsd).toBe('5.5');
    expect(r.eventCount).toBe(4);
  });

  it('treats a zero-amount event as neither received nor paid', () => {
    const r = aggregateFundingEvents([ev('0'), ev('5'), ev('-5')]);
    expect(r.netUsd).toBe('0');
    expect(r.receivedUsd).toBe('5');
    expect(r.paidUsd).toBe('-5');
    // a zero amount still counts as an observed event
    expect(r.eventCount).toBe(3);
  });

  it('preserves full precision on small numeric(38,18) amounts', () => {
    // Three hourly Hyperliquid funding ticks. As IEEE-754 floats,
    // 0.1 + 0.2 = 0.30000000000000004 — decimal.js must keep it exact.
    const r = aggregateFundingEvents([
      ev('0.000000000000000001'),
      ev('0.000000000000000002'),
    ]);
    expect(r.netUsd).toBe('0.000000000000000003');
    expect(r.receivedUsd).toBe('0.000000000000000003');
  });

  it('avoids float drift when summing 0.1 and 0.2', () => {
    const r = aggregateFundingEvents([ev('0.1'), ev('0.2')]);
    expect(r.netUsd).toBe('0.3');
  });

  it('skips malformed amounts instead of poisoning the sum with NaN', () => {
    // A non-numeric amount must not turn the whole roll-up into NaN.
    const r = aggregateFundingEvents([ev('5'), ev('not-a-number'), ev('3')]);
    expect(r.netUsd).toBe('8');
    expect(r.receivedUsd).toBe('8');
    // eventCount reflects the raw input length, malformed rows included
    expect(r.eventCount).toBe(3);
  });

  it('passes the caller-supplied positionCount straight through', () => {
    const r = aggregateFundingEvents([ev('1')], 4);
    expect(r.positionCount).toBe(4);
  });
});
