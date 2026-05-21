/**
 * Unit tests for `src/positions.ts` — the fills → positions aggregator.
 *
 * Ported from `worker/csj_worker/tests/test_positions_aggregator.py`. Expected
 * values are copied verbatim from the Python suite — if a test here fails, the
 * TS port is wrong, not the test.
 *
 * The Python suite exercises the pure functions `_aggregate_group`,
 * `_group_fills`, `_derive_position_side` and `_RunningPosition`. The TS
 * equivalents are `aggregateGroup`, `groupFills`, `derivePositionSide` and
 * `RunningPosition`.
 *
 * Two Python tests (`test_empty_input_returns_zero_counters`,
 * `test_load_query_only_reads_unmatched_fills`) cover the DB-layer
 * `aggregate_positions` / `_UNMATCHED_FILLS_SQL`, which are deliberately NOT
 * ported (DB plumbing lives in `db.ts`). Their pure-logic intent — an empty
 * fill stream is an idempotent no-op — is covered by the `aggregateFills`
 * idempotency block below.
 *
 * Coverage:
 * - Open then close roundtrip (long & short)
 * - Partial close: fill < running qty
 * - Side flip: fill > running qty, opens new opposite position
 * - Multi-day FIFO ordering
 * - Spot fills (positionSide null) bucket as long
 * - Empty fills returns empty result
 */
import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';

import {
  aggregateFills,
  aggregateGroup,
  derivePositionSide,
  groupFills,
  RunningPosition,
} from '../src/positions.js';
import type {
  CanonicalFill,
  CanonicalInstrument,
  InstrumentKind,
  PositionSide,
  Side,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures — TS port of the Python `_fill` helper
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 4, 18, 12, 0, 0)); // 2026-05-18T12:00:00Z

/** Build a `CanonicalInstrument` from a venue symbol + kind. */
function _instrument(rawSymbol: string, kind: InstrumentKind): CanonicalInstrument {
  return {
    exchange: 'binance',
    kind,
    base: 'BTC',
    quote: 'USDT',
    expiry: null,
    rawSymbol,
  };
}

/** Add `minutes` to `NOW` (Python `_NOW + timedelta(minutes=...)`). */
function _at(minuteOffset: number): Date {
  return new Date(NOW.getTime() + minuteOffset * 60_000);
}

/**
 * Build a `CanonicalFill` with sane defaults for tests — TS port of the
 * Python `_fill` fixture. `fillId` maps to `externalTradeId`; `instrumentType`
 * maps to `CanonicalInstrument.kind`.
 */
function _fill(args: {
  fillId: string;
  side: Side;
  qty: string;
  price: string;
  positionSide?: PositionSide | null;
  instrument?: string;
  instrumentType?: InstrumentKind;
  minuteOffset?: number;
}): CanonicalFill {
  const rawSymbol = args.instrument ?? 'BTC/USDT:USDT';
  const kind: InstrumentKind = args.instrumentType ?? 'perp';
  const qty = args.qty;
  const price = args.price;
  return {
    externalTradeId: args.fillId,
    externalOrderId: null,
    instrument: _instrument(rawSymbol, kind),
    side: args.side,
    qty,
    price,
    notional: new Decimal(qty).times(price).toString(),
    fee: '0',
    feeCurrency: 'USDT',
    feeKind: 'taker',
    isMaker: false,
    liquidity: 'taker',
    positionSide: args.positionSide ?? null,
    reduceOnly: null,
    filledAt: _at(args.minuteOffset ?? 0),
    raw: {},
  };
}

// ---------------------------------------------------------------------------
// derivePositionSide
// ---------------------------------------------------------------------------

describe('derivePositionSide', () => {
  it('uses explicit position side when present', () => {
    const f = _fill({
      fillId: '1',
      side: 'sell',
      qty: '1',
      price: '100',
      positionSide: 'short',
    });
    expect(derivePositionSide(f)).toBe('short');
  });

  it('defaults spot to long', () => {
    const f = _fill({
      fillId: '1',
      side: 'buy',
      qty: '1',
      price: '100',
      positionSide: null,
      instrumentType: 'spot',
    });
    expect(derivePositionSide(f)).toBe('long');
  });
});

// ---------------------------------------------------------------------------
// groupFills
// ---------------------------------------------------------------------------

describe('groupFills', () => {
  it('buckets by connection, instrument, position side', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
      _fill({ fillId: '2', side: 'sell', qty: '1', price: '100', positionSide: 'short' }),
      _fill({ fillId: '3', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
    ];
    const groups = groupFills(fills, 'c');
    expect(groups.length).toBe(2);

    const longGroup = groups.find((g) => g.key[2] === 'long');
    const shortGroup = groups.find((g) => g.key[2] === 'short');
    expect(longGroup).toBeDefined();
    expect(shortGroup).toBeDefined();

    // Keys: [connectionId, instrument, positionSide].
    expect(longGroup?.key).toEqual(['c', 'BTC/USDT:USDT', 'long']);
    expect(shortGroup?.key).toEqual(['c', 'BTC/USDT:USDT', 'short']);

    expect(longGroup?.fills.map((f) => f.externalTradeId)).toEqual(['1', '3']);
    expect(shortGroup?.fills.map((f) => f.externalTradeId)).toEqual(['2']);
  });
});

// ---------------------------------------------------------------------------
// aggregateGroup — core algorithm
// ---------------------------------------------------------------------------

describe('aggregateGroup — open/close', () => {
  it('long open then close emits one closed position', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '2', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '2',
        price: '110',
        positionSide: 'long',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(position.side).toBe('long');
    expect(position.qty.toString()).toBe('0');
    expect(position.vwap.toString()).toBe('100');
    expect(position.fillIds).toEqual(['1', '2']);
    expect(closedAt).toEqual(fills[1]!.filledAt);
  });

  it('short open then close emits one closed position', () => {
    const fills = [
      _fill({ fillId: '1', side: 'sell', qty: '2', price: '100', positionSide: 'short' }),
      _fill({
        fillId: '2',
        side: 'buy',
        qty: '2',
        price: '90',
        positionSide: 'short',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(position.side).toBe('short');
    expect(position.qty.toString()).toBe('0');
    expect(position.fillIds).toEqual(['1', '2']);
    expect(closedAt).toEqual(fills[1]!.filledAt);
  });
});

describe('aggregateGroup — partial close', () => {
  it('partial close leaves position open', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '3', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '1',
        price: '110',
        positionSide: 'long',
        minuteOffset: 5,
      }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(closedAt).toBeNull();
    expect(position.qty.toString()).toBe('2');
    expect(position.side).toBe('long');
    expect(position.fillIds).toEqual(['1', '2']);
  });

  it('grow then partial close — vwap correct', () => {
    // Open 1 BTC at 100, add 1 BTC at 200 -> vwap 150
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'buy',
        qty: '1',
        price: '200',
        positionSide: 'long',
        minuteOffset: 5,
      }),
      _fill({
        fillId: '3',
        side: 'sell',
        qty: '1',
        price: '160',
        positionSide: 'long',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(closedAt).toBeNull();
    expect(position.qty.toString()).toBe('1');
    // vwap of (1@100 + 1@200) = 150
    expect(position.vwap.toString()).toBe('150');
    expect(position.fillIds).toEqual(['1', '2', '3']);
  });
});

describe('aggregateGroup — side flip', () => {
  it('overshoot closes current and opens opposite', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '3',
        price: '110',
        positionSide: 'long',
        minuteOffset: 5,
      }),
    ];
    const out = aggregateGroup(fills);
    // First: closed long. Second: new short with 2 qty at vwap 110.
    expect(out.length).toBe(2);

    const { position: longPos, closedAt: longClosed } = out[0]!;
    expect(longPos.side).toBe('long');
    expect(longPos.qty.toString()).toBe('0');
    expect(longClosed).toEqual(fills[1]!.filledAt);

    const { position: shortPos, closedAt: shortClosed } = out[1]!;
    expect(shortPos.side).toBe('short');
    expect(shortPos.qty.toString()).toBe('2');
    expect(shortPos.vwap.toString()).toBe('110');
    expect(shortClosed).toBeNull(); // still open
  });
});

describe('aggregateGroup — multi-day', () => {
  it('chronological ordering preserved', () => {
    // Roundtrip 1: day 1
    // Roundtrip 2: day 2
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long', minuteOffset: 0 }),
      _fill({ fillId: '2', side: 'sell', qty: '1', price: '110', positionSide: 'long', minuteOffset: 60 }),
      _fill({ fillId: '3', side: 'buy', qty: '2', price: '105', positionSide: 'long', minuteOffset: 24 * 60 }),
      _fill({ fillId: '4', side: 'sell', qty: '2', price: '120', positionSide: 'long', minuteOffset: 24 * 60 + 30 }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(2);

    const { position: first, closedAt: firstClosed } = out[0]!;
    expect(first.qty.toString()).toBe('0');
    expect(first.fillIds).toEqual(['1', '2']);
    expect(firstClosed).toEqual(fills[1]!.filledAt);

    const { position: second, closedAt: secondClosed } = out[1]!;
    expect(second.qty.toString()).toBe('0');
    expect(second.fillIds).toEqual(['3', '4']);
    expect(secondClosed).toEqual(fills[3]!.filledAt);
  });
});

describe('aggregateGroup — edge cases', () => {
  it('empty returns empty', () => {
    expect(aggregateGroup([])).toEqual([]);
  });

  it('single fill opens position', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(position.qty.toString()).toBe('1');
    expect(closedAt).toBeNull();
  });

  it('spot fills bucket as long', () => {
    // Spot has no position_side; everything is long.
    const fills = [
      _fill({
        fillId: '1',
        side: 'buy',
        qty: '1',
        price: '100',
        positionSide: null,
        instrumentType: 'spot',
      }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '1',
        price: '120',
        positionSide: null,
        instrumentType: 'spot',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateGroup(fills);
    expect(out.length).toBe(1);
    const { position, closedAt } = out[0]!;
    expect(position.side).toBe('long');
    expect(position.qty.toString()).toBe('0');
    expect(closedAt).toEqual(fills[1]!.filledAt);
  });
});

// ---------------------------------------------------------------------------
// RunningPosition behaviour
// ---------------------------------------------------------------------------

describe('RunningPosition', () => {
  it('open — initial state', () => {
    const f = _fill({ fillId: '1', side: 'buy', qty: '2', price: '100', positionSide: 'long' });
    const p = RunningPosition.open('long', f);
    expect(p.side).toBe('long');
    expect(p.qty.toString()).toBe('2');
    expect(p.vwap.toString()).toBe('100');
    expect(p.fillIds).toEqual(['1']);
  });

  it('grow combines vwap', () => {
    const f1 = _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' });
    const f2 = _fill({
      fillId: '2',
      side: 'buy',
      qty: '1',
      price: '200',
      positionSide: 'long',
      minuteOffset: 5,
    });
    const p = RunningPosition.open('long', f1);
    p.grow(f2);
    expect(p.qty.toString()).toBe('2');
    expect(p.vwap.toString()).toBe('150');
    expect(p.fillIds).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// aggregateFills idempotency
//
// Python's `test_empty_input_returns_zero_counters` and
// `test_load_query_only_reads_unmatched_fills` test the DB-layer
// `aggregate_positions` / `_UNMATCHED_FILLS_SQL`, which are not ported. The
// pure-logic intent — an empty fill stream is an idempotent no-op — is
// asserted here against the public `aggregateFills`.
// ---------------------------------------------------------------------------

describe('aggregateFills idempotency', () => {
  it('empty input returns empty result', () => {
    expect(aggregateFills([], 'c')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// aggregateFills — public entry point (TS-only integration coverage)
//
// No Python equivalent (the Python public entry point is DB-bound). Verifies
// the group → fold → project pipeline and the derived P&L / fee figures.
// ---------------------------------------------------------------------------

describe('aggregateFills — public entry point', () => {
  it('emits a closed CanonicalPosition for a long roundtrip', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '2', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '2',
        price: '110',
        positionSide: 'long',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateFills(fills, 'c');
    expect(out.length).toBe(1);
    const agg = out[0]!;
    expect(agg.status).toBe('closed');
    expect(agg.position.side).toBe('long');
    expect(agg.position.qtyOpen).toBe('0');
    expect(agg.position.avgEntryPrice).toBe('100');
    expect(agg.position.openedAt).toEqual(fills[0]!.filledAt);
    expect(agg.closedAt).toEqual(fills[1]!.filledAt);
    expect(agg.totalQty).toBe('2');
    expect(agg.avgExitPrice).toBe('110');
    // long: (110 - 100) * 2 = 20
    expect(agg.realizedPnl).toBe('20');
    expect(agg.fillIds).toEqual(['1', '2']);
  });

  it('computes realized P&L for a short roundtrip', () => {
    const fills = [
      _fill({ fillId: '1', side: 'sell', qty: '2', price: '100', positionSide: 'short' }),
      _fill({
        fillId: '2',
        side: 'buy',
        qty: '2',
        price: '90',
        positionSide: 'short',
        minuteOffset: 10,
      }),
    ];
    const out = aggregateFills(fills, 'c');
    expect(out.length).toBe(1);
    const agg = out[0]!;
    expect(agg.status).toBe('closed');
    expect(agg.position.side).toBe('short');
    // short: (100 - 90) * 2 = 20
    expect(agg.realizedPnl).toBe('20');
    expect(agg.avgExitPrice).toBe('90');
  });

  it('accumulates fees across contributing fills', () => {
    const buy = _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' });
    const sell = _fill({
      fillId: '2',
      side: 'sell',
      qty: '1',
      price: '110',
      positionSide: 'long',
      minuteOffset: 10,
    });
    const fills: CanonicalFill[] = [
      { ...buy, fee: '0.5' },
      { ...sell, fee: '0.6' },
    ];
    const out = aggregateFills(fills, 'c');
    expect(out.length).toBe(1);
    expect(out[0]!.feesPaid).toBe('1.1');
  });

  it('leaves an open position with qtyOpen and no exit price', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '3', price: '100', positionSide: 'long' }),
    ];
    const out = aggregateFills(fills, 'c');
    expect(out.length).toBe(1);
    const agg = out[0]!;
    expect(agg.status).toBe('open');
    expect(agg.closedAt).toBeNull();
    expect(agg.position.qtyOpen).toBe('3');
    expect(agg.avgExitPrice).toBeNull();
    expect(agg.realizedPnl).toBe('0');
  });

  it('separates positions by instrument and position side', () => {
    const fills = [
      _fill({ fillId: '1', side: 'buy', qty: '1', price: '100', positionSide: 'long' }),
      _fill({
        fillId: '2',
        side: 'sell',
        qty: '1',
        price: '100',
        positionSide: 'short',
        instrument: 'ETH/USDT:USDT',
      }),
    ];
    const out = aggregateFills(fills, 'c');
    expect(out.length).toBe(2);
    const sides = out.map((a) => a.position.side).sort();
    expect(sides).toEqual(['long', 'short']);
  });
});
