import { withAuth } from '@/lib/api/handler';
import { errors, noContent } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from('exchange_connections')
    .update({ deleted_at: new Date().toISOString(), status: 'disabled' })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return errors.internal(error.message);
  return noContent();
});
