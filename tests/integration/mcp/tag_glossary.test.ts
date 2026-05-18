/**
 * Integration tests for POST /api/mcp/v1/tag_glossary.
 *
 * Exercises:
 *   • returns sorted-by-count list of all distinct tags
 *   • description is null when the column doesn't exist yet
 *   • empty body returns { empty: true, hint }
 *   • rejects unknown keys
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

import { POST as POST_GLOSSARY } from '@/app/api/mcp/v1/tag_glossary/route';

const TOKEN = 'tag-glossary-test-token';
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

function mcpReq(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost/api/mcp/v1/tag_glossary', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-journal-token': TOKEN,
    },
  });
}

describe('POST /api/mcp/v1/tag_glossary', () => {
  it('returns { empty: true, hint } when no tags exist', async () => {
    const res = await POST_GLOSSARY(mcpReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tags).toEqual([]);
    expect(body.result.empty).toBe(true);
    expect(typeof body.result.hint).toBe('string');
  });

  it('lists tags sorted by count desc', async () => {
    const a = await seedSpreadActivity({ name: 'a' });
    const b = await seedSpreadActivity({ name: 'b' });
    await sql`UPDATE public.activity SET regime_tags = ARRAY['cash_carry','funding']::text[] WHERE id = ${a}::uuid`;
    await sql`UPDATE public.activity SET custom_tags = ARRAY['cash_carry']::text[] WHERE id = ${b}::uuid`;

    const res = await POST_GLOSSARY(mcpReq({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    const tags = body.result.tags;
    // cash_carry appears twice (one regime, one custom). funding once.
    const cashCarry = tags.find((t: { name: string }) => t.name === 'cash_carry');
    const funding = tags.find((t: { name: string }) => t.name === 'funding');
    expect(cashCarry.count).toBe(2);
    expect(funding.count).toBe(1);
    // sort order: cash_carry first because count is higher
    expect(tags[0].name).toBe('cash_carry');
  });

  it('returns description=null when the column does not exist (Phase 1)', async () => {
    const a = await seedSpreadActivity({ name: 'desc-test' });
    await sql`UPDATE public.activity SET regime_tags = ARRAY['cash_carry']::text[] WHERE id = ${a}::uuid`;
    const res = await POST_GLOSSARY(mcpReq({}));
    const body = await res.json();
    for (const tag of body.result.tags) {
      expect(tag.description).toBe(null);
    }
  });

  it('handles activity_tag rows alongside regime/custom arrays', async () => {
    const id = await seedSpreadActivity({ name: 'mixed' });
    await sql`UPDATE public.activity SET regime_tags = ARRAY['onchain']::text[] WHERE id = ${id}::uuid`;
    await sql`INSERT INTO public.activity_tag (user_id, activity_id, tag) VALUES (${TEST_USER_ID}::uuid, ${id}::uuid, 'manual_entry')`;

    const res = await POST_GLOSSARY(mcpReq({}));
    const body = await res.json();
    const names = body.result.tags.map((t: { name: string }) => t.name).sort();
    expect(names).toContain('onchain');
    expect(names).toContain('manual_entry');
  });

  it('rejects unknown keys (.strict)', async () => {
    const res = await POST_GLOSSARY(mcpReq({ unknown: 1 }));
    expect(res.status).toBe(400);
  });
});
