/**
 * POST /api/activities/airdrop — create a journaled airdrop activity.
 *
 * Body matches /add/airdrop/fields form field names — see CreateAirdropBody.
 * Cost basis is $0 by definition; realized_pnl_usd is the USD value captured
 * at the time of claim (income event), net_pnl_usd is MTM today.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { created } from '@/lib/api/response';
import { createAirdrop } from '@/lib/db/activity';
import { CreateAirdropBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateAirdropBody);
  const { id } = await createAirdrop(userId, body);
  return created({ id });
});
