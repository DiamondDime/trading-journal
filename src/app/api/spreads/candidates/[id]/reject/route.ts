import { withAuth, parseBody } from '@/lib/api/handler';
import { noContent } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { RejectCandidateBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, RejectCandidateBody);
  await sql`
    UPDATE public.spread_candidates
    SET state = 'rejected', decided_at = now(), decided_by = ${userId}::uuid,
        rejection_reason = ${body.reason ?? null}
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND state = 'pending'
  `;
  return noContent();
});
