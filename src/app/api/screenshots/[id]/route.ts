/**
 * PATCH  /api/screenshots/[id] — update annotation_state + optional caption.
 * DELETE /api/screenshots/[id] — delete metadata + unlink the file on disk.
 *
 * Both routes enforce per-user ownership via the underlying helper. 404 on
 * miss avoids leaking screenshot existence to non-owners.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import {
  updateScreenshotAnnotation,
  deleteScreenshot,
} from '@/lib/db/satellite';
import { unlinkScreenshot } from '@/lib/upload/screenshots';
import { UpdateScreenshotAnnotationBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const body = await parseBody(req, UpdateScreenshotAnnotationBody);
  const row = await updateScreenshotAnnotation(
    userId,
    id,
    body.annotation_state ?? null,
    body.caption,
  );
  if (!row) return errors.notFound();
  return ok(row);
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const meta = await deleteScreenshot(userId, id);
  if (!meta) return errors.notFound();
  // Best-effort file unlink. If it fails (e.g. file was removed out-of-band)
  // we don't surface an error to the client — the DB row is already gone.
  await unlinkScreenshot(meta.storageKey).catch(() => undefined);
  return noContent();
});
