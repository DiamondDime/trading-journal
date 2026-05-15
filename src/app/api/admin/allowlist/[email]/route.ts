import { withAdmin } from '@/lib/api/handler';
import { noContent, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';

export const DELETE = withAdmin(async (_req, { params }) => {
  const { email } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from('allowlist').delete().eq('email', email);
  if (error) return errors.internal(error.message);
  return noContent();
});
