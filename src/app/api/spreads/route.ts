/**
 * GET  /api/spreads — list user's spreads with filters
 * POST /api/spreads — manual spread creation
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { CreateSpreadBody, ListSpreadsQuery } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const q = ListSpreadsQuery.parse(Object.fromEntries(url.searchParams));

  const status = q.status ? q.status.split(',') : null;
  const types = q.spread_type ? q.spread_type.split(',') : null;
  const sortField = q.sort_field; // already validated by zod
  const sortDir = q.sort_dir;

  const rows = await sql`
    SELECT * FROM public.spread_pnl
    WHERE user_id = ${userId}::uuid
      ${status ? sql`AND status = ANY(${status}::text[])` : sql``}
      ${types ? sql`AND spread_type = ANY(${types}::text[])` : sql``}
      ${q.opened_after ? sql`AND opened_at >= ${q.opened_after}::timestamptz` : sql``}
      ${q.opened_before ? sql`AND opened_at <= ${q.opened_before}::timestamptz` : sql``}
      ${q.search ? sql`AND name ILIKE ${'%' + q.search + '%'}` : sql``}
    ORDER BY ${sql(sortField)} ${sortDir === 'asc' ? sql`ASC` : sql`DESC`} NULLS LAST
    LIMIT ${q.limit}
  `;
  return ok({ items: rows, next_cursor: null });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateSpreadBody);
  const allPositionIds = body.legs.flatMap((l) => l.position_ids);

  const existing = await sql<{ positionId: string }[]>`
    SELECT position_id FROM public.spread_legs
    WHERE position_id = ANY(${allPositionIds}::uuid[])
  `;
  if (existing.length > 0) {
    return errors.unprocessable(
      'FILLS_ALREADY_MATCHED',
      'Some positions are already part of another spread',
      { claimed_position_ids: existing.map((r) => r.positionId) }
    );
  }

  const positions = await sql<
    { id: string; instrument: { base: string }; openedAt: string }[]
  >`
    SELECT id, instrument, opened_at FROM public.positions
    WHERE id = ANY(${allPositionIds}::uuid[]) AND user_id = ${userId}::uuid
  `;
  if (positions.length !== allPositionIds.length) {
    return errors.unprocessable(
      'INVALID_LEG_COMPOSITION',
      'Some position IDs not found or not owned'
    );
  }

  const earliestOpened = positions
    .map((p) => p.openedAt)
    .sort()[0];
  const primary_base = positions[0].instrument.base;

  const spreads = await sql`
    INSERT INTO public.spreads (
      user_id, spread_type, variant, status, origin, source, name, primary_base,
      opened_at, capital_deployed_usd,
      regime_tags, custom_tags, leg_count,
      target_apr_at_open, expected_holding_days, expected_basis_convergence_date,
      exit_plan, borrow_cost_assumed_bps,
      close_threshold_apr, close_threshold_periods,
      max_gas_budget_usd, slippage_tolerance_bps
    ) VALUES (
      ${userId}::uuid, ${body.spread_type}, ${body.variant ?? null},
      'open', 'manual', 'user',
      ${body.name ?? `Manual ${body.spread_type} — ${primary_base}`},
      ${primary_base}, ${earliestOpened}::timestamptz,
      ${body.capital_deployed_usd ?? null},
      ${body.regime_tags ?? []}, ${body.custom_tags ?? []}, ${body.legs.length},
      ${body.target_apr_at_open ?? null},
      ${body.expected_holding_days ?? null},
      ${body.expected_basis_convergence_date ?? null}::date,
      ${body.exit_plan ?? null},
      ${body.borrow_cost_assumed_bps ?? null},
      ${body.close_threshold_apr ?? null},
      ${body.close_threshold_periods ?? null},
      ${body.max_gas_budget_usd ?? null},
      ${body.slippage_tolerance_bps ?? null}
    )
    RETURNING *
  `;
  const spreadId = spreads[0].id;

  for (let i = 0; i < body.legs.length; i++) {
    const leg = body.legs[i];
    for (const positionId of leg.position_ids) {
      await sql`
        INSERT INTO public.spread_legs (
          spread_id, user_id, position_id, role, leg_index,
          intended_price, intended_price_set_at
        )
        VALUES (
          ${spreadId}::uuid, ${userId}::uuid, ${positionId}::uuid, ${leg.role}, ${i},
          ${leg.intended_price ?? null},
          ${leg.intended_price ? sql`now()` : null}
        )
      `;
    }
  }

  return created(spreads[0]);
});
