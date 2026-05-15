import { withAuth, parseBody } from '@/lib/api/handler';
import { errors, noContent } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { RejectCandidateBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, RejectCandidateBody);
  const supabase = await createClient();

  const { error } = await supabase
    .from('spread_candidates')
    .update({
      state: 'rejected',
      decided_at: new Date().toISOString(),
      decided_by: userId,
      rejection_reason: body.reason ?? null,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('state', 'pending');

  if (error) return errors.internal(error.message);
  return noContent();
});
