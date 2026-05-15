import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { UpdateSpreadBody } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const supabase = await createClient();

  const [spreadRes, legsRes, fundingRes, notesRes] = await Promise.all([
    supabase.from('spread_pnl').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    supabase
      .from('spread_legs')
      .select('id, position_id, role, leg_index, positions(*)')
      .eq('spread_id', id)
      .order('leg_index'),
    supabase
      .from('funding_events')
      .select('*')
      .eq('user_id', userId),
    supabase.from('notes').select('*').eq('spread_id', id).eq('user_id', userId).maybeSingle(),
  ]);

  if (spreadRes.error) return errors.internal(spreadRes.error.message);
  if (!spreadRes.data) return errors.notFound('Spread not found');

  return ok({
    spread: spreadRes.data,
    legs: legsRes.data ?? [],
    funding_events: fundingRes.data ?? [],
    note: notesRes.data ?? null,
  });
});

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, UpdateSpreadBody);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('spreads')
    .update(body)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) return errors.internal(error.message);
  if (!data) return errors.notFound();
  return ok(data);
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from('spreads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return errors.internal(error.message);
  return noContent();
});
