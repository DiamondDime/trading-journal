/**
 * Integration tests for the /api/activities/* route handlers.
 *
 * We import the route handler functions directly and invoke them with
 * NextRequest objects — no HTTP roundtrip, no Next dev server required.
 * APP_USER_ID is pinned to TEST_USER_ID via the setup file.
 *
 * Scope: status codes + envelope shape for the routes that exist today. The
 * Spread POST route and PATCH (Wave 6) are not covered here — those flows
 * use a different request shape and Wave 6 owns them.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from '@/lib/db/client';
import { seedTestUser, resetUserData, seedTradeActivity, TEST_USER_ID } from '../helpers/db';

// Route handlers — import after setup pinned env vars.
import { POST as POST_TRADE } from '@/app/api/activities/trade/route';
import { POST as POST_SALE } from '@/app/api/activities/sale/route';
import { POST as POST_AIRDROP } from '@/app/api/activities/airdrop/route';
import { GET as GET_LIST } from '@/app/api/activities/route';
import { GET as GET_ONE, DELETE as DELETE_ONE, PATCH as PATCH_ONE } from '@/app/api/activities/[id]/route';

let testUser: Awaited<ReturnType<typeof seedTestUser>>;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID);
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
});

afterAll(async () => {
  await sql.end();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function jsonReq(url: string, body: unknown, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function emptyCtx(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

// ===========================================================================
// POST /api/activities/trade
// ===========================================================================

describe('POST /api/activities/trade', () => {
  const validBody = {
    exchange: 'Binance',
    symbol: 'BTC-PERP',
    instrument: 'perp',
    side: 'long',
    capital: '5000',
    qty: '0.1',
    entryPrice: '60000',
    exitPrice: '62000',
    fees: '5',
    openedAt: '2026-05-01T10:00',
    closedAt: '2026-05-02T10:00',
    note: '',
    regimeTags: '',
  };

  it('returns 201 + { data: { id } } on the happy path', async () => {
    const req = jsonReq('http://localhost/api/activities/trade', validBody);
    const res = await POST_TRADE(req, emptyCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 400 VALIDATION on a malformed body', async () => {
    const req = jsonReq('http://localhost/api/activities/trade', {
      ...validBody,
      qty: '0', // PositiveDecimal rejects 0
    });
    const res = await POST_TRADE(req, emptyCtx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
  });

  it('returns 400 VALIDATION on unknown extra keys (.strict)', async () => {
    const req = jsonReq('http://localhost/api/activities/trade', {
      ...validBody,
      leverage: '5',
    });
    const res = await POST_TRADE(req, emptyCtx());
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// POST /api/activities/sale
// ===========================================================================

describe('POST /api/activities/sale', () => {
  it('returns 201 on a launchpad sale', async () => {
    const req = jsonReq('http://localhost/api/activities/sale', {
      saleKind: 'launchpad',
      venue: 'Binance Launchpad',
      asset: 'EIGEN',
      usdPaid: '1500',
      tokensAllocated: '500',
      tgeDate: '2026-04-01',
      tgeUnlockPct: 100,
      currentPriceUsd: '5',
      openedAt: '2026-03-15T10:00',
      note: '',
      regimeTags: '',
    });
    const res = await POST_SALE(req, emptyCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 400 when tgeUnlockPct exceeds 100', async () => {
    const req = jsonReq('http://localhost/api/activities/sale', {
      saleKind: 'launchpad',
      venue: 'X',
      asset: 'X',
      usdPaid: '1',
      tokensAllocated: '1',
      tgeDate: '2026-04-01',
      tgeUnlockPct: 150,
      currentPriceUsd: '1',
      openedAt: '2026-03-15T10:00',
    });
    const res = await POST_SALE(req, emptyCtx());
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// POST /api/activities/airdrop
// ===========================================================================

describe('POST /api/activities/airdrop', () => {
  it('returns 201 on a typical airdrop', async () => {
    const req = jsonReq('http://localhost/api/activities/airdrop', {
      protocol: 'Jupiter',
      asset: 'JUP',
      tokensClaimed: '1000',
      claimDate: '2026-01-31',
      usdValueAtClaim: '700',
      currentPriceUsd: '1.2',
      note: '',
      regimeTags: '',
    });
    const res = await POST_AIRDROP(req, emptyCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 400 on missing tokens_claimed', async () => {
    const req = jsonReq('http://localhost/api/activities/airdrop', {
      protocol: 'Jupiter',
      asset: 'JUP',
      claimDate: '2026-01-31',
      usdValueAtClaim: '0',
      currentPriceUsd: '1.2',
    });
    const res = await POST_AIRDROP(req, emptyCtx());
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GET /api/activities — list + filter
// ===========================================================================

describe('GET /api/activities', () => {
  it('returns { items: [], next_cursor: null } when the user has no rows', async () => {
    const req = new NextRequest('http://localhost/api/activities', { method: 'GET' });
    const res = await GET_LIST(req, emptyCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ items: [], next_cursor: null });
  });

  it('returns seeded items', async () => {
    await seedTradeActivity({ connectionId: testUser.connectionId });
    await seedTradeActivity({ connectionId: testUser.connectionId, symbol: 'ETH-PERP' });
    const req = new NextRequest('http://localhost/api/activities', { method: 'GET' });
    const res = await GET_LIST(req, emptyCtx());
    const body = await res.json();
    expect(body.data.items.length).toBe(2);
  });

  it('filters by type via query string', async () => {
    await seedTradeActivity({ connectionId: testUser.connectionId });
    const req = new NextRequest('http://localhost/api/activities?type=sale', { method: 'GET' });
    const res = await GET_LIST(req, emptyCtx());
    const body = await res.json();
    expect(body.data.items.length).toBe(0);
  });
});

// ===========================================================================
// GET /api/activities/[id]
// ===========================================================================

describe('GET /api/activities/[id]', () => {
  it('returns 404 for a non-UUID string (Wave 5A FIX-9)', async () => {
    // The bug: postgres rejected non-UUID inputs at parse time, returning 500.
    // The fix added a UUID guard in getActivity that returns null → 404.
    const req = new NextRequest('http://localhost/api/activities/tr-005', { method: 'GET' });
    const res = await GET_ONE(req, emptyCtx({ id: 'tr-005' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const req = new NextRequest('http://localhost/api/activities/abc', { method: 'GET' });
    const res = await GET_ONE(req, emptyCtx({ id: '00000000-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(404);
  });

  it('returns 200 + full row for a seeded trade', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const req = new NextRequest('http://localhost/api/activities/x', { method: 'GET' });
    const res = await GET_ONE(req, emptyCtx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(id);
    expect(body.data.type).toBe('trade');
    expect(body.data.subtype.type).toBe('trade');
  });
});

// ===========================================================================
// DELETE /api/activities/[id]
// ===========================================================================

describe('DELETE /api/activities/[id]', () => {
  it('returns 204 and subsequent GET returns 404', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const req = new NextRequest('http://localhost/api/activities/x', { method: 'DELETE' });
    const res = await DELETE_ONE(req, emptyCtx({ id }));
    expect(res.status).toBe(204);

    const getReq = new NextRequest('http://localhost/api/activities/x', { method: 'GET' });
    const getRes = await GET_ONE(getReq, emptyCtx({ id }));
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for a non-UUID string', async () => {
    const req = new NextRequest('http://localhost/api/activities/x', { method: 'DELETE' });
    const res = await DELETE_ONE(req, emptyCtx({ id: 'sa-001' }));
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// PATCH /api/activities/[id]
// ===========================================================================

describe('PATCH /api/activities/[id]', () => {
  it('returns 200 + updated row when patching common fields', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const req = jsonReq(
      'http://localhost/api/activities/x',
      { name: 'patched name' },
      'PATCH',
    );
    const res = await PATCH_ONE(req, emptyCtx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('patched name');
  });

  it('returns 404 on patch to a non-existent row', async () => {
    const req = jsonReq(
      'http://localhost/api/activities/x',
      { name: 'x' },
      'PATCH',
    );
    const res = await PATCH_ONE(req, emptyCtx({ id: '00000000-0000-0000-0000-000000000000' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 on a malformed patch body (unknown key, .strict)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const req = jsonReq(
      'http://localhost/api/activities/x',
      { weirdField: 'bad' },
      'PATCH',
    );
    const res = await PATCH_ONE(req, emptyCtx({ id }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-UUID id', async () => {
    const req = jsonReq('http://localhost/api/activities/x', { name: 'x' }, 'PATCH');
    const res = await PATCH_ONE(req, emptyCtx({ id: 'sa-001' }));
    expect(res.status).toBe(404);
  });
});
