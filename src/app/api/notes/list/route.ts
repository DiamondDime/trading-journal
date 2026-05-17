/**
 * GET /api/notes/list — paginated list of every note across activities.
 *
 * Drives the /notes "load more" pagination — the page's initial render
 * already SSRs the first page, so this is only called after the first user
 * interaction. Query shape mirrors the NoteListFilters interface.
 *
 *   ?type=spread,trade        - activity-type subset (comma-separated)
 *   ?tag=swing                - single free-form tag (v1)
 *   ?q=ETF                    - ILIKE on body
 *   ?sort=newest|oldest|longest|edited
 *   ?limit=20&offset=20
 */
import { z } from 'zod';
import { withAuth } from '@/lib/api/handler';
import { ok, errors } from '@/lib/api/response';
import { listAllNotes, countAllNotes, type NoteListFilters } from '@/lib/db/notes';

const ListNotesQuery = z.object({
  type: z.string().optional(),
  tag: z.string().max(60).optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['newest', 'oldest', 'longest', 'edited']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const parsed = ListNotesQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errors.badRequest('VALIDATION', 'Invalid query', parsed.error.issues);
  }
  const { type, tag, q, sort, limit, offset } = parsed.data;

  const valid = new Set(['spread', 'trade', 'sale', 'airdrop'] as const);
  const parsedTypes =
    typeof type === 'string'
      ? (type
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is 'spread' | 'trade' | 'sale' | 'airdrop' =>
            valid.has(s as 'spread' | 'trade' | 'sale' | 'airdrop'),
          ))
      : undefined;

  const filters: NoteListFilters = {
    activityType: parsedTypes && parsedTypes.length > 0 ? parsedTypes : undefined,
    tag: tag && tag.length > 0 ? tag : undefined,
    search: q && q.length > 0 ? q : undefined,
    sort,
    limit,
    offset,
  };

  const [rows, total] = await Promise.all([
    listAllNotes(userId, filters),
    countAllNotes(userId, {
      activityType: filters.activityType,
      tag: filters.tag,
      search: filters.search,
    }),
  ]);

  return ok({ rows, total, limit, offset });
});
