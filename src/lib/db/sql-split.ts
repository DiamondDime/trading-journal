/**
 * Splits a SQL script into individual statements at top-level semicolons.
 *
 * Used by the PGlite migration runner (Electron desktop) and the compatibility
 * test harness (scripts/test-pglite.ts). `psql -f file.sql` treats every
 * top-level statement as its own transaction; PGlite's `db.exec()` wraps the
 * whole script in one transaction. Some of our migrations (notably the
 * vocabulary migration adding ALTER TYPE ADD VALUE then using the new value
 * in a CHECK constraint) depend on the per-statement semantic. We replicate
 * it by splitting + running each statement via `db.query()`.
 *
 * Recognises:
 *   - Line comments  `-- ... \n`
 *   - Block comments `/* ... *\/` (no nesting)
 *   - Single-quoted strings (with '' escape)
 *   - Dollar-quoted strings `$$ ... $$` and `$tag$ ... $tag$`
 *
 * Returns each statement trimmed, semicolon stripped, empties filtered out.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (ch === '-' && next === '-') {
      // Consume to newline
      while (i < len && sql[i] !== '\n') {
        buf += sql[i++];
      }
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      buf += sql[i++]; // /
      buf += sql[i++]; // *
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        buf += sql[i++];
      }
      if (i < len) {
        buf += sql[i++]; // *
        buf += sql[i++]; // /
      }
      continue;
    }

    // Single-quoted string
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

    // Dollar-quoted string: $tag$ ... $tag$  (tag may be empty)
    if (ch === '$') {
      // Peek the tag: $ [tag] $
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const open = tagMatch[0];
        buf += open;
        i += open.length;
        const closeIdx = sql.indexOf(open, i);
        if (closeIdx === -1) {
          // Unterminated dollar quote — append the rest and stop
          buf += sql.slice(i);
          i = len;
        } else {
          buf += sql.slice(i, closeIdx + open.length);
          i = closeIdx + open.length;
        }
        continue;
      }
    }

    // Statement terminator
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
