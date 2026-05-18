/**
 * Shared auth middleware for the MCP HTTP API.
 *
 * The MCP server is intentionally local-only — it speaks to LLM clients
 * (Claude Desktop, Cursor) over a stdio bridge that proxies into Next.js
 * running inside Electron. Two defenses:
 *
 *   1. Shared secret token in `X-Journal-Token` matches `process.env.MCP_TOKEN`.
 *      Electron sets MCP_TOKEN before spawning the Next.js subprocess. Every
 *      request from the stdio bridge carries the token. Mismatch → 401.
 *
 *   2. Source must be loopback. The Next.js subprocess binds 127.0.0.1 only,
 *      so in practice the kernel enforces this. We additionally inspect
 *      `x-forwarded-for` because the only legitimate way that header arrives
 *      is through a misconfigured reverse proxy. If it's present and isn't a
 *      loopback address, refuse with 403.
 *
 * Why not use `requireUser`?
 *   The MCP routes are intentionally distinct from session-based UI routes.
 *   They have their own auth surface (shared-secret token) so they can be
 *   exposed without dragging in cookie state. The user_id we filter queries
 *   by is the single-user APP_USER_ID env — same as the rest of v1 auth, but
 *   read locally inside each route rather than via requireUser().
 */
import { NextRequest, NextResponse } from 'next/server';

/** Standard error envelope used by every MCP failure response. */
export function mcpError(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status },
  );
}

/** Standard success envelope used by every MCP route. */
export function mcpOk<T>(result: T): NextResponse {
  return NextResponse.json({ result });
}

/** True iff `value` is a loopback IPv4 / IPv6 address (raw or with port). */
function isLoopback(value: string | null | undefined): boolean {
  if (!value) return true;
  // x-forwarded-for can carry a comma-separated chain. We only fail if any
  // hop is non-loopback — the first hop is the originating client.
  const hops = value.split(',').map((s) => s.trim()).filter(Boolean);
  for (const hop of hops) {
    // Strip an optional `:port` suffix or `[ipv6]:port` wrap.
    let host = hop;
    if (host.startsWith('[')) {
      const end = host.indexOf(']');
      if (end > 0) host = host.slice(1, end);
    } else if (host.includes(':')) {
      // IPv4 with port — split on the last colon. Plain IPv6 has multiple
      // colons; we only strip a port when there's exactly one.
      if (host.split(':').length === 2) host = host.split(':')[0];
    }
    if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
      return false;
    }
  }
  return true;
}

/**
 * Verify an incoming MCP request. Returns null when the request is allowed,
 * or a Response with the appropriate error when it should be refused.
 *
 * Callers MUST early-return whatever this function returns:
 *
 *     export async function POST(req: NextRequest) {
 *       const refused = verifyMcpRequest(req);
 *       if (refused) return refused;
 *       // ...handler logic...
 *     }
 */
export function verifyMcpRequest(req: NextRequest): NextResponse | null {
  // 1. Loopback check first — even a request with a valid token must come
  //    from a local source. We accept the request if x-forwarded-for is
  //    absent (the common case for direct Electron→Next.js calls).
  const xff = req.headers.get('x-forwarded-for');
  if (!isLoopback(xff)) {
    return mcpError(
      'forbidden',
      'localhost-only',
      403,
    );
  }

  // 2. Token check. The bootstrap order matters: MCP_TOKEN is set by Electron
  //    before it spawns the Next.js subprocess, so it should always be
  //    present at request time. If it's unset we still refuse — accepting
  //    unauthenticated requests in that state would be an obvious foot-gun.
  const expectedToken = process.env.MCP_TOKEN;
  const presentedToken = req.headers.get('x-journal-token');
  if (!expectedToken || !presentedToken || presentedToken !== expectedToken) {
    return mcpError(
      'unauthorized',
      'invalid or missing X-Journal-Token',
      401,
    );
  }

  return null;
}

/**
 * Reads APP_USER_ID for query scoping. Distinct from `requireUser()` — we
 * don't go through the session-auth surface here. If APP_USER_ID is unset
 * we treat it as a server misconfiguration and return null so callers can
 * 500 with a descriptive message rather than crash mid-query.
 */
export function readMcpUserId(): string | null {
  return process.env.APP_USER_ID ?? null;
}
