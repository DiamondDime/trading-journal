/**
 * Wave 13C contract tests — Workshop pages (notes feed + saved views).
 *
 * Covered:
 *   • listAllNotes — basic feed, search ILIKE, activity-type filter, single
 *     tag filter, sort orders, pagination via limit/offset.
 *   • countAllNotes — matches listAllNotes filter semantics.
 *   • createSavedView / listSavedViews / updateSavedView / deleteSavedView
 *     round-trip with the URL stored inside the filters jsonb column.
 *   • validateAndNormaliseQueryString — rejects external URLs / traversal /
 *     non-allowlisted paths, normalises query-param order.
 *   • countActivitiesForView — applies the URL's activity/outcome filters,
 *     caps at 200.
 *
 * Terse on purpose — one assert per scenario unless a second is structurally
 * required.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from '@/lib/db/client';
import {
  upsertNote,
  listAllNotes,
  countAllNotes,
} from '@/lib/db/notes';
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  getSavedView,
  countActivitiesForView,
  validateAndNormaliseQueryString,
  InvalidQueryStringError,
} from '@/lib/db/saved-views';
import { setTagsForActivity } from '@/lib/db/satellite';
import {
  seedTestUser,
  resetUserData,
  seedTradeActivity,
  seedSaleActivity,
  seedAirdropActivity,
  TEST_USER_ID,
} from '../helpers/db';

let testUser: Awaited<ReturnType<typeof seedTestUser>>;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID);
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
  // saved_views isn't owned by resetUserData (it's not a hot-path table); clear
  // anything left behind from earlier runs so listSavedViews returns a clean
  // canvas.
  await sql`DELETE FROM public.saved_views WHERE user_id = ${TEST_USER_ID}::uuid`;
});

afterAll(async () => {
  await sql.end();
});

// ============================================================================
// listAllNotes
// ============================================================================

describe('listAllNotes', () => {
  it('returns notes joined with activity metadata', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertNote(TEST_USER_ID, id, 'Bought the dip on ETF news');
    const rows = await listAllNotes(TEST_USER_ID, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      activityId: id,
      activityType: 'trade',
      body: 'Bought the dip on ETF news',
    });
    expect(rows[0].activityName).toBeTruthy();
  });

  it('filters by search (ILIKE on body)', async () => {
    const a = await seedTradeActivity({ connectionId: testUser.connectionId });
    const b = await seedSaleActivity({});
    await upsertNote(TEST_USER_ID, a, 'Long thesis with stop at $58k');
    await upsertNote(TEST_USER_ID, b, 'IDO allocation hit the cap');
    const rows = await listAllNotes(TEST_USER_ID, { search: 'IDO' });
    expect(rows.map((r) => r.activityId)).toEqual([b]);
  });

  it('filters by activity type', async () => {
    const trade = await seedTradeActivity({ connectionId: testUser.connectionId });
    const sale = await seedSaleActivity({});
    await upsertNote(TEST_USER_ID, trade, 'trade note');
    await upsertNote(TEST_USER_ID, sale, 'sale note');
    const rows = await listAllNotes(TEST_USER_ID, { activityType: ['sale'] });
    expect(rows.map((r) => r.activityType)).toEqual(['sale']);
  });

  it('filters by single tag', async () => {
    const a = await seedTradeActivity({ connectionId: testUser.connectionId });
    const b = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertNote(TEST_USER_ID, a, 'tagged note');
    await upsertNote(TEST_USER_ID, b, 'untagged note');
    await setTagsForActivity(TEST_USER_ID, a, ['breakout']);
    const rows = await listAllNotes(TEST_USER_ID, { tag: 'breakout' });
    expect(rows.map((r) => r.activityId)).toEqual([a]);
    expect(rows[0].tags).toContain('breakout');
  });

  it('honours the limit + offset for pagination', async () => {
    const ids = await Promise.all(
      Array.from({ length: 3 }).map(() =>
        seedTradeActivity({ connectionId: testUser.connectionId }),
      ),
    );
    for (const id of ids) {
      await upsertNote(TEST_USER_ID, id, `note for ${id.slice(0, 4)}`);
    }
    const first = await listAllNotes(TEST_USER_ID, { limit: 2, offset: 0 });
    const second = await listAllNotes(TEST_USER_ID, { limit: 2, offset: 2 });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(first.some((r) => r.activityId === second[0].activityId)).toBe(false);
  });

  it('excludes soft-deleted activities', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertNote(TEST_USER_ID, id, 'note attached');
    await sql`
      UPDATE public.activity SET deleted_at = now()
      WHERE id = ${id}::uuid
    `;
    const rows = await listAllNotes(TEST_USER_ID, {});
    expect(rows).toHaveLength(0);
  });

  it('excludes notes with empty bodies', async () => {
    const a = await seedTradeActivity({ connectionId: testUser.connectionId });
    const b = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertNote(TEST_USER_ID, a, 'has body');
    await upsertNote(TEST_USER_ID, b, '   '); // whitespace-only
    const rows = await listAllNotes(TEST_USER_ID, {});
    expect(rows.map((r) => r.activityId)).toEqual([a]);
  });

  it('sort=longest orders by octet_length(body) desc', async () => {
    const short = await seedTradeActivity({ connectionId: testUser.connectionId });
    const long = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertNote(TEST_USER_ID, short, 'short');
    await upsertNote(TEST_USER_ID, long, 'a much longer body that beats short');
    const rows = await listAllNotes(TEST_USER_ID, { sort: 'longest' });
    expect(rows[0].activityId).toBe(long);
  });
});

describe('countAllNotes', () => {
  it('matches listAllNotes filter semantics', async () => {
    const a = await seedTradeActivity({ connectionId: testUser.connectionId });
    const b = await seedAirdropActivity({});
    await upsertNote(TEST_USER_ID, a, 'foo');
    await upsertNote(TEST_USER_ID, b, 'bar');
    expect(await countAllNotes(TEST_USER_ID, {})).toBe(2);
    expect(await countAllNotes(TEST_USER_ID, { search: 'foo' })).toBe(1);
    expect(
      await countAllNotes(TEST_USER_ID, { activityType: ['airdrop'] }),
    ).toBe(1);
  });
});

// ============================================================================
// validateAndNormaliseQueryString
// ============================================================================

describe('validateAndNormaliseQueryString', () => {
  it('accepts /spreads/archive root', () => {
    expect(validateAndNormaliseQueryString('/spreads/archive')).toBe(
      '/spreads/archive',
    );
  });

  it('accepts /spreads/archive with params', () => {
    expect(
      validateAndNormaliseQueryString('/spreads/archive?activity=trade'),
    ).toBe('/spreads/archive?activity=trade');
  });

  it('accepts /calendar', () => {
    expect(validateAndNormaliseQueryString('/calendar')).toBe('/calendar');
  });

  it('sorts query params for dedupe', () => {
    const got = validateAndNormaliseQueryString(
      '/spreads/archive?b=2&a=1&c=3',
    );
    expect(got).toBe('/spreads/archive?a=1&b=2&c=3');
  });

  it('rejects absolute URLs', () => {
    expect(() =>
      validateAndNormaliseQueryString('https://evil.com/spreads/archive'),
    ).toThrow(InvalidQueryStringError);
  });

  it('rejects protocol-relative URLs', () => {
    expect(() =>
      validateAndNormaliseQueryString('//evil.com/spreads/archive'),
    ).toThrow(InvalidQueryStringError);
  });

  it('rejects javascript: URIs', () => {
    expect(() =>
      validateAndNormaliseQueryString('javascript:alert(1)'),
    ).toThrow(InvalidQueryStringError);
  });

  it('rejects path traversal', () => {
    expect(() =>
      validateAndNormaliseQueryString('/spreads/archive/../../etc'),
    ).toThrow(InvalidQueryStringError);
  });

  it('rejects paths outside the allowlist', () => {
    expect(() => validateAndNormaliseQueryString('/admin')).toThrow(
      InvalidQueryStringError,
    );
  });

  it('rejects non-leading-slash URLs', () => {
    expect(() => validateAndNormaliseQueryString('spreads/archive')).toThrow(
      InvalidQueryStringError,
    );
  });
});

// ============================================================================
// saved_views CRUD
// ============================================================================

describe('saved-views CRUD', () => {
  it('creates a view and reads it back via list', async () => {
    const created = await createSavedView(TEST_USER_ID, {
      name: 'Winners',
      description: 'Top trades',
      queryString: '/spreads/archive?outcome=winners',
    });
    const list = await listSavedViews(TEST_USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: created.id,
      name: 'Winners',
      description: 'Top trades',
      queryString: '/spreads/archive?outcome=winners',
    });
  });

  it('throws on invalid query string', async () => {
    await expect(
      createSavedView(TEST_USER_ID, {
        name: 'Evil',
        queryString: 'https://evil.com/path',
      }),
    ).rejects.toThrow(InvalidQueryStringError);
  });

  it('rejects empty names', async () => {
    await expect(
      createSavedView(TEST_USER_ID, {
        name: '   ',
        queryString: '/spreads/archive',
      }),
    ).rejects.toThrow(InvalidQueryStringError);
  });

  it('updates name + queryString + description', async () => {
    const created = await createSavedView(TEST_USER_ID, {
      name: 'Initial',
      queryString: '/spreads/archive',
    });
    const updated = await updateSavedView(TEST_USER_ID, created.id, {
      name: 'Updated',
      description: 'new desc',
      queryString: '/spreads/archive?activity=trade',
    });
    expect(updated).toMatchObject({
      name: 'Updated',
      description: 'new desc',
      queryString: '/spreads/archive?activity=trade',
    });
  });

  it('bumps lastAppliedAt when requested', async () => {
    const created = await createSavedView(TEST_USER_ID, {
      name: 'Apply me',
      queryString: '/spreads/archive',
    });
    expect(created.lastAppliedAt).toBeNull();
    const updated = await updateSavedView(TEST_USER_ID, created.id, {
      bumpLastApplied: true,
    });
    expect(updated?.lastAppliedAt).not.toBeNull();
  });

  it('deletes a saved view', async () => {
    const created = await createSavedView(TEST_USER_ID, {
      name: 'Delete me',
      queryString: '/spreads/archive',
    });
    expect(await deleteSavedView(TEST_USER_ID, created.id)).toBe(true);
    expect(await getSavedView(TEST_USER_ID, created.id)).toBeNull();
  });

  it('does not cross users', async () => {
    const created = await createSavedView(TEST_USER_ID, {
      name: 'Private',
      queryString: '/spreads/archive',
    });
    expect(
      await getSavedView('22222222-2222-2222-2222-222222222222', created.id),
    ).toBeNull();
    expect(
      await updateSavedView(
        '22222222-2222-2222-2222-222222222222',
        created.id,
        { name: 'Hijacked' },
      ),
    ).toBeNull();
    expect(
      await deleteSavedView('22222222-2222-2222-2222-222222222222', created.id),
    ).toBe(false);
  });
});

// ============================================================================
// countActivitiesForView
// ============================================================================

describe('countActivitiesForView', () => {
  it('counts all activities for an unfiltered URL', async () => {
    await seedTradeActivity({ connectionId: testUser.connectionId });
    await seedSaleActivity({});
    const { count } = await countActivitiesForView(TEST_USER_ID, {
      queryString: '/spreads/archive',
    });
    expect(count).toBe(2);
  });

  it('respects activity= filter', async () => {
    await seedTradeActivity({ connectionId: testUser.connectionId });
    await seedSaleActivity({});
    const { count } = await countActivitiesForView(TEST_USER_ID, {
      queryString: '/spreads/archive?activity=sale',
    });
    expect(count).toBe(1);
  });

  it('respects outcome=winners', async () => {
    await seedTradeActivity({ connectionId: testUser.connectionId, netPnl: 100 });
    await seedTradeActivity({ connectionId: testUser.connectionId, netPnl: -200 });
    const { count } = await countActivitiesForView(TEST_USER_ID, {
      queryString: '/spreads/archive?outcome=winners',
    });
    expect(count).toBe(1);
  });
});
