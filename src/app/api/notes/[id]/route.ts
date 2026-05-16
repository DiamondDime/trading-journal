/**
 * PATCH  /api/notes/[id] — update body with optional version check (409 on conflict).
 * DELETE /api/notes/[id] — hard-delete the note. Returns 204.
 *
 * Cross-route safety: the PATCH path resolves the note's activity_id from
 * the DB first, then calls upsertNote — so a stale client that PATCHes a
 * note whose activity has been deleted hits a 404 from the activity-owner
 * check inside upsertNote.
 */
import { sql } from '@/lib/db/client';
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, errors, noContent } from '@/lib/api/response';
import {
  upsertNote,
  deleteNote,
  NoteVersionConflict,
  NoteOwnershipError,
} from '@/lib/db/notes';
import { UpdateNoteBody } from '@/lib/db/zod-schemas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = withAuth(async (req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();

  const body = await parseBody(req, UpdateNoteBody);

  // Resolve the note's activity_id while enforcing ownership.
  const rows = await sql<{ activityId: string }[]>`
    SELECT activity_id
    FROM public.notes
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) return errors.notFound();

  try {
    const note = await upsertNote(userId, rows[0].activityId, body.body, body.version);
    return ok(note);
  } catch (e) {
    if (e instanceof NoteVersionConflict) {
      return errors.conflict(
        'NOTE_VERSION_CONFLICT',
        'Note was edited elsewhere',
        { current: e.current },
      );
    }
    // Parent activity was soft-deleted (or otherwise vanished) between the
    // ownership probe above and the upsertNote call. Return 404 instead of
    // bubbling up to a 500 — the row genuinely doesn't exist anymore.
    if (e instanceof NoteOwnershipError) {
      return errors.notFound();
    }
    throw e;
  }
});

export const DELETE = withAuth(async (_req, { params, userId }) => {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errors.notFound();
  const ok_ = await deleteNote(userId, id);
  if (!ok_) return errors.notFound();
  return noContent();
});
