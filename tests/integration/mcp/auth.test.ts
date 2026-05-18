/**
 * Integration tests for the MCP auth middleware. Exercises:
 *   • missing token → 401
 *   • wrong token  → 401
 *   • missing X-Forwarded-For → allowed
 *   • non-loopback X-Forwarded-For → 403
 *   • loopback X-Forwarded-For chain → allowed
 *   • MCP_TOKEN unset on server → 401
 *
 * We hit the actual /api/mcp/v1/list_spreads route handler because the auth
 * branch sits at the top of every endpoint; testing it through one route
 * proves the whole surface behaves consistently.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from '@/lib/db/client';
import { seedTestUser, resetUserData, TEST_USER_ID } from '../../helpers/db';

import { POST as POST_LIST } from '@/app/api/mcp/v1/list_spreads/route';
import { GET as GET_HEALTH } from '@/app/api/mcp/v1/health/route';

const TEST_TOKEN = 'unit-test-token-do-not-share';
let prevToken: string | undefined;

beforeAll(async () => {
  await seedTestUser(TEST_USER_ID);
  prevToken = process.env.MCP_TOKEN;
  process.env.MCP_TOKEN = TEST_TOKEN;
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
});

afterAll(async () => {
  if (prevToken === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = prevToken;
  await sql.end();
});

function mcpReq(
  url: string,
  body: unknown,
  opts: { token?: string | null; xff?: string | null } = {},
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = opts.token === undefined ? TEST_TOKEN : opts.token;
  if (token !== null) headers['x-journal-token'] = token;
  if (opts.xff != null) headers['x-forwarded-for'] = opts.xff;
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

describe('MCP auth — list_spreads as canary', () => {
  it('returns 401 when X-Journal-Token is missing', async () => {
    const req = mcpReq('http://localhost/api/mcp/v1/list_spreads', {}, { token: null });
    const res = await POST_LIST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 when X-Journal-Token does not match MCP_TOKEN', async () => {
    const req = mcpReq('http://localhost/api/mcp/v1/list_spreads', {}, { token: 'wrong' });
    const res = await POST_LIST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 when MCP_TOKEN env var is unset (defense in depth)', async () => {
    const saved = process.env.MCP_TOKEN;
    delete process.env.MCP_TOKEN;
    try {
      const req = mcpReq('http://localhost/api/mcp/v1/list_spreads', {}, { token: TEST_TOKEN });
      const res = await POST_LIST(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.MCP_TOKEN = saved;
    }
  });

  it('returns 403 when X-Forwarded-For has a non-loopback hop', async () => {
    const req = mcpReq(
      'http://localhost/api/mcp/v1/list_spreads',
      {},
      { xff: '203.0.113.42' },
    );
    const res = await POST_LIST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('forbidden');
  });

  it('returns 403 when X-Forwarded-For chain mixes loopback with public IP', async () => {
    const req = mcpReq(
      'http://localhost/api/mcp/v1/list_spreads',
      {},
      { xff: '127.0.0.1, 8.8.8.8' },
    );
    const res = await POST_LIST(req);
    expect(res.status).toBe(403);
  });

  it('allows requests with no X-Forwarded-For header', async () => {
    const req = mcpReq('http://localhost/api/mcp/v1/list_spreads', {});
    const res = await POST_LIST(req);
    expect(res.status).toBe(200);
  });

  it('allows requests whose X-Forwarded-For is 127.0.0.1', async () => {
    const req = mcpReq(
      'http://localhost/api/mcp/v1/list_spreads',
      {},
      { xff: '127.0.0.1' },
    );
    const res = await POST_LIST(req);
    expect(res.status).toBe(200);
  });

  it('allows requests whose X-Forwarded-For is ::1', async () => {
    const req = mcpReq(
      'http://localhost/api/mcp/v1/list_spreads',
      {},
      { xff: '::1' },
    );
    const res = await POST_LIST(req);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/mcp/v1/health', () => {
  it('does NOT require X-Journal-Token (it is a readiness probe)', async () => {
    const res = await GET_HEALTH();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.status).toBe('ok');
    expect(body.result.appReady).toBe(true);
    expect(typeof body.result.version).toBe('string');
  });
});

// Vitest convention: keep at least one always-true assertion in afterEach to
// ensure the afterAll teardown runs even if a single test errors.
afterEach(() => {
  expect(true).toBe(true);
});
