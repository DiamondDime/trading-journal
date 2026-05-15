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

  const inserted = await sql.begin(async (tx) => {
    const spread = await tx`
      INSERT INTO public.spreads (
        user_id, spread_type, status, origin, source, name, primary_base,
        opened_at, match_confidence, leg_count
      ) VALUES (
        ${userId}::uuid, ${spreadType}, 'open', 'auto_matched', 'system',
        ${name}, ${candidate.primaryBase}, ${candidate.earliestFillAt}::timestamptz,
        ${candidate.matchConfidence}, ${candidate.proposedLegs.length}
      )
      RETURNING *
    `;

    for (let i = 0; i < candidate.proposedLegs.length; i++) {
      const leg = candidate.proposedLegs[i];
      for (const positionId of leg.position_ids ?? []) {
        await tx`
          INSERT INTO public.spread_legs (spread_id, user_id, position_id, role, leg_index)
          VALUES (
            ${spread[0].id}::uuid, ${userId}::uuid, ${positionId}::uuid,
            ${leg.side === 'long' ? 'long_leg' : 'short_leg'}, ${i}
          )
        `;
      }
    }

    await tx`
      UPDATE public.spread_candidates
      SET state = 'accepted', decided_at = now(), decided_by = ${userId}::uuid,
          resulting_spread_id = ${spread[0].id}::uuid
      WHERE id = ${id}::uuid
    `;

    return spread[0];
  });

  return created(inserted);
});
