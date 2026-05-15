import { withAuth } from '@/lib/api/handler';
import { ok, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') ?? 'pending';
  const minConfidence = Number(url.searchParams.get('min_confidence') ?? '0');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('spread_candidates')
    .select('*')
    .eq('user_id', userId)
    .eq('state', state)
    .gte('match_confidence', minConfidence)
    .order('match_confidence', { ascending: false })
    .limit(limit);

  if (error) return errors.internal(error.message);
  return ok({ items: data ?? [] });
});
