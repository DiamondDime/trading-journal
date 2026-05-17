/**
 * GET  /api/activities/[id]/screenshots — list metadata for all screenshots on
 *                                         the activity. Bytes NOT included.
 * POST /api/activities/[id]/screenshots — multipart upload. Accepts:
 *                                           - file:    the image bytes
 *                                           - side:    'entry' | 'exit' | 'context'
 *                                           - caption: optional, <= 1000 chars
 *
 * Security path (full notes in src/lib/upload/screenshots.ts):
 *   - Verify activity ownership BEFORE buffering the upload so an attacker
 *     can't trigger disk allocation against an activity they don't own.
 *   - 10MB hard cap enforced via the streamed File.size before reading the
 *     bytes into memory (request-body-too-large → 413).
 *   - File extension is derived from a magic-byte sniff, NOT the Content-Type
 *     header. PNG / JPEG / WebP only; anything else → 415.
 *   - The on-disk path is built entirely from server-validated UUIDs + a
 *     server-generated UUID for the filename. The route never reads any path
 *     component from user-controlled input.
 *
 * Response on success: 201 with { id, storage_key, original_width, original_height }.
 */
import { withAuth } from '@/lib/api/handler';
import { ok, errors, created } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import {
  createScreenshot,
  listScreenshotsForActivity,
  SatelliteOwnershipError,
  type ScreenshotSide,
} from '@/lib/db/satellite';
import {
  persistScreenshot,
  MAX_SCREENSHOT_BYTES,
  UnsupportedImageError,
  TooLargeError,
} from '@/lib/upload/screenshots';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_SIDES: ScreenshotSide[] = ['entry', 'exit', 'context'];

export const GET = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const rows = await listScreenshotsForActivity(userId, id);
  return ok({ screenshots: rows });
});

export const POST = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  // Verify ownership early — saves us from buffering a 10MB upload for a
  // request that's going to 404 anyway, and gives us defence-in-depth against
  // path-traversal via spoofed UUID (assertActivityOwner runs again inside
  // createScreenshot but layered checks are cheap).
  const owner = await sql<{ id: string }[]>`
    SELECT id FROM public.activity
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (owner.length === 0) return errors.notFound();

  // Parse multipart.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errors.badRequest('VALIDATION', 'Expected multipart/form-data with a `file` part');
  }

  const file = form.get('file');
  const sideRaw = form.get('side');
  const captionRaw = form.get('caption');

  if (!(file instanceof File)) {
    return errors.badRequest('VALIDATION', 'Missing or invalid `file` field');
  }

  const side = typeof sideRaw === 'string' ? sideRaw : '';
  if (!ALLOWED_SIDES.includes(side as ScreenshotSide)) {
    return errors.badRequest(
      'VALIDATION',
      `side must be one of: ${ALLOWED_SIDES.join(', ')}`,
    );
  }

  const caption =
    typeof captionRaw === 'string' && captionRaw.length > 0 ? captionRaw : null;
  if (caption !== null && caption.length > 1000) {
    return errors.badRequest('VALIDATION', 'caption exceeds 1000 chars');
  }

  // Size check on the metadata BEFORE buffering. File.size in Web Fetch's
  // FormData is the byte length of the part.
  if (file.size <= 0) {
    return errors.badRequest('VALIDATION', 'Empty file');
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return errors.unprocessable(
      'FILE_TOO_LARGE',
      `File exceeds ${MAX_SCREENSHOT_BYTES} bytes`,
    );
  }

  // Buffer + persist. arrayBuffer() handles up to ~1GB safely; 10MB is fine.
  const ab = await file.arrayBuffer();
  const bytes = Buffer.from(ab);

  let saved: Awaited<ReturnType<typeof persistScreenshot>>;
  try {
    saved = await persistScreenshot(userId, id, bytes);
  } catch (e) {
    if (e instanceof TooLargeError) {
      return errors.unprocessable('FILE_TOO_LARGE', e.message);
    }
    if (e instanceof UnsupportedImageError) {
      // 415 Unsupported Media Type semantically matches "we got a file but
      // it isn't a supported image format". We don't have a helper for 415
      // in errors so reuse unprocessable (422) — same client behaviour.
      return errors.unprocessable('UNSUPPORTED_IMAGE', e.message);
    }
    throw e;
  }

  try {
    const row = await createScreenshot(userId, id, {
      side: side as ScreenshotSide,
      storageKey: saved.storageKey,
      originalWidth: saved.width,
      originalHeight: saved.height,
      caption,
    });
    return created({
      id: row.id,
      storage_key: row.storageKey,
      original_width: row.originalWidth,
      original_height: row.originalHeight,
      side: row.side,
      caption: row.caption,
    });
  } catch (e) {
    // Activity vanished between the owner check above and the DB insert.
    // The bytes are on disk — try to clean up.
    if (e instanceof SatelliteOwnershipError) {
      const { unlinkScreenshot } = await import('@/lib/upload/screenshots');
      await unlinkScreenshot(saved.storageKey).catch(() => undefined);
      return errors.notFound();
    }
    throw e;
  }
});

