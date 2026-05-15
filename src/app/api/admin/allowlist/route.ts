import { withAdmin, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { AddAllowlistBody } from '@/lib/db/zod-schemas';

export const GET = withAdmin(async () => {
  const rows = await sql`SELECT * FROM public.allowlist ORDER BY created_at DESC`;
  return ok(rows);
});

export const POST = withAdmin(async (req, { userId }) => {
  const body = await parseBody(req, AddAllowlistBody);
  try {
    const rows = await sql`
      INSERT INTO public.allowlist (email, role, notes, invited_by)
      VALUES (${body.email}, ${body.role}, ${body.notes ?? null}, ${userId}::uuid)
      RETURNING *
    `;
    return created(rows[0]);
  } catch (e) {
    if ((e as Error).message?.includes('allowlist_email_key')) {
      return errors.conflict('ALREADY_EXISTS', 'Email already on allowlist');
    }
    throw e;
  }
});
