/**
 * GET  /api/spreads — list user's spreads with filters
 * POST /api/spreads — manual spread creation from selected fills/positions
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { CreateSpreadBody, ListSpreadsQuery } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const q = ListSpreadsQuery.parse(Object.fromEntries(url.searchParams));

  const supabase = await createClient();
  let query = supabase
    .from('spread_pnl')
    .select('*')
    .eq('user_id', userId);

  if (q.status) {
    const statuses = q.status.split(',');
    query = query.in('status', statuses);
  }
  if (q.spread_type) {
    const types = q.spread_type.split(',');
    query = query.in('spread_type', types);
  }
  if (q.opened_after) query = query.gte('opened_at', q.opened_after);
  if (q.opened_before) query = query.lte('opened_at', q.opened_before);
  if (q.search) query = query.ilike('name', `%${q.search}%`);

  query = query.order(q.sort_field, { ascending: q.sort_dir === 'asc' });
  query = query.limit(q.limit);

  const { data, error } = await query;
  if (error) return errors.internal(error.message);
  return ok({ items: data ?? [], next_cursor: null });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateSpreadBody);
  const supabase = await createClient();

  // Validate all position_ids belong to user and are not already in a spread
  const allPositionIds = body.legs.flatMap((l) => l.position_ids);
  const { data: existingLegs } = await supabase
    .from('spread_legs')
    .select('position_id')
    .in('position_id', allPositionIds);

  if (existingLegs && existingLegs.length > 0) {
    const claimedIds = existingLegs.map((l) => l.position_id);
    return errors.unprocessable(
      'FILLS_ALREADY_MATCHED',
      'Some positions are already part of another spread',
      { claimed_position_ids: claimedIds }
    );
  }

  // Fetch positions to derive primary_base + exchanges
  const { data: positions } = await supabase
    .from('positions')
    .select('id, instrument, exchange_connection_id, opened_at')
    .in('id', allPositionIds)
    .eq('user_id', userId);

  if (!positions || positions.length !== allPositionIds.length) {
    return errors.unprocessable('INVALID_LEG_COMPOSITION', 'Some position IDs not found or not owned');
  }

  // Derive metadata
  const positionsByLeg = body.legs.map((leg) => ({
    leg,
    positions: positions.filter((p) => leg.position_ids.includes(p.id)),
  }));

  const earliestOpened = positions
    .map((p) => p.opened_at)
    .sort()[0];
  const primary_base = (positions[0].instrument as { base: string }).base;

  // Insert spread
  const { data: spread, error: spreadErr } = await supabase
    .from('spreads')
    .insert({
      user_id: userId,
      spread_type: body.spread_type,
      status: 'open',
      origin: 'manual',
      source: 'user',
      name: body.name ?? `Manual ${body.spread_type} — ${primary_base}`,
      primary_base,
      opened_at: earliestOpened,
      capital_deployed_usd: body.capital_deployed_usd ?? null,
      custom_tags: body.custom_tags ?? [],
      leg_count: body.legs.length,
    })
    .select('*')
    .single();

  if (spreadErr) return errors.internal(spreadErr.message);

  // Insert spread_legs
  const legRows = body.legs.map((leg, idx) =>
    leg.position_ids.map((position_id) => ({
      spread_id: spread.id,
      user_id: userId,
      position_id,
      role: leg.role,
      leg_index: idx,
    }))
  ).flat();

  const { error: legsErr } = await supabase.from('spread_legs').insert(legRows);
  if (legsErr) {
    await supabase.from('spreads').delete().eq('id', spread.id);
    return errors.internal(legsErr.message);
  }

  return created(spread);
});
