/**
 * POST /api/activities/sale — create a journaled token-sale activity.
 *
 * Body matches /add/sale/fields form field names — see CreateSaleBody.
 * Stores activity + activity_sale (jsonb vesting_schedule built from cliff
 * + linear vesting inputs).
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { created } from '@/lib/api/response';
import { createSale } from '@/lib/db/activity';
import { CreateSaleBody } from '@/lib/db/zod-schemas';

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateSaleBody);
  const { id } = await createSale(userId, body);
  return created({ id });
});
