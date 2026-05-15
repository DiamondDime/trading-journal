import { withAdmin } from '@/lib/api/handler';
import { noContent } from '@/lib/api/response';
import { sql } from '@/lib/db/client';

export const DELETE = withAdmin(async (_req, { params }) => {
  const { email } = await params;
  await sql`DELETE FROM public.allowlist WHERE email = ${email}`;
  return noContent();
});
