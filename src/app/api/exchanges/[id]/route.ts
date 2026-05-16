import { withAuth } from '@/lib/api/handler';
import { errors, noContent } from '@/lib/api/response';
import { sql } from '@/lib/db/client';

// Mirror the UUID guard pattern from src/lib/db/activity.ts so non-UUID inputs
// route to 404 cleanly instead of tripping postgres's uuid parser at the
// boundary and surfacing as a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  await sql`
    UPDATE public.exchange_connections
    SET deleted_at = now(), status = 'disabled'
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
  `;
  return noContent();
});
