/**
 * Integration tests for POST /api/mcp/v1/account_overview.
 *
 * Exercises:
 *   • returns AccountSnapshot shape
 *   • counts spreads/trades/sales/airdrops/yield/options correctly
 *   • includes connected exchanges WITHOUT credential ciphertext
 *   • lifetime / YTD / 30d P&L are decimal strings
 *   • top_tags accumulates across regime + custom + activity_tag sources
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from '@/lib/db/client';
import {
  seedTestUser,
  resetUserData,
  seedSpreadActivity,
  seedTradeActivity,
  seedSaleActivity,
  seedAirdropActivity,
  TEST_USER_ID,
} from '../../helpers/db';

import { POST as POST_OVERVIEW } from '@/app/api/mcp/v1/account_overview/route';

const TOKEN = 'account-overview-test-token';
let prevToken: string | undefined;
let connectionId: string;

beforeAll(async () => {
  const seeded = await seedTestUser(TEST_USER_ID);
  connectionId = seeded.connectionId;
  prevToken = process.env.MCP_TOKEN;
  process.env.MCP_TOKEN = TOKEN;
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
});

afterAll(async () => {
  if (prevToken === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = prevToken;
  await sql.end();
});

function mcpReq(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost/api/mcp/v1/account_overview', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-journal-token': TOKEN,
    },
  });
}

describe('POST /api/mcp/v1/account_overview', () => {
  it('returns the snapshot shape with zero counts when DB is empty', async () => {
    const res = await POST_OVERVIEW(mcpReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    const snap = body.result;
    expect(snap.total_activities).toBe(0);
    expect(snap.total_spreads).toBe(0);
    expect(snap.total_trades).toBe(0);
    expect(snap.total_sales).toBe(0);
    expect(snap.total_airdrops).toBe(0);
    expect(snap.total_yield_positions).toBe(0);
    expect(snap.total_options).toBe(0);
    expect(snap.open_spreads).toBe(0);
    expect(snap.open_options).toBe(0);
    // Decimal strings even when zero.
    expect(snap.lifetime_pnl_usd).toBe('0');
    expect(snap.ytd_pnl_usd).toBe('0');
    expect(snap.last_30d_pnl_usd).toBe('0');
    expect(snap.active_since).toBe(null);
    expect(Array.isArray(snap.connected_exchanges)).toBe(true);
    expect(Array.isArray(snap.top_tags)).toBe(true);
  });

  it('counts activities by type', async () => {
    await seedSpreadActivity();
    await seedTradeActivity({ connectionId });
    await seedSaleActivity();
    await seedAirdropActivity();

    const res = await POST_OVERVIEW(mcpReq({}));
    const snap = (await res.json()).result;
    expect(snap.total_activities).toBe(4);
    expect(snap.total_spreads).toBe(1);
    expect(snap.total_trades).toBe(1);
    expect(snap.total_sales).toBe(1);
    expect(snap.total_airdrops).toBe(1);
  });

  it('sums lifetime P&L across all closed activities (decimal string)', async () => {
    await seedTradeActivity({ connectionId, netPnl: 100 });
    await seedTradeActivity({ connectionId, netPnl: -25.5 });
    const res = await POST_OVERVIEW(mcpReq({}));
    const snap = (await res.json()).result;
    expect(typeof snap.lifetime_pnl_usd).toBe('string');
    // 100 + (-25.5) = 74.5 — string equality with decimal.js normalization.
    expect(snap.lifetime_pnl_usd).toBe('74.5');
  });

  it('reflects active_since as earliest activity timestamp', async () => {
    await seedSpreadActivity();
    const res = await POST_OVERVIEW(mcpReq({}));
    const snap = (await res.json()).result;
    expect(typeof snap.active_since).toBe('string');
    // seedSpreadActivity uses 2026-04-01.
    expect(snap.active_since.startsWith('2026-04-01')).toBe(true);
  });

  it('counts open spreads separately from total spreads', async () => {
    await seedSpreadActivity({ status: 'closed' });
    await seedSpreadActivity({ status: 'open' });
    await seedSpreadActivity({ status: 'open' });
    const res = await POST_OVERVIEW(mcpReq({}));
    const snap = (await res.json()).result;
    expect(snap.total_spreads).toBe(3);
    expect(snap.open_spreads).toBe(2);
  });

  it('returns connected_exchanges WITHOUT any ciphertext / nonce columns', async () => {
    // The seed helper creates a "_manual_entry" sentinel connection. That
    // counts as a connected exchange and must come back without secrets.
    const res = await POST_OVERVIEW(mcpReq({}));
    const text = await res.text();
    const snap = JSON.parse(text).result;
    expect(snap.connected_exchanges.length).toBeGreaterThan(0);
    // Each connection has the expected three fields and nothing else.
    for (const conn of snap.connected_exchanges) {
      expect(typeof conn.code).toBe('string');
      expect(typeof conn.display_name).toBe('string');
      expect(conn.last_sync_at === null || typeof conn.last_sync_at === 'string').toBe(true);
      // Ensure no foreign keys to credential columns crept in.
      expect(conn).not.toHaveProperty('api_key_ciphertext');
      expect(conn).not.toHaveProperty('api_secret_ciphertext');
      expect(conn).not.toHaveProperty('encrypted_credentials');
      expect(conn).not.toHaveProperty('iv');
      expect(conn).not.toHaveProperty('salt');
      expect(conn).not.toHaveProperty('auth_tag');
    }
    // Body-level audit: no ciphertext keyword anywhere.
    expect(text).not.toMatch(/ciphertext/i);
    expect(text).not.toMatch(/encryption_key_version/i);
  });

  it('aggregates top_tags across regime + custom + activity_tag sources', async () => {
    const a = await seedSpreadActivity({ name: 'taggy 1' });
    const b = await seedSpreadActivity({ name: 'taggy 2' });
    // Sprinkle tags via UPDATE — the seed helper uses empty arrays.
    await sql`UPDATE public.activity SET regime_tags = ARRAY['high_funding','backwardation']::text[] WHERE id = ${a}::uuid`;
    await sql`UPDATE public.activity SET custom_tags = ARRAY['high_funding']::text[] WHERE id = ${b}::uuid`;
    await sql`INSERT INTO public.activity_tag (user_id, activity_id, tag) VALUES (${TEST_USER_ID}::uuid, ${a}::uuid, 'high_funding'), (${TEST_USER_ID}::uuid, ${a}::uuid, 'new_strategy')`;

    const res = await POST_OVERVIEW(mcpReq({}));
    const snap = (await res.json()).result;
    expect(Array.isArray(snap.top_tags)).toBe(true);
    const byName = Object.fromEntries(snap.top_tags.map((t: { name: string; count: number }) => [t.name, t.count]));
    expect(byName.high_funding).toBeGreaterThanOrEqual(3);
    expect(byName.backwardation).toBe(1);
    expect(byName.new_strategy).toBe(1);
  });

  it('rejects unknown keys (.strict)', async () => {
    const res = await POST_OVERVIEW(mcpReq({ unknown: true }));
    expect(res.status).toBe(400);
  });
});
