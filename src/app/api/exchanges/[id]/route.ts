import { withAuth } from '@/lib/api/handler';
import { noContent } from '@/lib/api/response';
import { sql } from '@/lib/db/client';

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  await sql`
    UPDATE public.exchange_connections
    SET deleted_at = now(), status = 'disabled'
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
  `;
  return noContent();
});
