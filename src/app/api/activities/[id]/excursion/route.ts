/**
 * GET    /api/activities/[id]/excursion  — fetch the (one) excursion row.
 * PUT    /api/activities/[id]/excursion  — upsert with patch semantics.
 * DELETE /api/activities/[id]/excursion  — wipe it.
 *
 * 404 on miss / not-owned. The PUT body validates each field independently
 * so partial updates work; omitted fields preserve their current value on
 * update and default to NULL on first insert.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent, created } from '@/lib/api/response';
import {
  getExcursionForActivity,
  upsertExcursion,
  deleteExcursion,
  SatelliteOwnershipError,
} from '@/lib/db/satellite';
import { UpsertExcursionBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const row = await getExcursionForActivity(userId, id);
  return ok(row);
});

export const PUT = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const body = await parseBody(req, UpsertExcursionBody);

  // 201 on first write, 200 on subsequent updates — mirrors notes upsert.
  const before = await getExcursionForActivity(userId, id);
  try {
    const row = await upsertExcursion(userId, id, {
      stopLossPrice: body.stop_loss_price ?? undefined,
      maePrice:      body.mae_price ?? undefined,
      mfePrice:      body.mfe_price ?? undefined,
      maeAt:         body.mae_at ?? undefined,
      mfeAt:         body.mfe_at ?? undefined,
      source:        body.source,
      backfilledAt:  body.backfilled_at ?? undefined,
    });
    return before ? ok(row) : created(row);
  } catch (e) {
    if (e instanceof SatelliteOwnershipError) return errors.notFound();
    throw e;
  }
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const wasDeleted = await deleteExcursion(userId, id);
  if (!wasDeleted) return errors.notFound();
  return noContent();
});
