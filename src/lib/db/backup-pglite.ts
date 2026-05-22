/**
 * Pre-migration snapshot of the PGlite data directory.
 *
 * A migration that fails midway can leave the schema half-applied (see the
 * recovery note in `migrate-pglite.ts`). Before any pending migration runs on
 * an already-populated database, the desktop boot path copies the data
 * directory here so the user can roll back instead of losing the journal.
 *
 * The copy MUST be taken while PGlite is closed — a cleanly shut-down
 * Postgres data directory is consistent on disk, so the snapshot is never
 * torn. The caller (`client.ts bootPGlite`) closes PGlite, calls this, then
 * reopens.
 *
 * Snapshots land in `<userData>/data/backups/` — inside the folder the README
 * tells users to copy when backing up or moving the app, so snapshots travel
 * with a manual backup too.
 */
import { join, dirname } from "node:path";

/** How many of the most-recent snapshots to retain. */
const KEEP = 3;

const PREFIX = "pre-migration-";

/**
 * Copy `dataDir` into a timestamped snapshot folder, then prune old snapshots
 * down to the newest {@link KEEP}. Returns the snapshot path, or `null` when
 * there was nothing worth snapshotting (missing or empty data directory —
 * i.e. a fresh install with no user data).
 *
 * `fsMod` is injected so the desktop boot path can pass the `node:fs` module
 * it already dynamically imported, keeping the web bundle free of it. It is
 * typed as the dynamic-import namespace so it matches `await import("node:fs")`
 * exactly.
 */
export function backupPgliteDataDir(
  dataDir: string,
  fsMod: typeof import("node:fs")
): string | null {
  if (!fsMod.existsSync(dataDir)) return null;
  if (fsMod.readdirSync(dataDir).length === 0) return null;

  const backupsRoot = join(dirname(dataDir), "backups");
  fsMod.mkdirSync(backupsRoot, { recursive: true });

  // Colons are illegal in Windows paths — ISO string needs sanitising. The
  // result still sorts lexically == chronologically, which the prune relies on.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(backupsRoot, `${PREFIX}${stamp}`);
  fsMod.cpSync(dataDir, dest, { recursive: true });

  const snapshots = fsMod
    .readdirSync(backupsRoot)
    .filter((name) => name.startsWith(PREFIX))
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - KEEP))) {
    fsMod.rmSync(join(backupsRoot, stale), { recursive: true, force: true });
  }

  return dest;
}
