/**
 * GET    /api/events/[id]  — fetch a single event_log row.
 * PATCH  /api/events/[id]  — update fields (partial; any combination of
 *                             columns from CreateEventLogBody).
 * DELETE /api/events/[id]  — hard-delete the row. Returns 204.
 *
 * event_log isn't soft-deletable in the v5 schema — these are accounting
 * journal entries; if the trader meant to write a different one they
 * delete and re-create. The hard delete keeps the table tidy for tax-
 * report exports.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import { getEvent, updateEventLog, deleteEventLog } from '@/lib/db/events';
import { UpdateEventLogBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  const row = await getEvent(userId, id);
  if (!row) return errors.notFound();
  return ok(row);
});

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  const body = await parseBody(req, UpdateEventLogBody);
  const ok_ = await updateEventLog(userId, id, body);
  if (!ok_) return errors.notFound();

  const row = await getEvent(userId, id);
  if (!row) return errors.notFound();
  return ok(row);
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  const removed = await deleteEventLog(userId, id);
  if (!removed) return errors.notFound();
  return noContent();
});
