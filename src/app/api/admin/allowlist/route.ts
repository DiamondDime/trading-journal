import { withAdmin, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { AddAllowlistBody } from '@/lib/db/zod-schemas';

export const GET = withAdmin(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('allowlist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return errors.internal(error.message);
  return ok(data ?? []);
});

export const POST = withAdmin(async (req, { userId }) => {
  const body = await parseBody(req, AddAllowlistBody);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('allowlist')
    .insert({
      email: body.email,
      role: body.role,
      notes: body.notes ?? null,
      invited_by: userId,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return errors.conflict('ALREADY_EXISTS', 'Email already on allowlist');
    }
    return errors.internal(error.message);
  }
  return created(data);
});
