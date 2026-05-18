/**
 * GET  /api/events?kind=<kind>&limit=<n>&offset=<n> — list event_log rows
 *                                                    for the authed user.
 * POST /api/events                                  — create one event_log row.
 *
 * event_log lives outside the activity supertype — these routes are
 * intentionally separate from /api/activities/* and never join through
 * v_activity_feed.
 */
import type { MovementEventKind } from '@/types/canonical';
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created } from '@/lib/api/response';
import { listEvents, createEventLog } from '@/lib/db/events';
import { CreateEventLogBody } from '@/lib/db/zod-schemas';

const VALID_KINDS = new Set<MovementEventKind>([
  'bridge',
  'convert',
  'transfer',
  'deposit',
  'withdrawal',
  'nft_trade',
  'loss',
  'other',
]);

function parseKinds(raw: string | null): MovementEventKind[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MovementEventKind =>
      VALID_KINDS.has(s as MovementEventKind),
    );
  return parts.length > 0 ? parts : undefined;
}

function parseInt0(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const events = await listEvents(userId, {
    kind:   parseKinds(url.searchParams.get('kind')),
    limit:  parseInt0(url.searchParams.get('limit'),  50, 200),
    offset: parseInt0(url.searchParams.get('offset'),  0, 100_000),
  });
  return ok(events);
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateEventLogBody);
  const { id } = await createEventLog(userId, body);
  return created({ id });
});
