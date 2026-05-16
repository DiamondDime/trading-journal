/**
 * Accept a matcher-proposed spread candidate: creates a Spread + SpreadLegs atomically.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { created, errors } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import { AcceptCandidateBody } from '@/lib/db/zod-schemas';

type CandidateRow = {
  id: string;
  state: string;
  suggestedType: string;
  primaryBase: string;
  earliestFillAt: string;
  matchConfidence: string;
  proposedLegs: Array<{ side: 'long' | 'short'; position_ids?: string[] }>;
};

export const POST = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, AcceptCandidateBody);

  const candidates = await sql<CandidateRow[]>`
    SELECT * FROM public.spread_candidates
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
  `;
  const candidate = candidates[0];
  if (!candidate) return errors.notFound('Candidate not found');
  if (candidate.state !== 'pending') {
    return errors.conflict('ALREADY_DECIDED', `Candidate is ${candidate.state}`);
  }

  const name =
    body.overrides?.name ??
    `${candidate.suggestedType} — ${candidate.primaryBase}`;
  const spreadType = body.overrides?.spread_type ?? candidate.suggestedType;

  const activityId = await sql.begin(async (tx) => {
    const [activityRow] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at
      ) VALUES (
        ${userId}::uuid, 'spread', 'open',
        ${name}, ${candidate.earliestFillAt}::timestamptz
      )
      RETURNING id
    `;

    await tx`
      INSERT INTO public.activity_spread (
        activity_id, spread_type, origin, source, primary_base,
        match_confidence, leg_count
      ) VALUES (
        ${activityRow.id}::uuid, ${spreadType}, 'auto_matched', 'system',
        ${candidate.primaryBase}, ${candidate.matchConfidence}, ${candidate.proposedLegs.length}
      )
    `;

    for (let i = 0; i < candidate.proposedLegs.length; i++) {
      const leg = candidate.proposedLegs[i];
      for (const positionId of leg.position_ids ?? []) {
        await tx`
          INSERT INTO public.spread_legs (activity_id, user_id, position_id, role, leg_index)
          VALUES (
            ${activityRow.id}::uuid, ${userId}::uuid, ${positionId}::uuid,
            ${leg.side === 'long' ? 'long_leg' : 'short_leg'}, ${i}
          )
        `;
      }
    }

    await tx`
      UPDATE public.spread_candidates
      SET state = 'accepted', decided_at = now(), decided_by = ${userId}::uuid,
          resulting_activity_id = ${activityRow.id}::uuid
      WHERE id = ${id}::uuid
    `;

    return activityRow.id;
  });

  // Read back through the view so the response matches GET shape.
  const [pnlRow] = await sql`
    SELECT * FROM public.spread_pnl
    WHERE spread_id = ${activityId}::uuid AND user_id = ${userId}::uuid
    LIMIT 1
  `;
  return created(pnlRow);
});
