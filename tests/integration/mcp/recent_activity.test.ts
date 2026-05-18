/**
 * Integration tests for POST /api/mcp/v1/recent_activity.
 *
 * Exercises:
 *   • happy path returns { opened, closed, recent[] }
 *   • days param controls the window
 *   • days cap at 365 server-side
 *   • empty when no recent activity returns hint
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from '@/lib/db/client';
import {
  seedTestUser,
  resetUserData,
  seedSpreadActivity,
  TEST_USER_ID,
} from '../../helpers/db';

import { POST as POST_RECENT } from '@/app/api/mcp/v1/recent_activity/route';

const TOKEN = 'recent-activity-test-token';
let prevToken: string | undefined;

beforeAll(async () => {
  await seedTestUser(TEST_USER_ID);
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

function mcpReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mcp/v1/recent_activity', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-journal-token': TOKEN,
    },
  });
}

describe('POST /api/mcp/v1/recent_activity', () => {
  it('returns { empty: true, hint } when no recent activity', async () => {
    const res = await POST_RECENT(mcpReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.opened).toBe(0);
    expect(body.result.closed).toBe(0);
    expect(body.result.recent).toEqual([]);
    expect(body.result.empty).toBe(true);
    expect(typeof body.result.hint).toBe('string');
  });

  it('counts opened + closed spreads in the default 7d window', async () => {
    // seedSpreadActivity uses opened_at = 2026-04-01 and closed_at = 2026-04-20,
    // which is well outside any default 7d/30d window of "now". We override
    // the timestamps to land inside the last 7 days.
    const recent = await seedSpreadActivity({ name: 'recent' });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const today = new Date().toISOString();
    await sql`
      UPDATE public.activity SET opened_at = ${yesterday}::timestamptz,
                                  closed_at = ${today}::timestamptz
      WHERE id = ${recent}::uuid
    `;

    const stale = await seedSpreadActivity({ name: 'stale' });
    // stale activity uses default dates 2026-04-{01,20}. Confirm it lives
    // outside the 7d window — we won't see it in recent[].
    void stale;

    const res = await POST_RECENT(mcpReq({ days: 7 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.opened).toBe(1);
    expect(body.result.closed).toBe(1);
    expect(body.result.recent.length).toBe(1);
    expect(body.result.recent[0].id).toBe(recent);
  });

  it('accepts days param and uses it as the window', async () => {
    const id = await seedSpreadActivity({ name: 'inside-30' });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await sql`
      UPDATE public.activity SET opened_at = ${tenDaysAgo}::timestamptz,
                                  closed_at = ${fiveDaysAgo}::timestamptz
      WHERE id = ${id}::uuid
    `;

    const sevenDays = await POST_RECENT(mcpReq({ days: 7 }));
    const sevenBody = await sevenDays.json();
    // Closed 5 days ago is inside the 7d window even though opened 10 days
    // ago — so the recent[] should include it.
    expect(sevenBody.result.closed).toBe(1);
    expect(sevenBody.result.recent.length).toBe(1);

    const threeDays = await POST_RECENT(mcpReq({ days: 3 }));
    const threeBody = await threeDays.json();
    // 3-day window excludes both opened and closed timestamps.
    expect(threeBody.result.opened).toBe(0);
    expect(threeBody.result.closed).toBe(0);
  });

  it('caps days at 365 server-side', async () => {
    // Bigger numbers should still respond 200 (capped) — not 400.
    const res = await POST_RECENT(mcpReq({ days: 1000 }));
    expect(res.status).toBe(200);
  });

  it('rejects negative or zero days', async () => {
    const res = await POST_RECENT(mcpReq({ days: 0 }));
    expect(res.status).toBe(400);
  });

  it('rejects unknown keys (.strict)', async () => {
    const res = await POST_RECENT(mcpReq({ window: 7 }));
    expect(res.status).toBe(400);
  });
});
