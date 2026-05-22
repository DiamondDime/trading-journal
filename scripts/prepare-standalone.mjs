#!/usr/bin/env node
/**
 * prepare-standalone.mjs
 * ----------------------
 * Post-processes the Next.js standalone bundle (`.next/standalone`) so it is
 * safe to hand to electron-builder. Run after `next build` and before
 * `electron-builder` (see the `electron:*` scripts in package.json).
 *
 * It does two things:
 *
 * 1. Copies the static assets into the standalone tree — Next's documented
 *    layout requirement. `output: 'standalone'` emits `server.js` plus a
 *    minimal `node_modules`, but NOT `.next/static` or `public/`; the running
 *    server expects those *inside* the standalone dir.
 *
 * 2. Dereferences every symlink inside `.next/standalone` — replaces each
 *    symlink with a real copy of its target.
 *
 *    WHY: Next 16 standalone output, when `serverExternalPackages` is set,
 *    emits a hash-suffixed symlink under `.next/standalone/.next/node_modules`
 *    (e.g. `@electric-sql/pglite-<hash>` -> `../../../node_modules/.../pglite`).
 *    Next's `copyTracedFiles` recreates traced symlinks verbatim instead of
 *    copying their contents (next/dist/build/utils.js).
 *
 *    electron-builder cannot pack a payload containing such symlinks:
 *      - macOS: the asar packer fails with `… not a file` (it stat()s the
 *        symlinked directory mid-copy and the relative target dangles).
 *      - Windows: the 7za archiver fails with "The system cannot find the
 *        path specified" — it can't resolve the relative link during its
 *        flat traversal.
 *
 *    The symlink is pure build-trace metadata: nothing at runtime requires
 *    the hash-suffixed path — `require('@electric-sql/pglite')` resolves
 *    through normal node resolution to the *real* directory at
 *    `.next/standalone/node_modules/@electric-sql/pglite`. Replacing the
 *    symlink with a real copy keeps PGlite's WASM runtime + contrib
 *    `.tar.gz` extensions fully intact and loadable, and makes the bundle
 *    a plain file tree that both platforms' packers handle deterministically.
 *
 * Idempotent: safe to run repeatedly. Package-agnostic and hash-agnostic —
 * it handles any symlink Next emits, not just today's PGlite one.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const STANDALONE_DIR = join(".next", "standalone");

if (!existsSync(STANDALONE_DIR)) {
  console.error(
    `[prepare-standalone] ${STANDALONE_DIR} not found — run \`next build\` first.`,
  );
  process.exit(1);
}

// --- 1. Copy static assets into the standalone tree -------------------------
mkdirSync(join(STANDALONE_DIR, ".next"), { recursive: true });

if (existsSync(".next/static")) {
  cpSync(".next/static", join(STANDALONE_DIR, ".next", "static"), {
    recursive: true,
  });
}
if (existsSync("public")) {
  cpSync("public", join(STANDALONE_DIR, "public"), { recursive: true });
}

// --- 2. Dereference every symlink inside the standalone bundle --------------
/**
 * Recursively walk `dir`, replacing each symlink with a real copy of its
 * (fully resolved) target. Returns the list of dereferenced symlink paths.
 *
 * We use `lstatSync` so we detect the link itself rather than following it,
 * and `realpathSync` to resolve the target to an absolute path before
 * copying — this is robust whether the link is relative or absolute and
 * regardless of how many hops the chain has.
 */
function dereferenceSymlinks(dir) {
  const dereferenced = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stat = lstatSync(entryPath);

    if (stat.isSymbolicLink()) {
      // Resolve the link target. If it's broken, fail loudly — a dangling
      // link in the bundle means a real packaging/runtime bug, not something
      // to paper over.
      let realTarget;
      try {
        realTarget = realpathSync(entryPath);
      } catch (err) {
        throw new Error(
          `[prepare-standalone] dangling symlink in standalone bundle: ` +
            `${entryPath} (${err.code ?? err.message}). ` +
            `Refusing to package a broken bundle.`,
        );
      }
      // Replace the symlink with a real, fully-materialised copy.
      rmSync(entryPath, { recursive: true, force: true });
      cpSync(realTarget, entryPath, { recursive: true, dereference: true });
      dereferenced.push(entryPath);
      // The freshly copied tree is all real files — no need to recurse into
      // it (cpSync with `dereference` already flattened any nested links).
      continue;
    }

    if (stat.isDirectory()) {
      dereferenced.push(...dereferenceSymlinks(entryPath));
    }
  }
  return dereferenced;
}

const dereferenced = dereferenceSymlinks(STANDALONE_DIR);

if (dereferenced.length > 0) {
  console.log(
    `[prepare-standalone] dereferenced ${dereferenced.length} symlink(s):`,
  );
  for (const p of dereferenced) console.log(`  - ${p}`);
} else {
  console.log("[prepare-standalone] no symlinks in standalone bundle");
}

console.log("standalone assets copied");
