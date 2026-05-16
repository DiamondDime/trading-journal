/**
 * GET  /api/notes?activity_id=<uuid> — fetch the (one) note for an activity.
 *                                      Returns { data: NoteRow | null }.
 * POST /api/notes                    — upsert: create if none, otherwise update.
 *                                      Returns { data: NoteRow }; 201 on first create.
 *
 * The PATCH/DELETE-by-id paths live at /api/notes/[id]. POST here is the
 * upsert front door used by the editor's autosave.
 */
import { withAuth, parseBody } from '@/lib/api/handler';
import { ok, created, errors } from '@/lib/api/response';
import {
  getNoteForActivity,
  upsertNote,
  NoteVersionConflict,
  NoteOwnershipError,
} from '@/lib/db/notes';
import { CreateNoteBody, ListNotesQuery } from '@/lib/db/zod-schemas';

export const GET = withAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const parsed = ListNotesQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errors.badRequest('VALIDATION', 'Invalid query', parsed.error.issues);
  }
  const note = await getNoteForActivity(userId, parsed.data.activity_id);
  return ok(note);
});

export const POST = withAuth(async (req, { userId }) => {
  const body = await parseBody(req, CreateNoteBody);
  // Did the row exist already? If so the response is 200 (update); a fresh
  // insert is 201. The editor only cares about the row content; the HTTP
  // status differentiation is for API consumers / curl walkthroughs.
  const existing = await getNoteForActivity(userId, body.activity_id);
  try {
    const note = await upsertNote(userId, body.activity_id, body.body);
    return existing ? ok(note) : created(note);
  } catch (e) {
    if (e instanceof NoteVersionConflict) {
      return errors.conflict(
        'NOTE_VERSION_CONFLICT',
        'Note was edited elsewhere',
        { current: e.current },
      );
    }
    if (e instanceof NoteOwnershipError) {
      return errors.notFound();
    }
    throw e;
  }
});
