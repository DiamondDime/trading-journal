/**
 * Electron user-provisioning helper.
 *
 * The Next.js side reads `APP_USER_ID` from process.env and joins against
 * `auth.users` / `public.profiles` on that uuid to identify the single user
 * of this desktop app. In dev that env var is set by the developer's shell;
 * in a packaged build there is no shell — so we need to:
 *
 *   1. Generate a stable per-install UUID on first launch and persist it to
 *      `<userData>/journal.json` so subsequent launches reuse it.
 *   2. Generate a stable `WORKER_HTTP_SECRET` alongside so the worker-side
 *      auth path doesn't error with "secret not set" the moment the user
 *      opens the exchange-connect form.
 *   3. UPSERT a row into `auth.users` (the Supabase-shim table) and into
 *      `public.profiles` so `requireUser()` resolves the id and the sidebar
 *      can read display_name (= NULL initially; the avatar falls back to
 *      the first char of email).
 *
 * This module is invoked AFTER the PGlite bridge is up and BEFORE the
 * Next.js subprocess spawns, so the profile UPSERT runs against a live DB.
 *
 * NEVER log the WORKER_HTTP_SECRET value. We log only the user id.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE_FILE_NAME = 'journal.json';
const STATE_FILE_MODE = 0o600;
const STATE_DIR_MODE = 0o700;
const SECRET_BYTES = 32;
const SECRET_HEX_LEN = SECRET_BYTES * 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{64}$/i;

/** Demo-account email used for the local profile shim. Not actually delivered. */
const DEFAULT_USER_EMAIL = 'local@journal.app';

interface JournalState {
  userId: string;
  workerSecret: string;
}

export interface ProvisionedUser {
  userId: string;
  workerSecret: string;
  /** Whether either field was generated fresh on this call. */
  generated: boolean;
  statePath: string;
}

/**
 * Parse the journal.json body. Returns the parsed state if both fields are
 * present and well-formed, otherwise null (caller regenerates). We deliberately
 * treat malformed content as "regenerate" rather than throwing — the file is
 * ours to manage and a corrupt file is recoverable by writing a fresh one.
 */
function parseJournalState(raw: string): JournalState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.userId !== 'string' || !UUID_RE.test(obj.userId)) return null;
  if (typeof obj.workerSecret !== 'string' || !HEX_RE.test(obj.workerSecret)) return null;
  return { userId: obj.userId, workerSecret: obj.workerSecret };
}

/**
 * Provision (or load) the per-install identity. Idempotent — safe to call
 * on every boot.
 *
 * The caller is responsible for passing the returned `userId` into the
 * Next.js subprocess env as `APP_USER_ID` and `workerSecret` as
 * `WORKER_HTTP_SECRET`. Do NOT log the worker secret.
 */
export async function loadOrProvisionUser(userDataDir: string): Promise<ProvisionedUser> {
  const statePath = join(userDataDir, STATE_FILE_NAME);
  const dir = dirname(statePath);

  // Best-effort dir creation. `userData` always exists on Electron platforms,
  // but the mode-set is defensive.
  await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });

  // Try to load existing state.
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const existing = parseJournalState(raw);
    if (existing) {
      return { ...existing, generated: false, statePath };
    }
    // Fall through to regeneration — stale/corrupt file.
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // EACCES, EISDIR etc — surface loudly. Failing fast beats spawning
      // a Next.js subprocess that'll error on every DB query.
      throw err;
    }
    // ENOENT — fall through to generation.
  }

  const userId = randomUUID();
  const workerSecret = randomBytes(SECRET_BYTES).toString('hex');
  if (workerSecret.length !== SECRET_HEX_LEN) {
    throw new Error(
      `Worker secret generation produced ${workerSecret.length} chars; expected ${SECRET_HEX_LEN}`,
    );
  }

  const body = JSON.stringify({ userId, workerSecret });
  await fs.writeFile(statePath, body, { mode: STATE_FILE_MODE });
  // writeFile's `mode` applies only on file creation; force the bit on existing
  // files too. Cheap and explicit.
  await fs.chmod(statePath, STATE_FILE_MODE);

  return { userId, workerSecret, generated: true, statePath };
}

/**
 * Postgres query function signature we accept. PGlite's `.query()` is shaped
 * exactly like this — caller passes the PGlite instance directly. We keep the
 * dependency loose so this module is unit-testable with a stub.
 */
export interface PgQueryRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/**
 * Ensure the user exists in both `auth.users` (the local Supabase shim) and
 * `public.profiles`. Idempotent.
 *
 * Why two tables? The Postgres-shim migration mirrors Supabase's layout:
 *   - `auth.users` holds the canonical id + email.
 *   - `public.profiles` is the app-shaped 1:1 row (display_name, timezone, etc).
 *
 * `handle_new_user` would normally insert profiles automatically when an
 * auth.users row appears — but it also enforces the allowlist, which the
 * local desktop install hasn't seeded. So we:
 *   1. Add the email to `public.allowlist` so the trigger passes (or
 *      simply use `ON CONFLICT DO NOTHING` if it already exists).
 *   2. UPSERT `auth.users` (the trigger fires, creates the profile).
 *   3. UPSERT `public.profiles` directly as a belt-and-braces — covers the
 *      race where the file existed from a prior install but the trigger
 *      hadn't yet written profiles.
 */
export async function ensureProfileRow(
  db: PgQueryRunner,
  userId: string,
  opts: { email?: string } = {},
): Promise<void> {
  const email = opts.email ?? DEFAULT_USER_EMAIL;

  // 1. Allowlist (handle_new_user requires the email present).
  await db.query(
    `INSERT INTO public.allowlist (email, role, notes)
     VALUES ($1, 'admin', 'electron desktop install')
     ON CONFLICT (email) DO NOTHING`,
    [email],
  );

  // 2. auth.users (the trigger writes profiles).
  await db.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1::uuid, $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, email],
  );

  // 3. profiles — explicit upsert to cover both the trigger-fires case and
  //    the trigger-skipped case (profile pre-existing from a prior run).
  //    display_name is NULL: the sidebar's computeInitials() falls back to
  //    the first character of email, which is fine for a local single-user
  //    app. Users can edit it via /settings/profile later.
  await db.query(
    `INSERT INTO public.profiles (id, email, display_name, timezone, base_currency)
     VALUES ($1::uuid, $2, NULL, 'Etc/UTC', 'USD')
     ON CONFLICT (id) DO NOTHING`,
    [userId, email],
  );
}
