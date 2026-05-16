/**
 * POST /api/activities/trade — create a journaled trade activity.
 *
 * Body matches /add/trade/fields form field names (camelCase) — see
 * CreateTradeBody in zod-schemas.ts. Inserts position + activity + activity_trade
 * in a single transaction.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { created } from '@/lib/api/response';
import { createTrade } from '@/lib/db/activity';
import { CreateTradeBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateTradeBody);
  const { id } = await createTrade(userId, body);
  return created({ id });
});
