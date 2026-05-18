/**
 * Worker HTTP client — the Next.js side of the connect-test handshake.
 *
 * The Python worker exposes a tiny HTTP surface (see
 * `worker/csj_worker/http_server.py`) bound to loopback by default. The
 * `POST /api/exchanges` handler calls `testConnectionViaWorker(id)` after
 * writing the encrypted credential ciphertexts but BEFORE flipping
 * `status` to `active`. If the worker rejects the key, the row is rolled
 * back so the user gets immediate feedback instead of waiting up to 5 min
 * for the daemon's first cycle.
 *
 * Configuration (env vars read at request time):
 *   - WORKER_HTTP_URL     base URL, e.g. http://127.0.0.1:7430 (default)
 *   - WORKER_HTTP_SECRET  shared bearer secret (REQUIRED in prod)
 *
 * Failure modes:
 *   - Network error / timeout                → return ok:false, error:'worker_unreachable'
 *   - Worker returns non-200                 → return ok:false with the worker's message
 *   - Worker returns ok:false                → pass through (auth_failed, permission, …)
 *
 * Design intent: callers (the API route) never throw. Always return a
 * structured result the route can translate into a 400 vs 503.
 */

export type WorkerTestConnectionResult = {
  ok: boolean;
  health?: string;
  permissions?: string[];
  unverified?: string[];
  message?: string | null;
  error?: string;
};

const DEFAULT_WORKER_URL = 'http://127.0.0.1:7430';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * POST a single connection id to the worker's /test-connection endpoint.
 *
 * Returns a structured result; never throws. The route handler decides
 * whether to short-circuit the insert based on the result.
 */
export async function testConnectionViaWorker(
  connectionId: string
): Promise<WorkerTestConnectionResult> {
  const baseUrl = process.env.WORKER_HTTP_URL ?? DEFAULT_WORKER_URL;
  const secret = process.env.WORKER_HTTP_SECRET;

  if (!secret) {
    // In production, refusing to call the worker is safer than calling
    // unauthenticated. Surface a clear error so misconfiguration is loud.
    return {
      ok: false,
      error: 'worker_misconfigured',
      message: 'WORKER_HTTP_SECRET is not set',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/test-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ connection_id: connectionId }),
      signal: controller.signal,
      // Worker runs the same trust boundary as Next.js (single-user, single
      // host); skipping cache is the right default.
      cache: 'no-store',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        error: 'worker_error',
        message: `${resp.status}: ${text.slice(0, 200)}`,
      };
    }

    const body = (await resp.json()) as WorkerTestConnectionResult;
    return body;
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'worker_timeout' : 'worker_unreachable',
      message: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}
