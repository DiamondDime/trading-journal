/**
 * Screenshot upload utilities.
 *
 * Threat model — this file is the trust boundary for an authenticated user's
 * binary upload:
 *
 *   1. Path traversal. The user can pass HTTP body, query, or multipart
 *      headers — none of those reach the filesystem path. The path is built
 *      purely from server-validated UUIDs (userId, activityId) and a server-
 *      generated UUID for the filename. The directory component is resolved
 *      and verified to stay UNDER the configured storage root.
 *
 *   2. MIME spoofing. Content-Type from multipart is advisory only — the
 *      file extension is derived from a magic-byte sniff on the first bytes
 *      of the upload. PNG / JPEG / WebP are accepted; everything else
 *      rejected with UnsupportedImageError.
 *
 *   3. Size DoS. The route caller is responsible for enforcing the 10MB cap
 *      before invoking persistScreenshot — we trust `bytes.length` here.
 *
 * The on-disk layout is:
 *   <SCREENSHOT_STORAGE_DIR>/<userId>/<activityId>/<random-uuid>.<ext>
 *
 * storage_key in the DB is the RELATIVE path (everything after the storage
 * root). The reader rejoins root + storage_key + sanity-checks it stays in
 * the root before serving bytes.
 */
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard cap on accepted upload size. The HTTP route MUST enforce this against
// `Content-Length` or the streamed body length BEFORE buffering; this constant
// is the single source of truth for both.
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export class UnsupportedImageError extends Error {
  constructor(message = 'File is not a supported image (PNG, JPEG, WebP)') {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

export class TooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`File exceeds the ${limit}-byte limit`);
    this.name = 'TooLargeError';
  }
}

export class InvalidPathError extends Error {
  constructor(message = 'Refusing to access path outside the storage root') {
    super(message);
    this.name = 'InvalidPathError';
  }
}

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface SniffedImage {
  format: ImageFormat;
  width: number | null;
  height: number | null;
  /** Canonical lowercase extension matching `format`. */
  ext: 'png' | 'jpg' | 'webp';
  /** RFC 6838 mime type matching `format`. */
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * Sniff the format of an image buffer by inspecting magic bytes, and try to
 * pull out width/height from the header. Returns null if the format isn't
 * one we accept.
 *
 * Header signatures (all big-endian unless noted):
 *   PNG  — 89 50 4E 47 0D 0A 1A 0A  (8 bytes)
 *          IHDR chunk starts at byte 16 with the bytes "IHDR" at offset 12.
 *          Width = u32 at offset 16, height = u32 at offset 20.
 *   JPEG — FF D8 FF  (3 bytes). Width/height needs SOF0/SOF2 marker walk —
 *          we trade off complexity vs benefit and skip JPEG dimensions; the
 *          UI re-computes them from the rendered <img>.
 *   WebP — 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP) at offset 8.
 *          VP8L: bytes 21-23 contain width-1 (14-bit LE) and height-1.
 *          VP8 : bytes 26-29 contain width (16-bit LE) and height (16-bit LE).
 *          VP8X: bytes 24-26 width-1, 27-29 height-1 (both 24-bit LE).
 *          We support VP8 + VP8L. VP8X is rare in screenshots; pass through
 *          with null dimensions if encountered.
 */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (buf.length < 12) return null;

  // PNG
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    if (buf.length < 24) return { format: 'png', width: null, height: null, ext: 'png', mime: 'image/png' };
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { format: 'png', width, height, ext: 'png', mime: 'image/png' };
  }

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { format: 'jpeg', width: null, height: null, ext: 'jpg', mime: 'image/jpeg' };
  }

  // WebP — RIFF ... WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    // The FOURCC at offset 12 tells us which VP8 sub-format.
    const sub = buf.slice(12, 16).toString('ascii');
    if (sub === 'VP8 ' && buf.length >= 30) {
      // VP8 width/height live at bytes 26-29 as little-endian 14-bit each.
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      return { format: 'webp', width: w, height: h, ext: 'webp', mime: 'image/webp' };
    }
    if (sub === 'VP8L' && buf.length >= 25) {
      // VP8L: byte 20 is signature 0x2f; widths-1/heights-1 are 14-bit fields.
      // Bits 0-13 of bytes 21-24 form width-1; next 14 bits form height-1.
      const b0 = buf.readUInt32LE(21);
      const w = (b0 & 0x3fff) + 1;
      const h = ((b0 >> 14) & 0x3fff) + 1;
      return { format: 'webp', width: w, height: h, ext: 'webp', mime: 'image/webp' };
    }
    // VP8X or other — accept the file but don't try to parse dimensions.
    return { format: 'webp', width: null, height: null, ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

/**
 * Return the configured storage root, resolved to an absolute path. Default
 * is ./uploads/screenshots relative to the process cwd. Calling this lazily
 * (rather than at module-load) lets tests override SCREENSHOT_STORAGE_DIR
 * after the module is imported.
 */
export function storageRoot(): string {
  const raw = process.env.SCREENSHOT_STORAGE_DIR ?? './uploads/screenshots';
  return path.resolve(raw);
}

/**
 * Compose the relative storage_key from validated components and a server-
 * generated filename. The caller has already validated userId + activityId
 * as UUIDs but we re-validate here as a belt-and-braces measure since this
 * function is what builds an actual filesystem path.
 */
export function makeStorageKey(
  userId: string,
  activityId: string,
  ext: SniffedImage['ext'],
): string {
  if (!UUID_RE.test(userId) || !UUID_RE.test(activityId)) {
    throw new InvalidPathError('userId and activityId must be UUIDs');
  }
  if (!['png', 'jpg', 'webp'].includes(ext)) {
    throw new InvalidPathError(`unsupported extension ${ext}`);
  }
  return `${userId}/${activityId}/${randomUUID()}.${ext}`;
}

/**
 * Resolve `storageKey` against the storage root and verify the resolved path
 * stays UNDER the root. Defends against any future bug where a storage_key
 * could be constructed with `..` segments (current code paths cannot, but
 * the DB might be edited out-of-band someday).
 *
 * Returns the absolute on-disk path.
 */
export function resolveStoragePath(storageKey: string): string {
  const root = storageRoot();
  // path.resolve correctly handles `..` segments but doesn't refuse to escape
  // the root — we have to compare prefixes ourselves.
  const abs = path.resolve(root, storageKey);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    throw new InvalidPathError();
  }
  return abs;
}

/**
 * Write the upload to disk at the resolved path under the storage root.
 * Returns the storage_key + format metadata for DB insertion. The caller is
 * responsible for size-bound checks BEFORE calling — we re-check here as a
 * defence-in-depth measure.
 */
export async function persistScreenshot(
  userId: string,
  activityId: string,
  bytes: Buffer,
): Promise<{ storageKey: string; format: ImageFormat; width: number | null; height: number | null; mime: string }> {
  if (bytes.length === 0) {
    throw new UnsupportedImageError('Empty file');
  }
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new TooLargeError(MAX_SCREENSHOT_BYTES);
  }

  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new UnsupportedImageError();

  const storageKey = makeStorageKey(userId, activityId, sniffed.ext);
  const abs = resolveStoragePath(storageKey);

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes, { flag: 'wx' });  // wx → fail if exists; collision-safe.

  return {
    storageKey,
    format: sniffed.format,
    width: sniffed.width,
    height: sniffed.height,
    mime: sniffed.mime,
  };
}

/**
 * Read a screenshot file from disk by its storage_key. Returns the bytes +
 * the mime type derived from the extension (which mirrors what sniffImage
 * decided at write time — we trust the extension because it was set by us,
 * not the client).
 *
 * Throws InvalidPathError if the storage_key resolves outside the root.
 */
export async function readScreenshot(
  storageKey: string,
): Promise<{ bytes: Buffer; mime: string }> {
  const abs = resolveStoragePath(storageKey);
  const ext = path.extname(abs).toLowerCase();
  const mime: Record<string, string> = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const m = mime[ext];
  if (!m) throw new InvalidPathError(`unsupported extension on disk: ${ext}`);
  const bytes = await readFile(abs);
  return { bytes, mime: m };
}

/** Best-effort delete. Missing-file is not an error (file may have been removed
 *  out of band already). */
export async function unlinkScreenshot(storageKey: string): Promise<void> {
  const abs = resolveStoragePath(storageKey);
  try {
    await unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

/** Used by tests + the housekeeping cron. */
export async function screenshotExists(storageKey: string): Promise<boolean> {
  try {
    const abs = resolveStoragePath(storageKey);
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}
