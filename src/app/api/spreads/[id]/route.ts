import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { UpdateSpreadBody } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;

  const [spreadRows, legs, funding, notes] = await Promise.all([
    sql`SELECT * FROM public.spread_pnl WHERE spread_id = ${id}::uuid AND user_id = ${userId}::uuid LIMIT 1`,
    sql`
      SELECT sl.id, sl.position_id, sl.role, sl.leg_index,
             p.* AS position
      FROM public.spread_legs sl
      JOIN public.positions p ON p.id = sl.position_id
      WHERE sl.spread_id = ${id}::uuid
      ORDER BY sl.leg_index
    `,
    sql`
      SELECT fe.* FROM public.funding_events fe
      JOIN public.spread_legs sl ON sl.position_id = fe.position_id
      WHERE sl.spread_id = ${id}::uuid
      ORDER BY fe.event_time ASC
    `,
    sql`SELECT * FROM public.notes WHERE spread_id = ${id}::uuid AND user_id = ${userId}::uuid LIMIT 1`,
  ]);

  if (!spreadRows[0]) return errors.notFound('Spread not found');

  return ok({
    spread: spreadRows[0],
    legs,
    funding_events: funding,
    note: notes[0] ?? null,
  });
});

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, UpdateSpreadBody);

  const rows = await sql`
    UPDATE public.spreads
    SET ${sql({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.regime_tags !== undefined && { regime_tags: body.regime_tags }),
      ...(body.custom_tags !== undefined && { custom_tags: body.custom_tags }),
    })}
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    RETURNING *
  `;
  if (!rows[0]) return errors.notFound();
  return ok(rows[0]);
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  await sql`
    UPDATE public.spreads SET deleted_at = now()
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
  `;
  return noContent();
});
