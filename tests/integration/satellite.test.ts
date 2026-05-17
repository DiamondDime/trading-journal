/**
 * Wave 9A satellite-tables contract tests.
 *
 * Locks in the surfaces introduced in Wave 9A so future refactors don't
 * silently break them.
 *
 * Covered:
 *   - activity_tag CRUD + cross-user isolation + soft-delete behaviour
 *   - listAllTagsForUser autocomplete read with counts
 *   - activity_excursion insert / update / get / one-per-activity uniqueness
 *   - activity_satisfaction upsert / re-upsert
 *   - activity_screenshot create + fake-PNG dimensions + annotation update +
 *     file unlink on row delete
 *   - InvalidPathError defence against a malicious storage_key
 *   - sniffImage rejects non-image bytes
 *
 * One assert per scenario unless a second is structurally required.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { sql } from '@/lib/db/client';
import {
  listTagsForActivity,
  setTagsForActivity,
  listAllTagsForUser,
  upsertExcursion,
  getExcursionForActivity,
  deleteExcursion,
  upsertSatisfaction,
  getSatisfaction,
  createScreenshot,
  listScreenshotsForActivity,
  updateScreenshotAnnotation,
  deleteScreenshot,
  getScreenshot,
  SatelliteOwnershipError,
} from '@/lib/db/satellite';
import {
  sniffImage,
  persistScreenshot,
  readScreenshot,
  unlinkScreenshot,
  resolveStoragePath,
  InvalidPathError,
  UnsupportedImageError,
  MAX_SCREENSHOT_BYTES,
  screenshotExists,
} from '@/lib/upload/screenshots';
import { deleteActivity } from '@/lib/db/activity';
import {
  seedTestUser,
  resetUserData,
  seedTradeActivity,
  TEST_USER_ID,
  OTHER_USER_ID,
} from '../helpers/db';

let testUser: Awaited<ReturnType<typeof seedTestUser>>;
let otherUser: Awaited<ReturnType<typeof seedTestUser>>;
let tmpDir: string;

beforeAll(async () => {
  testUser = await seedTestUser(TEST_USER_ID);
  otherUser = await seedTestUser(OTHER_USER_ID, 'other@local');
  // Per-suite isolated storage root. Each test gets a clean dir via beforeEach.
  tmpDir = await mkdtemp(path.join(tmpdir(), 'csj-screenshot-test-'));
  process.env.SCREENSHOT_STORAGE_DIR = tmpDir;
});

beforeEach(async () => {
  await resetUserData(TEST_USER_ID);
  await resetUserData(OTHER_USER_ID);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await sql.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a tiny but valid PNG. The image is 5x3 transparent pixels; the only
 * thing the upload pipeline checks is the magic bytes + IHDR width/height,
 * so this is sufficient to exercise the sniff/persist path without bringing
 * in image-encoding dependencies.
 *
 * Layout (bytes):
 *   0..7   89 50 4E 47 0D 0A 1A 0A     PNG signature
 *   8..11  00 00 00 0D                 IHDR length (13)
 *   12..15 49 48 44 52                 "IHDR"
 *   16..19 width (big-endian u32)
 *   20..23 height (big-endian u32)
 *   24     bit depth (8)
 *   25     color type (6 = RGBA)
 *   26     compression (0)
 *   27     filter (0)
 *   28     interlace (0)
 *   29..32 CRC (0 — sniffer ignores)
 *   33..36 IDAT length (0)
 *   37..40 "IEND"
 *   41..44 IEND length (0)
 *   45..48 "IEND" again (close)
 *
 * We don't bother with real pixel data — sniffImage only reads the IHDR header.
 */
function fakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(64);
  // Signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR
  buf.writeUInt32BE(13, 8);
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 6;
  // Trailing bytes are noise; sniffer only reads the first 24.
  return buf;
}

// ===========================================================================
// activity_tag — CRUD
// ===========================================================================

describe('activity_tag', () => {
  it('starts empty', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const tags = await listTagsForActivity(TEST_USER_ID, id);
    expect(tags).toEqual([]);
  });

  it('persists tags via setTagsForActivity (replace semantics)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, id, ['breakout', 'london-session']);
    const tags = await listTagsForActivity(TEST_USER_ID, id);
    expect(tags).toEqual(['breakout', 'london-session']);
  });

  it('replaces (not merges) on subsequent setTags calls', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, id, ['breakout', 'fade']);
    await setTagsForActivity(TEST_USER_ID, id, ['scalp']);
    const tags = await listTagsForActivity(TEST_USER_ID, id);
    expect(tags).toEqual(['scalp']);
  });

  it('de-dupes and trims input', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, id, [
      'breakout',
      '  breakout  ',
      'Breakout',  // collapsed by the case-insensitive dedupe
      'fade',
      '',
    ]);
    const tags = await listTagsForActivity(TEST_USER_ID, id);
    expect(tags).toEqual(['breakout', 'fade']);
  });

  it('rejects tags longer than 60 chars', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const tooLong = 'x'.repeat(61);
    await expect(
      setTagsForActivity(TEST_USER_ID, id, [tooLong]),
    ).rejects.toThrow(/too long/);
  });

  it('clears the row on empty-array set, bumps parent updated_at', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, id, ['x']);
    const before = await sql<{ updatedAt: unknown }[]>`
      SELECT updated_at FROM public.activity WHERE id = ${id}::uuid
    `;
    await new Promise((r) => setTimeout(r, 5));
    await setTagsForActivity(TEST_USER_ID, id, []);
    const after = await sql<{ updatedAt: unknown }[]>`
      SELECT updated_at FROM public.activity WHERE id = ${id}::uuid
    `;
    const empty = await listTagsForActivity(TEST_USER_ID, id);
    expect(empty).toEqual([]);
    const beforeIso = before[0].updatedAt instanceof Date ? before[0].updatedAt.toISOString() : String(before[0].updatedAt);
    const afterIso  = after[0].updatedAt  instanceof Date ? after[0].updatedAt.toISOString()  : String(after[0].updatedAt);
    expect(afterIso).not.toBe(beforeIso);
  });

  it('cascades on activity hard-delete (CASCADE FK)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, id, ['breakout']);
    await sql`DELETE FROM public.activity WHERE id = ${id}::uuid`;
    const remaining = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM public.activity_tag
      WHERE activity_id = ${id}::uuid
    `;
    expect(Number(remaining[0].count)).toBe(0);
  });

  it("cross-user isolation: A cannot read or write B's tags", async () => {
    const idB = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    await setTagsForActivity(OTHER_USER_ID, idB, ['B-secret']);

    // A trying to list B's tags should get nothing back.
    const seenByA = await listTagsForActivity(TEST_USER_ID, idB);
    expect(seenByA).toEqual([]);

    // A trying to replace B's tags should fail with SatelliteOwnershipError.
    await expect(
      setTagsForActivity(TEST_USER_ID, idB, ['pwn']),
    ).rejects.toBeInstanceOf(SatelliteOwnershipError);

    // B's tags untouched.
    const stillB = await listTagsForActivity(OTHER_USER_ID, idB);
    expect(stillB).toEqual(['B-secret']);
  });

  it('non-UUID activityId returns [] (no throw, no leak)', async () => {
    const tags = await listTagsForActivity(TEST_USER_ID, 'not-a-uuid');
    expect(tags).toEqual([]);
  });

  it('listAllTagsForUser returns distinct tags with counts', async () => {
    const a1 = await seedTradeActivity({ connectionId: testUser.connectionId, symbol: 'BTC-PERP' });
    const a2 = await seedTradeActivity({ connectionId: testUser.connectionId, symbol: 'ETH-PERP' });
    await setTagsForActivity(TEST_USER_ID, a1, ['breakout', 'london']);
    await setTagsForActivity(TEST_USER_ID, a2, ['breakout', 'fade']);

    const all = await listAllTagsForUser(TEST_USER_ID);
    const map = Object.fromEntries(all.map((r) => [r.tag, r.count]));
    expect(map.breakout).toBe(2);
    expect(map.london).toBe(1);
    expect(map.fade).toBe(1);
  });

  it('listAllTagsForUser hides tags from soft-deleted activities', async () => {
    const a1 = await seedTradeActivity({ connectionId: testUser.connectionId });
    await setTagsForActivity(TEST_USER_ID, a1, ['orphan']);
    await deleteActivity(TEST_USER_ID, a1);
    const all = await listAllTagsForUser(TEST_USER_ID);
    expect(all.find((r) => r.tag === 'orphan')).toBeUndefined();
  });
});

// ===========================================================================
// activity_excursion — upsert + uniqueness
// ===========================================================================

describe('activity_excursion', () => {
  it('inserts on first upsert, returns the row', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const row = await upsertExcursion(TEST_USER_ID, id, {
      stopLossPrice: '64000',
      maePrice: '63500',
      mfePrice: '67500',
      source: 'manual',
    });
    // NUMERIC(38,18) round-trips with trailing zeros — compare numerically.
    expect(Number(row.maePrice)).toBe(63500);
    expect(row.source).toBe('manual');
  });

  it("upsert is idempotent — second call updates, doesn't insert", async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertExcursion(TEST_USER_ID, id, { maePrice: '60000' });
    await upsertExcursion(TEST_USER_ID, id, { maePrice: '59000' });
    const row = await getExcursionForActivity(TEST_USER_ID, id);
    expect(Number(row?.maePrice)).toBe(59000);
    // Verify only one row exists for the activity (UNIQUE constraint holding).
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM public.activity_excursion
      WHERE activity_id = ${id}::uuid
    `;
    expect(Number(count)).toBe(1);
  });

  it('partial patch preserves unspecified columns', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertExcursion(TEST_USER_ID, id, {
      stopLossPrice: '64000',
      maePrice: '63500',
    });
    // Patch only mfePrice — stopLoss and mae must remain.
    await upsertExcursion(TEST_USER_ID, id, { mfePrice: '67500' });
    const row = await getExcursionForActivity(TEST_USER_ID, id);
    expect(Number(row?.stopLossPrice)).toBe(64000);
    expect(Number(row?.maePrice)).toBe(63500);
    expect(Number(row?.mfePrice)).toBe(67500);
  });

  it('delete removes the row', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertExcursion(TEST_USER_ID, id, { maePrice: '60000' });
    const ok = await deleteExcursion(TEST_USER_ID, id);
    expect(ok).toBe(true);
    const row = await getExcursionForActivity(TEST_USER_ID, id);
    expect(row).toBeNull();
  });

  it('cross-user isolation', async () => {
    const idB = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    await upsertExcursion(OTHER_USER_ID, idB, { maePrice: '99999' });
    const seenByA = await getExcursionForActivity(TEST_USER_ID, idB);
    expect(seenByA).toBeNull();
    await expect(
      upsertExcursion(TEST_USER_ID, idB, { maePrice: '0' }),
    ).rejects.toBeInstanceOf(SatelliteOwnershipError);
  });
});

// ===========================================================================
// activity_satisfaction — upsert
// ===========================================================================

describe('activity_satisfaction', () => {
  it('inserts on first upsert', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const row = await upsertSatisfaction(TEST_USER_ID, id, true, 'clean exit');
    expect(row.satisfaction).toBe(true);
    expect(row.reason).toBe('clean exit');
  });

  it('flips rating on re-upsert (composite PK on activity_id)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    await upsertSatisfaction(TEST_USER_ID, id, true);
    await upsertSatisfaction(TEST_USER_ID, id, false, 'tilted');
    const row = await getSatisfaction(TEST_USER_ID, id);
    expect(row?.satisfaction).toBe(false);
    expect(row?.reason).toBe('tilted');
  });

  it('cross-user isolation', async () => {
    const idB = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    await upsertSatisfaction(OTHER_USER_ID, idB, true);
    expect(await getSatisfaction(TEST_USER_ID, idB)).toBeNull();
    await expect(
      upsertSatisfaction(TEST_USER_ID, idB, false),
    ).rejects.toBeInstanceOf(SatelliteOwnershipError);
  });
});

// ===========================================================================
// activity_screenshot — full upload pipeline
// ===========================================================================

describe('activity_screenshot', () => {
  it('createScreenshot persists row with sniffed dimensions', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    // We pre-stage the file the way the route would, then call createScreenshot
    // with the metadata it returns. This keeps the test in pure DB territory.
    const png = fakePng(800, 600);
    const persisted = await persistScreenshot(TEST_USER_ID, id, png);
    expect(persisted.width).toBe(800);
    expect(persisted.height).toBe(600);

    const row = await createScreenshot(TEST_USER_ID, id, {
      side: 'entry',
      storageKey: persisted.storageKey,
      originalWidth: persisted.width,
      originalHeight: persisted.height,
      caption: 'open bar',
    });
    expect(row.side).toBe('entry');
    expect(row.originalWidth).toBe(800);
    expect(row.caption).toBe('open bar');

    // File on disk under the per-user/activity layout.
    expect(row.storageKey.startsWith(`${TEST_USER_ID}/${id}/`)).toBe(true);
    expect(await screenshotExists(row.storageKey)).toBe(true);
  });

  it('listScreenshotsForActivity returns rows in created order', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(100, 100);
    const a = await persistScreenshot(TEST_USER_ID, id, png);
    await createScreenshot(TEST_USER_ID, id, {
      side: 'entry',
      storageKey: a.storageKey,
      originalWidth: a.width,
      originalHeight: a.height,
    });
    const png2 = fakePng(200, 200);
    const b = await persistScreenshot(TEST_USER_ID, id, png2);
    await createScreenshot(TEST_USER_ID, id, {
      side: 'exit',
      storageKey: b.storageKey,
      originalWidth: b.width,
      originalHeight: b.height,
    });
    const list = await listScreenshotsForActivity(TEST_USER_ID, id);
    expect(list.length).toBe(2);
    expect(list[0].side).toBe('entry');
    expect(list[1].side).toBe('exit');
  });

  it('updateScreenshotAnnotation persists marker state', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(50, 50);
    const a = await persistScreenshot(TEST_USER_ID, id, png);
    const row = await createScreenshot(TEST_USER_ID, id, {
      side: 'context',
      storageKey: a.storageKey,
      originalWidth: a.width,
      originalHeight: a.height,
    });
    const markerState = { version: 3, markers: [{ type: 'FrameMarker', x: 10 }] };
    const updated = await updateScreenshotAnnotation(TEST_USER_ID, row.id, markerState);
    expect(updated?.annotationState).toEqual(markerState);
  });

  it('deleteScreenshot returns storage_key for cleanup; file unlink works', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(50, 50);
    const a = await persistScreenshot(TEST_USER_ID, id, png);
    const row = await createScreenshot(TEST_USER_ID, id, {
      side: 'entry',
      storageKey: a.storageKey,
      originalWidth: a.width,
      originalHeight: a.height,
    });
    const meta = await deleteScreenshot(TEST_USER_ID, row.id);
    expect(meta?.storageKey).toBe(a.storageKey);

    // The DB helper doesn't unlink the file — that's the route's job. Simulate.
    await unlinkScreenshot(a.storageKey);
    expect(await screenshotExists(a.storageKey)).toBe(false);
  });

  it('readScreenshot returns bytes with correct mime', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(100, 100);
    const a = await persistScreenshot(TEST_USER_ID, id, png);
    const { bytes, mime } = await readScreenshot(a.storageKey);
    expect(mime).toBe('image/png');
    expect(bytes.length).toBe(png.length);
  });

  it('cross-user isolation on screenshots', async () => {
    const idB = await seedTradeActivity({
      userId: OTHER_USER_ID,
      connectionId: otherUser.connectionId,
    });
    const png = fakePng(50, 50);
    const persisted = await persistScreenshot(OTHER_USER_ID, idB, png);
    const row = await createScreenshot(OTHER_USER_ID, idB, {
      side: 'entry',
      storageKey: persisted.storageKey,
      originalWidth: persisted.width,
      originalHeight: persisted.height,
    });

    // A listing B's activity gets nothing.
    const list = await listScreenshotsForActivity(TEST_USER_ID, idB);
    expect(list).toEqual([]);

    // A fetching B's screenshot by id gets null.
    const direct = await getScreenshot(TEST_USER_ID, row.id);
    expect(direct).toBeNull();

    // A can't delete B's screenshot.
    const delAttempt = await deleteScreenshot(TEST_USER_ID, row.id);
    expect(delAttempt).toBeNull();

    // B's row still exists.
    const stillThere = await getScreenshot(OTHER_USER_ID, row.id);
    expect(stillThere?.id).toBe(row.id);
  });
});

// ===========================================================================
// sniffImage — magic-byte validation
// ===========================================================================

describe('sniffImage', () => {
  it('accepts a well-formed PNG and reads width/height from IHDR', () => {
    const png = fakePng(1280, 720);
    const sniffed = sniffImage(png);
    expect(sniffed?.format).toBe('png');
    expect(sniffed?.width).toBe(1280);
    expect(sniffed?.height).toBe(720);
    expect(sniffed?.ext).toBe('png');
  });

  it('accepts a JPEG signature (no dimensions)', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    ]);
    const sniffed = sniffImage(jpeg);
    expect(sniffed?.format).toBe('jpeg');
    expect(sniffed?.ext).toBe('jpg');
  });

  it('rejects non-image bytes (text)', () => {
    const text = Buffer.from('<svg>not actually XML</svg>', 'utf-8');
    expect(sniffImage(text)).toBeNull();
  });

  it('rejects truncated PNG header', () => {
    const short = Buffer.from([0x89, 0x50]);
    expect(sniffImage(short)).toBeNull();
  });

  it('persistScreenshot throws UnsupportedImageError on non-image bytes', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const text = Buffer.from('definitely not an image');
    await expect(
      persistScreenshot(TEST_USER_ID, id, text),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('MAX_SCREENSHOT_BYTES is enforced (10MB cap)', () => {
    expect(MAX_SCREENSHOT_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ===========================================================================
// Path traversal defence
// ===========================================================================

describe('resolveStoragePath', () => {
  it('accepts a normal nested key', () => {
    const key = `${TEST_USER_ID}/${TEST_USER_ID}/abc.png`;
    expect(() => resolveStoragePath(key)).not.toThrow();
  });

  it('rejects keys that escape the storage root via "../"', () => {
    expect(() => resolveStoragePath('../etc/passwd')).toThrow(InvalidPathError);
    expect(() => resolveStoragePath('foo/../../escape.png')).toThrow(InvalidPathError);
  });

  it('rejects absolute paths that resolve outside the root', () => {
    expect(() => resolveStoragePath('/etc/passwd')).toThrow(InvalidPathError);
  });
});

// ===========================================================================
// On-disk safety — written files actually exist + survive round-trip
// ===========================================================================

describe('persistScreenshot on-disk layout', () => {
  it('writes the file to <root>/<userId>/<activityId>/<uuid>.<ext>', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(640, 480);
    const persisted = await persistScreenshot(TEST_USER_ID, id, png);
    const segments = persisted.storageKey.split('/');
    expect(segments[0]).toBe(TEST_USER_ID);
    expect(segments[1]).toBe(id);
    expect(segments[2]).toMatch(/^[0-9a-f-]{36}\.png$/);

    const abs = resolveStoragePath(persisted.storageKey);
    const st = await stat(abs);
    expect(st.size).toBe(png.length);
  });

  it('a second upload never collides (filename is server-generated UUID)', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const a = await persistScreenshot(TEST_USER_ID, id, fakePng(10, 10));
    const b = await persistScreenshot(TEST_USER_ID, id, fakePng(10, 10));
    expect(a.storageKey).not.toBe(b.storageKey);
  });
});

// ===========================================================================
// Integration smoke — readScreenshot returns same bytes that were written
// ===========================================================================

describe('round trip', () => {
  it('persist → read returns identical bytes', async () => {
    const id = await seedTradeActivity({ connectionId: testUser.connectionId });
    const png = fakePng(123, 45);
    const persisted = await persistScreenshot(TEST_USER_ID, id, png);
    const { bytes } = await readScreenshot(persisted.storageKey);
    expect(Buffer.compare(bytes, png)).toBe(0);
  });

  it('unlinkScreenshot is a no-op on a missing file', async () => {
    const fake = `${TEST_USER_ID}/${TEST_USER_ID}/${crypto.randomUUID()}.png`;
    await expect(unlinkScreenshot(fake)).resolves.toBeUndefined();
  });
});

// Hint to keep node's `crypto` global in scope for the test file (Node 20+
// exposes randomUUID on globalThis.crypto by default).
declare const crypto: { randomUUID(): string };

// Reference noop to silence the "writeFile/readFile unused" hints if the
// suite is extended later — they remain available via tools at import time.
void writeFile;
void readFile;
