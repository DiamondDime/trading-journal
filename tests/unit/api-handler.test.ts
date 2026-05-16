/**
 * Unit tests for src/lib/api/handler.ts.
 *
 * `withAuth` is the load-bearing wrapper for every authenticated route. We
 * cover its three branches:
 *   1. NOT_AUTHENTICATED (APP_USER_ID unset) → 401
 *   2. Zod parse failure → 400 VALIDATION
 *   3. Happy path → handler's return Response passes through
 *
 * `parseBody` is a thin Zod wrapper; we cover the success branch and assert
 * that bad input raises ZodError (which the wrapper transforms to a 400).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, parseBody } from '@/lib/api/handler';

const SAVED_USER = process.env.APP_USER_ID;

afterEach(() => {
  // Restore APP_USER_ID for downstream tests.
  if (SAVED_USER === undefined) {
    delete process.env.APP_USER_ID;
  } else {
    process.env.APP_USER_ID = SAVED_USER;
  }
});

function makeReq(opts: { method?: string; body?: unknown } = {}): NextRequest {
  const { method = 'POST', body } = opts;
  // NextRequest's init type is stricter than DOM's RequestInit (signal can't
  // be null). Casting through `as never` keeps both happy without losing
  // typesafety on the input shape.
  const init: Record<string, unknown> = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new NextRequest('http://localhost:3000/_test', init as never);
}

describe('withAuth', () => {
  it('returns 401 UNAUTHORIZED when APP_USER_ID is unset', async () => {
    delete process.env.APP_USER_ID;
    const handler = withAuth(async () => new Response('should never run'));
    const res = await handler(makeReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('invokes the handler with userId from APP_USER_ID', async () => {
    process.env.APP_USER_ID = '00000000-0000-0000-0000-deadbeef1234';
    let seenUserId: string | null = null;
    const handler = withAuth(async (_req, { userId }) => {
      seenUserId = userId;
      return Response.json({ ok: true });
    });
    const res = await handler(makeReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(seenUserId).toBe('00000000-0000-0000-0000-deadbeef1234');
  });

  it('converts a thrown ZodError into a 400 VALIDATION response', async () => {
    process.env.APP_USER_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
    const handler = withAuth(async () => {
      // Throw a real ZodError. The wrapper should catch + format it.
      z.object({ x: z.number() }).parse({ x: 'oops' });
      return Response.json({});
    });
    const res = await handler(makeReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('returns 500 INTERNAL when the handler throws an unknown error', async () => {
    process.env.APP_USER_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';
    const handler = withAuth(async () => {
      throw new Error('boom');
    });
    // Silence the console.error the wrapper emits — it's expected here.
    const orig = console.error;
    console.error = () => {};
    try {
      const res = await handler(makeReq(), { params: Promise.resolve({}) });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('INTERNAL');
    } finally {
      console.error = orig;
    }
  });
});

describe('parseBody', () => {
  const Schema = z.object({ a: z.number(), b: z.string() });

  it('returns the validated payload on success', async () => {
    const req = makeReq({ body: { a: 1, b: 'two' } });
    const parsed = await parseBody(req, Schema);
    expect(parsed).toEqual({ a: 1, b: 'two' });
  });

  it('throws ZodError on invalid input (so withAuth can map to 400)', async () => {
    const req = makeReq({ body: { a: 'not-a-number', b: 'two' } });
    await expect(parseBody(req, Schema)).rejects.toThrow();
  });

  it('handles a malformed JSON body by passing {} to parse', async () => {
    // Schema requires `a` and `b` — empty object should ZodError.
    const init = {
      method: 'POST',
      body: 'this-is-not-json',
      headers: { 'content-type': 'application/json' },
    };
    const req = new NextRequest('http://localhost/_test', init as never);
    await expect(parseBody(req, Schema)).rejects.toThrow();
  });
});
