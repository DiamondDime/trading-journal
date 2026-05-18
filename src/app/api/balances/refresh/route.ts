/**
 * POST /api/balances/refresh — user-triggered re-fetch.
 *
 * Calls the worker HTTP server's `POST /refresh-balances` endpoint, which
 * re-syncs each connection's balance table and writes one
 * `portfolio_snapshots` row with `source='manual_refresh'`. Synchronous —
 * the user sees a spinner until the worker finishes (usually under 10s for
 * a handful of exchanges).
 *
 * Worker unreachable → 503. Worker reports errors per-connection → 200 with
 * the per-connection counters; UI surfaces them as "11/13 refreshed".
 */
import { withAuth } from "@/lib/api/handler";
import { ok, error as apiError, errors } from "@/lib/api/response";

export const dynamic = "force-dynamic";

const DEFAULT_WORKER_URL = "http://127.0.0.1:7430";
const REQUEST_TIMEOUT_MS = 30_000;

export const POST = withAuth(async (_req, { userId }) => {
  const baseUrl = process.env.WORKER_HTTP_URL ?? DEFAULT_WORKER_URL;
  const secret = process.env.WORKER_HTTP_SECRET;

  if (!secret) {
    return errors.internal("WORKER_HTTP_SECRET is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/refresh-balances`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ user_id: userId }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!resp.ok) {
      return apiError(
        "WORKER_ERROR",
        `worker responded ${resp.status}`,
        503,
      );
    }

    const body = (await resp.json()) as {
      ok: boolean;
      connections: number;
      upserted: number;
      reaped: number;
      snapshots: number;
      errors: number;
      message?: string | null;
    };

    return ok({
      ...body,
      requestedAt: new Date().toISOString(),
    });
  } catch (e) {
    const err = e as Error;
    const code =
      err.name === "AbortError" ? "WORKER_TIMEOUT" : "WORKER_UNREACHABLE";
    return apiError(code, err.message, 503);
  } finally {
    clearTimeout(timer);
  }
});
