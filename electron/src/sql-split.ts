/**
 * Mirror of src/lib/db/sql-split.ts for the Electron CJS build.
 *
 * Kept in two places because the electron/ tree compiles standalone with its
 * own tsconfig (CJS, separate rootDir) and electron-builder asar-packs only
 * the compiled electron/dist tree plus the Next.js standalone bundle. Sharing
 * a single source file across both compile contexts is fragile under that
 * setup, so we accept the duplication. If you change one, change both.
 *
 * Splits a SQL script into individual statements at top-level semicolons,
 * respecting line comments, block comments, single-quoted strings, and
 * dollar-quoted strings (with optional tags).
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < len && sql[i] !== '\n') buf += sql[i++];
      continue;
    }

    if (ch === '/' && next === '*') {
      buf += sql[i++];
      buf += sql[i++];
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) buf += sql[i++];
      if (i < len) {
        buf += sql[i++];
        buf += sql[i++];
      }
      continue;
    }

    if (ch === "'") {
      buf += sql[i++];
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += sql[i++];
          buf += sql[i++];
          continue;
        }
        if (sql[i] === "'") {
          buf += sql[i++];
          break;
        }
        buf += sql[i++];
      }
      continue;
    }

    if (ch === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const open = tagMatch[0];
        buf += open;
        i += open.length;
        const closeIdx = sql.indexOf(open, i);
        if (closeIdx === -1) {
          buf += sql.slice(i);
          i = len;
        } else {
          buf += sql.slice(i, closeIdx + open.length);
          i = closeIdx + open.length;
        }
        continue;
      }
    }

    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      i++;
      continue;
    }

    buf += sql[i++];
  }

  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}
