/**
 * Integration tests for POST /api/mcp/v1/get_spread.
 *
 * Exercises:
 *   • returns SpreadDetail for an owned spread
 *   • includes legs array (empty when no legs seeded — they're optional)
 *   • returns 404 for non-existent UUID
 *   • returns 404 for non-UUID string (no crash from postgres uuid parser)
 *   • returns 400 on missing/invalid body
 *   • NEVER leaks encrypted credential columns
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { sql } from '@/lib/db/client';
import {
  seedTestUser,
  resetUserData,
  seedSpreadActivity,
  seedNoteForActivity,
  TEST_USER_ID,
} from '../../helpers/db';

import { POST as POST_GET } from '@/app/api/mcp/v1/get_spread/route';

const TOKEN = 'get-spread-test-token';
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
  return new NextRequest('http://localhost/api/mcp/v1/get_spread', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-journal-token': TOKEN,
    },
  });
}

describe('POST /api/mcp/v1/get_spread', () => {
  it('returns SpreadDetail with summary + empty legs/fills + null note', async () => {
    const id = await seedSpreadActivity({ name: 'BTC carry' });
    const res = await POST_GET(mcpReq({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.id).toBe(id);
    expect(body.result.coin).toBe('BTC');
    expect(body.result.status).toBe('closed');
    expect(body.result.spread_type).toBe('cash_carry');
    expect(Array.isArray(body.result.legs)).toBe(true);
    expect(Array.isArray(body.result.fills)).toBe(true);
    expect(body.result.note).toBe(null);
    // Decimal fields are strings.
    expect(
      body.result.net_pnl_usd === null ||
        typeof body.result.net_pnl_usd === 'string',
    ).toBe(true);
    // Summary is composed.
    expect(typeof body.result.summary).toBe('string');
  });

  it('attaches the note when one exists', async () => {
    const id = await seedSpreadActivity({ name: 'note-test' });
    await seedNoteForActivity(TEST_USER_ID, id, 'why I entered this trade');
    const res = await POST_GET(mcpReq({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.has_note).toBe(true);
    expect(body.result.note).not.toBe(null);
    expect(body.result.note.body).toBe('why I entered this trade');
    expect(typeof body.result.note.created_at).toBe('string');
  });

  it('returns 404 for a non-existent UUID', async () => {
    const res = await POST_GET(
      mcpReq({ id: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');
  });

  it('returns 404 for a non-UUID string without crashing the parser', async () => {
    const res = await POST_GET(mcpReq({ id: 'not-a-uuid' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('not_found');
  });

  it('returns 400 when id is missing from the body', async () => {
    const res = await POST_GET(mcpReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_request');
  });

  it('returns 400 on unknown extra keys (.strict)', async () => {
    const res = await POST_GET(
      mcpReq({ id: '00000000-0000-0000-0000-000000000000', extra: 1 }),
    );
    expect(res.status).toBe(400);
  });

  it('NEVER leaks credential ciphertext columns in the response', async () => {
    const id = await seedSpreadActivity({ name: 'audit' });
    const res = await POST_GET(mcpReq({ id }));
    const text = await res.text();
    expect(text).not.toMatch(/api_key_ciphertext/i);
    expect(text).not.toMatch(/api_secret_ciphertext/i);
    expect(text).not.toMatch(/wallet_address_ciphertext/i);
    expect(text).not.toMatch(/auth_tag/i);
    expect(text).not.toMatch(/ciphertext/i);
    expect(text).not.toMatch(/encryption_key_version/i);
  });

  it('cross-user access is blocked — a spread owned by another user returns 404', async () => {
    // Seed a spread owned by TEST_USER_ID, then call the route with an
    // APP_USER_ID that points at OTHER_USER_ID. Because the middleware
    // reads process.env.APP_USER_ID at request time we can pivot.
    const id = await seedSpreadActivity({ name: 'cross-user' });
    const saved = process.env.APP_USER_ID;
    process.env.APP_USER_ID = '99999999-9999-9999-9999-999999999999';
    try {
      const res = await POST_GET(mcpReq({ id }));
      expect(res.status).toBe(404);
    } finally {
      process.env.APP_USER_ID = saved;
    }
  });
});
