/**
 * Integration tests for src/lib/db/activity.ts against a real Postgres test DB.
 *
 * Coverage rationale:
 *   • createTrade / createSale / createAirdrop happy paths — insert + read-back.
 *   • Zod validation rejections at the schema boundary (negative entry, zero qty,
 *     etc.) — these are the inputs that would otherwise corrupt the DB.
 *   • listActivities filter combinations — especially type+status, which had
 *     the enum-cast regression in Wave 5A.
 *   • getActivity edge cases — non-UUID input (fix-9 from Wave 5A) + cross-user
 *     leakage.
 *   • deleteActivity soft-delete semantics.
 *
 * Each test starts from a clean per-user state via beforeEach. The single
 * test user + sentinel exchange_connection are seeded once in beforeAll to
 * avoid bootstrap cost.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@/lib/db/client';
import {
  createTrade,
  createSale,
  createAirdrop,
  getActivity,
  listActivities,
  deleteActivity,
  updateActivity,
  getTotals,
  getActivityTypeCounts,
  getActivityTypeNetPnl,
  getRecentCloses,
  getDailyPnl,
} from '@/lib/db/activity';
import {
  CreateTradeBody,
  CreateSaleBody,
  CreateAirdropBody,
} from '@/lib/db/zod-schemas';
import {
  seedTestUser,
  resetUserData,
  seedTradeActivity,
  seedSaleActivity,
  seedAirdropActivity,
  seedSpreadActivity,
  TEST_USER_ID,
  OTHER_USER_ID,
} from '../helpers/db';

let testUser: Awaited<ReturnType<typeof seedTestUser>>;
let otherUser: Awaited<ReturnType<typeof seedTestUser>>;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID);
  otherUser = await seedTestUser(OTHER_USER_ID, 'other-test@local');
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
  await resetUserData(OTHER_USER_ID);
});

afterAll(async () => {
  await sql.end();
});

// ============================================================================
// createTrade
// ============================================================================

describe('createTrade', () => {
  const validInput = {
    exchange: 'Binance' as const,
    symbol: 'BTC-PERP',
    instrument: 'perp' as const,
    side: 'long' as const,
    capital: '5000',
    qty: '0.1',
    entryPrice: '60000',
    exitPrice: '62000',
    fees: '5',
    openedAt: '2026-05-01T10:00',
    closedAt: '2026-05-02T10:00',
    note: '',
    regimeTags: '' as unknown as string[],
  };

  it('inserts an activity + activity_trade + positions row and returns the id', async () => {
    const parsed = CreateTradeBody.parse(validInput);
    const { id } = await createTrade(TEST_USER_ID, parsed);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const [act] = await sql<{ id: string; type: string; status: string; netPnlUsd: string }[]>`
      SELECT id, type, status, net_pnl_usd FROM public.activity WHERE id = ${id}::uuid
    `;
    expect(act.type).toBe('trade');
    expect(act.status).toBe('closed');
    // (62000-60000)*0.1 - 5 = 195
    expect(Number(act.netPnlUsd)).toBeCloseTo(195, 5);

    const [trade] = await sql<{ symbol: string; exchange: string; side: string }[]>`
      SELECT symbol, exchange, side FROM public.activity_trade WHERE activity_id = ${id}::uuid
    `;
    expect(trade.symbol).toBe('BTC-PERP');
    expect(trade.exchange).toBe('binance'); // lowercase, mapped to catalog code
    expect(trade.side).toBe('long');
  });

  it('computes signed PnL correctly for a short trade', async () => {
    const parsed = CreateTradeBody.parse({
      ...validInput,
      side: 'short',
      entryPrice: '62000',
      exitPrice: '60000',
    });
    const { id } = await createTrade(TEST_USER_ID, parsed);
    const [act] = await sql<{ netPnlUsd: string }[]>`
      SELECT net_pnl_usd FROM public.activity WHERE id = ${id}::uuid
    `;
    // short: (entry-exit)*qty - fees = (62000-60000)*0.1 - 5 = 195
    expect(Number(act.netPnlUsd)).toBeCloseTo(195, 5);
  });

  describe('Zod validation', () => {
    it('rejects negative entry price', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, entryPrice: '-1' })).toThrow();
    });
    it('rejects zero quantity', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, qty: '0' })).toThrow();
    });
    it('rejects negative quantity', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, qty: '-0.1' })).toThrow();
    });
    it('rejects zero exit price', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, exitPrice: '0' })).toThrow();
    });
    it('rejects negative capital (NonNegativeDecimal forbids it)', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, capital: '-1' })).toThrow();
    });
    it('rejects closedAt < openedAt', () => {
      expect(() =>
        CreateTradeBody.parse({
          ...validInput,
          openedAt: '2026-05-10T10:00',
          closedAt: '2026-05-01T10:00',
        }),
      ).toThrow();
    });
    it('rejects scientific-notation prices', () => {
      expect(() => CreateTradeBody.parse({ ...validInput, entryPrice: '6e4' })).toThrow();
    });
    it('rejects unknown exchanges', () => {
      expect(() =>
        CreateTradeBody.parse({ ...validInput, exchange: 'FakeEx' as 'Binance' }),
      ).toThrow();
    });
    it('rejects unknown extra keys (.strict)', () => {
      expect(() =>
        CreateTradeBody.parse({ ...validInput, leverage: '10' } as Record<string, unknown>),
      ).toThrow();
    });
  });
});

// ============================================================================
// createSale
// ============================================================================

describe('createSale', () => {
  const validSale = {
    saleKind: 'launchpad' as const,
    venue: 'Binance Launchpad',
    asset: 'EIGEN',
    usdPaid: '1500',
    tokensAllocated: '500',
    tgeDate: '2026-04-01',
    tgeUnlockPct: 100,
    vestingCliffMonths: 0,
    vestingDurationMonths: 0,
    currentPriceUsd: '5',
    openedAt: '2026-03-15T10:00',
    note: '',
    regimeTags: '' as unknown as string[],
  };

  it('stores vesting schedule as jsonb and computes net PnL', async () => {
    const parsed = CreateSaleBody.parse(validSale);
    const { id } = await createSale(TEST_USER_ID, parsed);

    const [act] = await sql<{ netPnlUsd: string; status: string }[]>`
      SELECT net_pnl_usd, status FROM public.activity WHERE id = ${id}::uuid
    `;
    // net = tokens*current_price - usd_paid = 500*5 - 1500 = 1000
    expect(Number(act.netPnlUsd)).toBeCloseTo(1000, 5);
    expect(act.status).toBe('vesting'); // tgeUnlockPct >= 100

    const [sale] = await sql<{ vestingSchedule: unknown; currentPriceUsd: string }[]>`
      SELECT vesting_schedule, current_price_usd
        FROM public.activity_sale WHERE activity_id = ${id}::uuid
    `;
    expect(sale.vestingSchedule).toEqual({ kind: 'all_at_tge' });
    expect(Number(sale.currentPriceUsd)).toBe(5);
  });

  it('builds tge_plus_linear when cliff=0, duration>0', async () => {
    const parsed = CreateSaleBody.parse({
      ...validSale,
      tgeUnlockPct: 20,
      vestingDurationMonths: 12,
    });
    const { id } = await createSale(TEST_USER_ID, parsed);
    // postgres.js camelCases jsonb keys on read, so tge_pct -> tgePct.
    const [sale] = await sql<{ vestingSchedule: Record<string, unknown> }[]>`
      SELECT vesting_schedule FROM public.activity_sale WHERE activity_id = ${id}::uuid
    `;
    expect(sale.vestingSchedule.kind).toBe('tge_plus_linear');
    expect(sale.vestingSchedule.tgePct).toBe(20);
    expect(sale.vestingSchedule.linearDays).toBe(12 * 30);
  });

  it('builds cliff_plus_linear when cliff > 0', async () => {
    const parsed = CreateSaleBody.parse({
      ...validSale,
      tgeUnlockPct: 0,
      vestingCliffMonths: 6,
      vestingDurationMonths: 18,
    });
    const { id } = await createSale(TEST_USER_ID, parsed);
    const [sale] = await sql<{ vestingSchedule: Record<string, unknown> }[]>`
      SELECT vesting_schedule FROM public.activity_sale WHERE activity_id = ${id}::uuid
    `;
    expect(sale.vestingSchedule.kind).toBe('cliff_plus_linear');
    expect(sale.vestingSchedule.cliffDays).toBe(180);
    expect(sale.vestingSchedule.linearDays).toBe(540);
  });

  describe('Zod validation', () => {
    it('rejects zero usd_paid', () => {
      expect(() => CreateSaleBody.parse({ ...validSale, usdPaid: '0' })).toThrow();
    });
    it('rejects zero tokens_allocated', () => {
      expect(() => CreateSaleBody.parse({ ...validSale, tokensAllocated: '0' })).toThrow();
    });
    it('rejects tge_unlock_pct > 100', () => {
      expect(() => CreateSaleBody.parse({ ...validSale, tgeUnlockPct: 101 })).toThrow();
    });
    it('rejects unknown saleKind', () => {
      expect(() =>
        CreateSaleBody.parse({ ...validSale, saleKind: 'private' as 'ido' }),
      ).toThrow();
    });
  });
});

// ============================================================================
// createAirdrop
// ============================================================================

describe('createAirdrop', () => {
  const validAirdrop = {
    protocol: 'Jupiter',
    asset: 'JUP',
    tokensClaimed: '1000',
    claimDate: '2026-01-31',
    usdValueAtClaim: '700',
    currentPriceUsd: '1.2',
    note: '',
    regimeTags: '' as unknown as string[],
  };

  it('stores tokens_claimed, value_at_claim, current_price + returns id', async () => {
    const parsed = CreateAirdropBody.parse(validAirdrop);
    const { id } = await createAirdrop(TEST_USER_ID, parsed);

    const [act] = await sql<{ realizedPnlUsd: string; netPnlUsd: string; type: string; status: string }[]>`
      SELECT realized_pnl_usd, net_pnl_usd, type, status
        FROM public.activity WHERE id = ${id}::uuid
    `;
    expect(act.type).toBe('airdrop');
    expect(act.status).toBe('claimed');
    expect(Number(act.realizedPnlUsd)).toBeCloseTo(700, 5);
    // net = tokens * current_price = 1000 * 1.2 = 1200
    expect(Number(act.netPnlUsd)).toBeCloseTo(1200, 5);

    const [drop] = await sql<{ tokenSymbol: string; qtyReceived: string; valueAtReceiptUsd: string }[]>`
      SELECT token_symbol, qty_received, value_at_receipt_usd
        FROM public.activity_airdrop WHERE activity_id = ${id}::uuid
    `;
    expect(drop.tokenSymbol).toBe('JUP');
    expect(Number(drop.qtyReceived)).toBeCloseTo(1000, 5);
    expect(Number(drop.valueAtReceiptUsd)).toBeCloseTo(700, 5);
  });

  describe('Zod validation', () => {
    it('rejects zero tokens_claimed', () => {
      expect(() => CreateAirdropBody.parse({ ...validAirdrop, tokensClaimed: '0' })).toThrow();
    });
    it('accepts zero usd_value_at_claim (NonNegativeDecimal)', () => {
      expect(() =>
        CreateAirdropBody.parse({ ...validAirdrop, usdValueAtClaim: '0' }),
      ).not.toThrow();
    });
    it('rejects negative current_price', () => {
      expect(() =>
        CreateAirdropBody.parse({ ...validAirdrop, currentPriceUsd: '-1' }),
      ).toThrow();
    });
  });
});

// ============================================================================
// listActivities
// ============================================================================

describe('listActivities', () => {
  beforeEach(async () => {
    // Three rows of different types so filters have something to discriminate.
    await seedTradeActivity({ connectionId: testUser.connectionId, netPnl: 500 });
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: -200,
      symbol: 'ETH-PERP',
    });
    await seedSaleActivity({ usdPaid: 1000, netPnl: 250 });
    await seedAirdropActivity({ netPnl: 300, protocol: 'Optimism' });
    await seedSpreadActivity({ netPnl: 800 });
  });

  it('filters by type=trade returns only trade rows', async () => {
    const rows = await listActivities(TEST_USER_ID, { type: ['trade'] });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.type === 'trade')).toBe(true);
  });

  it('filters by type=spread returns only spread rows', async () => {
    const rows = await listActivities(TEST_USER_ID, { type: ['spread'] });
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('spread');
  });

  it('combines type + status without crashing on the enum cast (Wave 5A fix)', async () => {
    // Wave 5A regression: postgres.js's tagged-template binds ${status} as
    // text — without the explicit ::text[] cast the planner errored. This
    // test would have caught the original bug.
    const rows = await listActivities(TEST_USER_ID, {
      type: ['trade'],
      status: ['closed'],
    });
    expect(rows.every((r) => r.type === 'trade' && r.status === 'closed')).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns rows for the requesting user only (no cross-user leak)', async () => {
    await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
      netPnl: 999,
      symbol: 'XRP-PERP',
    });
    const rows = await listActivities(TEST_USER_ID, {});
    expect(rows.every((r) => r.userId === TEST_USER_ID)).toBe(true);
    expect(rows.find((r) => r.primarySymbol === 'XRP')).toBeUndefined();
  });

  it('respects the limit', async () => {
    const rows = await listActivities(TEST_USER_ID, { limit: 2 });
    expect(rows.length).toBe(2);
  });
});

// ============================================================================
// getActivity — UUID guard + cross-user
// ============================================================================

describe('getActivity', () => {
  it('returns null for a non-UUID input (Wave 5A FIX-9 guard)', async () => {
    // Old fixture IDs like "tr-005" or "sa-001" used to slip through and
    // trip Postgres' uuid parser. The UUID_RE guard short-circuits to null.
    expect(await getActivity(TEST_USER_ID, 'tr-005')).toBeNull();
    expect(await getActivity(TEST_USER_ID, 'not-a-uuid')).toBeNull();
    expect(await getActivity(TEST_USER_ID, '')).toBeNull();
    // Mixed-case UUID is acceptable (regex is /i).
    expect(
      await getActivity(TEST_USER_ID, 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'),
    ).toBeNull(); // valid shape but no row → null, not a throw.
  });

  it('returns null for a valid UUID that does not exist', async () => {
    expect(
      await getActivity(TEST_USER_ID, '00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });

  it('returns the full detail row for a seeded trade', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const row = await getActivity(TEST_USER_ID, id);
    expect(row).not.toBeNull();
    expect(row?.type).toBe('trade');
    expect(row?.subtype.type).toBe('trade');
    if (row?.subtype.type === 'trade') {
      expect(row.subtype.row.symbol).toBe('BTC-PERP');
    }
  });

  it('returns the full detail row for a seeded sale (subtype discrimination)', async () => {
    const id = await seedSaleActivity({ asset: 'EIGEN' });
    const row = await getActivity(TEST_USER_ID, id);
    expect(row?.type).toBe('sale');
    expect(row?.subtype.type).toBe('sale');
    if (row?.subtype.type === 'sale') {
      expect(row.subtype.row.tokenSymbol).toBe('EIGEN');
    }
  });

  it('returns the full detail row for a seeded airdrop', async () => {
    const id = await seedAirdropActivity({ asset: 'JUP', protocol: 'Jupiter' });
    const row = await getActivity(TEST_USER_ID, id);
    expect(row?.type).toBe('airdrop');
    expect(row?.subtype.type).toBe('airdrop');
    if (row?.subtype.type === 'airdrop') {
      expect(row.subtype.row.protocol).toBe('Jupiter');
    }
  });

  it('returns null when the activity exists but belongs to a different user', async () => {
    const id = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    // Sanity — the row IS visible to the other user.
    expect(await getActivity(OTHER_USER_ID, id)).not.toBeNull();
    // But to our test user, it must look like a 404.
    expect(await getActivity(TEST_USER_ID, id)).toBeNull();
  });
});

// ============================================================================
// updateActivity (Wave 6.1 — common-field edits)
// ============================================================================

describe('updateActivity', () => {
  it('updates name + regime tags + custom tags', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const ok = await updateActivity(TEST_USER_ID, id, {
      name: 'updated name',
      regimeTags: ['risk-on'],
      customTags: ['high-conviction'],
    });
    expect(ok).toBe(true);
    const row = await getActivity(TEST_USER_ID, id);
    expect(row?.name).toBe('updated name');
    expect(row?.regimeTags).toEqual(['risk-on']);
    expect(row?.customTags).toEqual(['high-conviction']);
  });

  it('returns false for a non-existent activity', async () => {
    expect(
      await updateActivity(TEST_USER_ID, '00000000-0000-0000-0000-000000000000', {
        name: 'x',
      }),
    ).toBe(false);
  });

  it('does not update activities owned by another user', async () => {
    const id = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    const ok = await updateActivity(TEST_USER_ID, id, { name: 'hijack attempt' });
    expect(ok).toBe(false);
    // Confirm the other user's row is unchanged.
    const row = await getActivity(OTHER_USER_ID, id);
    expect(row?.name).not.toBe('hijack attempt');
  });
});

// ============================================================================
// deleteActivity — soft delete
// ============================================================================

describe('deleteActivity', () => {
  it('soft-deletes the row and hides it from getActivity / listActivities', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });

    // Pre-condition: row is visible.
    expect(await getActivity(TEST_USER_ID, id)).not.toBeNull();

    const ok = await deleteActivity(TEST_USER_ID, id);
    expect(ok).toBe(true);

    // deleted_at column is set...
    const [raw] = await sql<{ deletedAt: string | null }[]>`
      SELECT deleted_at FROM public.activity WHERE id = ${id}::uuid
    `;
    expect(raw.deletedAt).not.toBeNull();

    // ...and reads no longer return it.
    expect(await getActivity(TEST_USER_ID, id)).toBeNull();
    const rows = await listActivities(TEST_USER_ID, {});
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it('returns false on second delete (already soft-deleted)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    expect(await deleteActivity(TEST_USER_ID, id)).toBe(true);
    expect(await deleteActivity(TEST_USER_ID, id)).toBe(false);
  });

  it('returns false for an activity owned by a different user', async () => {
    const id = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    expect(await deleteActivity(TEST_USER_ID, id)).toBe(false);
    // Other user's row should still be intact.
    expect(await getActivity(OTHER_USER_ID, id)).not.toBeNull();
  });
});

// ============================================================================
// Dashboard aggregations
// ============================================================================

describe('dashboard aggregations', () => {
  beforeEach(async () => {
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: 500,
      capital: 5000,
    });
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: -200,
      symbol: 'ETH-PERP',
      capital: 3000,
    });
    await seedSaleActivity({ usdPaid: 1000, netPnl: 300 });
    await seedAirdropActivity({ netPnl: 800, protocol: 'Optimism' });
  });

  it('getTotals sums net P&L and counts winners/losers correctly', async () => {
    const totals = await getTotals(TEST_USER_ID);
    expect(totals.count).toBe(4);
    expect(totals.net).toBeCloseTo(500 - 200 + 300 + 800, 5);
    expect(totals.winners).toBe(3);
    expect(totals.losers).toBe(1);
    expect(totals.winRate).toBeCloseTo(75, 5);
    // Capital excludes airdrops (0 cost basis) — they would NOT contribute to
    // weighted return. Spread/trade/sale contribute.
    expect(totals.capital).toBeCloseTo(9000, 5);
    expect(totals.best?.netPnlUsd).toBeDefined();
    expect(totals.worst?.netPnlUsd).toBeDefined();
  });

  it('getActivityTypeCounts groups by type', async () => {
    const counts = await getActivityTypeCounts(TEST_USER_ID);
    expect(counts.trade).toBe(2);
    expect(counts.sale).toBe(1);
    expect(counts.airdrop).toBe(1);
    expect(counts.spread).toBe(0);
  });

  it('getActivityTypeNetPnl sums net P&L per type', async () => {
    const net = await getActivityTypeNetPnl(TEST_USER_ID);
    expect(net.trade).toBeCloseTo(300, 5); // 500 - 200
    expect(net.sale).toBeCloseTo(300, 5);
    expect(net.airdrop).toBeCloseTo(800, 5);
    expect(net.spread).toBe(0);
  });

  it('getRecentCloses returns the most recent N activities sorted by closed_at', async () => {
    const rows = await getRecentCloses(TEST_USER_ID, 10);
    expect(rows.length).toBe(4);
    // All sale's opened_at is set so it should appear in the list (closed_at
    // may be null for vesting sales; the query coalesces).
    expect(rows.map((r) => r.type).sort()).toEqual(
      ['airdrop', 'sale', 'trade', 'trade'],
    );
  });

  it('getRecentCloses respects the limit argument', async () => {
    const rows = await getRecentCloses(TEST_USER_ID, 2);
    expect(rows.length).toBe(2);
  });
});

// ============================================================================
// getDailyPnl — heatmap aggregation
// ============================================================================

describe('getDailyPnl', () => {
  beforeEach(async () => {
    // Three activities on three different days. Two on the same day to verify
    // aggregation.
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: 100,
      closedAt: '2026-05-10T12:00:00Z',
    });
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: -40,
      closedAt: '2026-05-10T16:00:00Z',
    });
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: 250,
      closedAt: '2026-05-12T09:00:00Z',
    });
    // Outside the window (after) — should not appear. The seed helper pins
    // openedAt to 2026-04-25, so we use a closedAt well after that to satisfy
    // chk_activity_dates.
    await seedTradeActivity({
      connectionId: testUser.connectionId,
      netPnl: 999,
      closedAt: '2026-06-01T09:00:00Z',
    });
  });

  it('buckets activities by date and aggregates net P&L + count', async () => {
    const rows = await getDailyPnl(TEST_USER_ID, '2026-05-09', '2026-05-15');
    // Two distinct days have activity in range.
    expect(rows).toHaveLength(2);
    const may10 = rows.find((r) => r.date === '2026-05-10');
    const may12 = rows.find((r) => r.date === '2026-05-12');
    expect(may10).toBeDefined();
    expect(may10!.netPnl).toBeCloseTo(60, 5); // 100 + -40
    expect(may10!.count).toBe(2);
    expect(may12).toBeDefined();
    expect(may12!.netPnl).toBeCloseTo(250, 5);
    expect(may12!.count).toBe(1);
  });

  it('excludes activities outside the date range', async () => {
    const rows = await getDailyPnl(TEST_USER_ID, '2026-05-09', '2026-05-15');
    // The June activity (999) must not leak in.
    for (const r of rows) {
      expect(r.netPnl).not.toBe(999);
      expect(r.date >= '2026-05-09' && r.date <= '2026-05-15').toBe(true);
    }
  });

  it('returns an empty array when no activities fall in the window', async () => {
    const rows = await getDailyPnl(TEST_USER_ID, '2025-01-01', '2025-01-31');
    expect(rows).toEqual([]);
  });

  it('does not leak across users', async () => {
    const rows = await getDailyPnl(OTHER_USER_ID, '2026-05-09', '2026-05-15');
    expect(rows).toEqual([]);
  });

  it('returns dates as YYYY-MM-DD strings, not timestamps', async () => {
    const rows = await getDailyPnl(TEST_USER_ID, '2026-05-09', '2026-05-15');
    for (const r of rows) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
