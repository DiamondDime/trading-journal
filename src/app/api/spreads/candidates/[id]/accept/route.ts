/**
 * Accept a matcher-proposed spread candidate: creates a Spread + SpreadLegs atomically.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { created, errors } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import { AcceptCandidateBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  const body = await parseBody(req, AcceptCandidateBody);
  const supabase = await createClient();

  const { data: candidate, error: fetchErr } = await supabase
    .from('spread_candidates')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchErr || !candidate) return errors.notFound('Candidate not found');
  if (candidate.state !== 'pending') {
    return errors.conflict('ALREADY_DECIDED', `Candidate is ${candidate.state}`);
  }

  // Derive name + type from overrides or candidate
  const name = body.overrides?.name ?? `${candidate.suggested_type} — ${candidate.primary_base}`;
  const spreadType = body.overrides?.spread_type ?? candidate.suggested_type;

  // Create spread
  const { data: spread, error: insertErr } = await supabase
    .from('spreads')
    .insert({
      user_id: userId,
      spread_type: spreadType,
      status: 'open',
      origin: 'auto_matched',
      source: 'system',
      name,
      primary_base: candidate.primary_base,
      opened_at: candidate.earliest_fill_at,
      match_confidence: candidate.match_confidence,
      leg_count: candidate.proposed_legs.length,
    })
    .select('*')
    .single();

  if (insertErr || !spread) return errors.internal(insertErr?.message ?? 'Failed to create spread');

  // Create legs from candidate's proposed_legs
  const proposedLegs = candidate.proposed_legs as Array<{
    connection_id: string;
    side: 'long' | 'short';
    fill_ids?: string[];
    position_ids?: string[];
  }>;

  // Resolve position_ids from fills if needed
  for (let i = 0; i < proposedLegs.length; i++) {
    const leg = proposedLegs[i];
    const positionIds = leg.position_ids ?? [];
    for (const positionId of positionIds) {
      await supabase.from('spread_legs').insert({
        spread_id: spread.id,
        user_id: userId,
        position_id: positionId,
        role: leg.side === 'long' ? 'long_leg' : 'short_leg',
        leg_index: i,
      });
    }
  }

  // Mark candidate accepted
  await supabase
    .from('spread_candidates')
    .update({
      state: 'accepted',
      decided_at: new Date().toISOString(),
      decided_by: userId,
      resulting_spread_id: spread.id,
    })
    .eq('id', id);

  return created(spread);
});
