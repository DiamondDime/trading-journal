/**
 * POST /api/exchanges/:id/sync — enqueue a sync job for the worker to pick up.
 */
import { withAuth } from '@/lib/api/handler';
import { ok, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';

export const POST = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const supabase = await createClient();

  // Reject if an active sync job exists
  const { data: active } = await supabase
    .from('sync_jobs')
    .select('id')
    .eq('exchange_connection_id', id)
    .eq('user_id', userId)
    .in('state', ['queued', 'running'])
    .limit(1)
    .maybeSingle();

  if (active) {
    return errors.conflict('SYNC_IN_FLIGHT', 'A sync is already running for this connection', {
      sync_job_id: active.id,
    });
  }

  const { data: job, error } = await supabase
    .from('sync_jobs')
    .insert({
      user_id: userId,
      exchange_connection_id: id,
      state: 'queued',
    })
    .select('id, state, created_at')
    .single();

  if (error) return errors.internal(error.message);
  return ok({ sync_job_id: job.id }, { status: 202 });
});

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from('sync_jobs')
    .select('*')
    .eq('exchange_connection_id', id)
    .eq('user_id', userId)
    .in('state', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recent } = await supabase
    .from('sync_jobs')
    .select('*')
    .eq('exchange_connection_id', id)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  return ok({ current_job: current, recent_jobs: recent ?? [] });
});
