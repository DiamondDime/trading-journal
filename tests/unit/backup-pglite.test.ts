/**
 * Unit tests for the pre-migration PGlite snapshot helper.
 *
 * `backupPgliteDataDir` is data-safety-critical — it is the rollback point a
 * user relies on when a desktop update ships a migration that fails midway.
 * These tests exercise it against a real temp filesystem.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backupPgliteDataDir } from "../../src/lib/db/backup-pglite";

let root: string;
let dataDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "csj-backup-"));
  dataDir = join(root, "pglite");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("backupPgliteDataDir", () => {
  it("returns null when the data directory does not exist", () => {
    expect(backupPgliteDataDir(dataDir, fs)).toBeNull();
  });

  it("returns null for an empty data directory (fresh install)", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    expect(backupPgliteDataDir(dataDir, fs)).toBeNull();
  });

  it("snapshots a populated data directory into a sibling backups folder", () => {
    fs.mkdirSync(join(dataDir, "base"), { recursive: true });
    fs.writeFileSync(join(dataDir, "PG_VERSION"), "15");
    fs.writeFileSync(join(dataDir, "base", "rows"), "data");

    const dest = backupPgliteDataDir(dataDir, fs);

    expect(dest).not.toBeNull();
    expect(dest!).toContain(join(root, "backups"));
    expect(fs.existsSync(join(dest!, "PG_VERSION"))).toBe(true);
    expect(fs.readFileSync(join(dest!, "base", "rows"), "utf8")).toBe("data");
  });

  it("retains only the 3 most recent snapshots", () => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(join(dataDir, "PG_VERSION"), "15");

    // Four stale snapshots, lexically older than any real ISO timestamp.
    const backupsRoot = join(root, "backups");
    fs.mkdirSync(backupsRoot, { recursive: true });
    for (const d of ["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-04"]) {
      fs.mkdirSync(join(backupsRoot, `pre-migration-${d}`));
    }

    backupPgliteDataDir(dataDir, fs); // creates a fresh, lexically-newest one

    const remaining = fs
      .readdirSync(backupsRoot)
      .filter((n) => n.startsWith("pre-migration-"))
      .sort();

    expect(remaining).toHaveLength(3);
    // The two oldest stale snapshots were pruned.
    expect(remaining).not.toContain("pre-migration-2020-01-01");
    expect(remaining).not.toContain("pre-migration-2020-01-02");
    // The newest stale ones survive alongside the fresh snapshot.
    expect(remaining).toContain("pre-migration-2020-01-03");
    expect(remaining).toContain("pre-migration-2020-01-04");
  });
});
