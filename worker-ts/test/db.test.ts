/**
 * Unit tests for the positions-aggregation + funding DB layer added to
 * `src/db.ts` (`aggregateConnectionPositions`, `attachFills`,
 * `insertFundingEvents`, `linkFundingEvents`).
 *
 * These functions take a `postgres.js` `SqlClient` and call `sql.unsafe(query,
 * params)`. We don't spin up a database — instead a `FakeSql` records every
 * `sql.unsafe` call and returns scripted result rows. That lets us assert on
 * the SQL shape and, crucially, the PARAMETERS passed (the funding-amount sign
 * conversion, the synthesized `raw_exchange_id`, the empty-input no-ops).
 *
 * The pure fold (`aggregateFills`) has its own exhaustive suite in
 * `positions.test.ts`; here we only cover the DB plumbing around it.
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateConnectionPositions,
  attachFills,
  insertFundingEvents,
} from '../src/db.js';
import type { CanonicalFundingEvent, CanonicalInstrument } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fake SqlClient — records `sql.unsafe` calls, returns scripted results.
// ---------------------------------------------------------------------------

interface RecordedCall {
  query: string;
  params: unknown[];
}

/** A `sql.unsafe` result: an array of rows that also carries `.count`. */
function makeResult(rows: unknown[], count?: number): unknown {
  const arr = [...rows] as unknown[] & { count?: number };
  arr.count = count ?? rows.length;
  return arr;
}

/**
 * Build a fake `SqlClient`. `responder` maps the Nth `sql.unsafe` call to a
 * scripted result; calls past the script length default to an empty result.
 */
function fakeSql(responder: (call: RecordedCall, index: number) => unknown) {
  const calls: RecordedCall[] = [];
  const unsafe = (query: string, params: unknown[] = []) => {
    const call: RecordedCall = { query, params };
    calls.push(call);
    return Promise.resolve(responder(call, calls.length - 1));
  };
  // Only `unsafe` is exercised by the functions under test; cast through
  // `unknown` so we don't have to stub the entire postgres.js surface.
  const sql = { unsafe } as unknown as Parameters<typeof attachFills>[0];
  return { sql, calls };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INSTRUMENT: CanonicalInstrument = {
  exchange: 'binance',
  kind: 'perp',
  base: 'BTC',
  quote: 'USDT',
  expiry: null,
  rawSymbol: 'BTC/USDT:USDT',
};

function fundingEvent(
  overrides: Partial<CanonicalFundingEvent> = {},
): CanonicalFundingEvent {
  return {
    instrument: INSTRUMENT,
    direction: 'received',
    fundingRate: '0.0001',
    positionQty: '1.5',
    amount: '12.34',
    amountCurrency: 'USDT',
    occurredAt: new Date(Date.UTC(2026, 4, 20, 8, 0, 0)),
    externalId: 'fund-abc-1',
    raw: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// insertFundingEvents — sign conversion + null externalId
// ---------------------------------------------------------------------------

describe('insertFundingEvents', () => {
  it('returns 0 and issues no query on empty input', async () => {
    const { sql, calls } = fakeSql(() => makeResult([]));
    const count = await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [],
    });
    expect(count).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("keeps a 'received' funding amount positive", async () => {
    const { sql, calls } = fakeSql(() => makeResult([{}], 1));
    await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [fundingEvent({ direction: 'received', amount: '12.34' })],
    });
    expect(calls).toHaveLength(1);
    // INSERT param order: user, conn, raw_exchange_id, instrument, amount, ...
    const amountParam = calls[0]!.params[4];
    expect(amountParam).toBe('12.34');
  });

  it("negates a 'paid' funding amount", async () => {
    const { sql, calls } = fakeSql(() => makeResult([{}], 1));
    await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [fundingEvent({ direction: 'paid', amount: '12.34' })],
    });
    const amountParam = calls[0]!.params[4];
    expect(amountParam).toBe('-12.34');
  });

  it('uses the adapter externalId as raw_exchange_id when present', async () => {
    const { sql, calls } = fakeSql(() => makeResult([{}], 1));
    await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [fundingEvent({ externalId: 'fund-xyz-9' })],
    });
    expect(calls[0]!.params[2]).toBe('fund-xyz-9');
  });

  it('synthesizes a stable raw_exchange_id when externalId is null', async () => {
    const { sql, calls } = fakeSql(() => makeResult([{}], 1));
    const occurredAt = new Date(Date.UTC(2026, 4, 20, 8, 0, 0));
    await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [fundingEvent({ externalId: null, occurredAt })],
    });
    // Composite = `<rawSymbol>-<epochMs>` — deterministic across re-syncs.
    expect(calls[0]!.params[2]).toBe(`BTC/USDT:USDT-${occurredAt.getTime()}`);
  });

  it('counts only rows the DB actually inserted (ON CONFLICT skips)', async () => {
    // First event inserts (count 1), second is a conflict (count 0).
    let nth = 0;
    const { sql } = fakeSql(() => makeResult([], nth++ === 0 ? 1 : 0));
    const count = await insertFundingEvents(sql, {
      userId: 'user-1',
      exchangeConnectionId: 'conn-1',
      events: [fundingEvent({ externalId: 'a' }), fundingEvent({ externalId: 'b' })],
    });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attachFills — empty-input no-op
// ---------------------------------------------------------------------------

describe('attachFills', () => {
  it('returns 0 and issues no query on an empty id list', async () => {
    const { sql, calls } = fakeSql(() => makeResult([], 0));
    const count = await attachFills(sql, 'conn-1', 'pos-1', []);
    expect(count).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('matches on raw_exchange_id, not id', async () => {
    const { sql, calls } = fakeSql(() => makeResult([], 2));
    const count = await attachFills(sql, 'conn-1', 'pos-1', ['t1', 't2']);
    expect(count).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain('raw_exchange_id = any(');
    // Params: [exchangeConnectionId, positionId, externalTradeIds]
    expect(calls[0]!.params).toEqual(['conn-1', 'pos-1', ['t1', 't2']]);
  });
});

// ---------------------------------------------------------------------------
// aggregateConnectionPositions — empty no-op
// ---------------------------------------------------------------------------

describe('aggregateConnectionPositions', () => {
  it('is a zero-counter no-op when there are no unmatched fills', async () => {
    // First call is `loadUnmatchedFills` → return an empty result so the
    // function should short-circuit before touching positions / connections.
    const { sql, calls } = fakeSql(() => makeResult([], 0));
    const result = await aggregateConnectionPositions(sql, 'conn-1');
    expect(result).toEqual({ positionsInserted: 0, fillsAttached: 0 });
    // Exactly one query (the unmatched-fills SELECT); no INSERT, no
    // connection lookup.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.query).toContain('from public.fills');
    expect(calls[0]!.query).toContain('position_id is null');
  });
});
