/**
 * GET /api/screenshots/[id]/file — stream the screenshot bytes.
 *
 * Ownership is enforced through getScreenshot which joins back to activity
 * (so soft-deleted parents hide their screenshots from this endpoint, and
 * the file remains on disk only as housekeeping cron fodder).
 *
 * The Content-Type is derived from the file extension on disk, NOT from any
 * client-supplied value. The extension was set at upload time by the magic-
 * byte sniffer, so it's trustworthy.
 */
import { withAuth } from '@/lib/api/handler';
import { errors } from '@/lib/api/response';
import { getScreenshot } from '@/lib/db/satellite';
import { readScreenshot, InvalidPathError } from '@/lib/upload/screenshots';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const row = await getScreenshot(userId, id);
  if (!row) return errors.notFound();

  try {
    const { bytes, mime } = await readScreenshot(row.storageKey);
    // Returns an immutable response — screenshot bytes never change after
    // upload (annotations live in annotation_state JSONB; the underlying
    // image is preserved). max-age=31536000 + immutable lets browsers cache
    // aggressively without revalidation.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': mime,
        'cache-control': 'private, max-age=31536000, immutable',
        'content-length': String(bytes.length),
      },
    });
  } catch (e) {
    if (e instanceof InvalidPathError) return errors.notFound();
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return errors.notFound();
    throw e;
  }
});
