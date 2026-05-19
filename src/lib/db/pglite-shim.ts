/**
 * postgres.js-compatible shim over PGlite's native `db.query()` / `db.transaction()`.
 *
 * Why this exists
 * ───────────────
 * The codebase is built against the `postgres` npm package's tagged-template
 * API: `sql\`SELECT ... WHERE id = ${id}\``, `sql.begin(async (tx) => ...)`,
 * `transform: postgres.camel`, identifier fragments via `sql(obj)`. Rewriting
 * 200+ callsites to PGlite's native API would be invasive and noisy.
 *
 * The earlier desktop path used `@electric-sql/pglite-socket` — a Postgres
 * wire-protocol server in front of in-process PGlite — so postgres.js could
 * talk to it unchanged. That layer is experimental, and its protocol gaps
 * surfaced as `ECONNRESET` on the very first query of every page load.
 *
 * This shim deletes the TCP layer. We accept the same template-tag input the
 * codebase already produces, compile it to `$1, $2, ...` parameterised SQL,
 * call `pglite.query()` directly, and apply the same `postgres.camel`
 * snake_case → camelCase transform on every returned row. Same input, same
 * output, no socket in the middle.
 *
 * Scope
 * ─────
 * Covers exactly the API the codebase uses (inventoried by Explore agent):
 *   - Tagged template: `sql\`...\`` with values + nested fragments
 *   - Identifier helper: `sql(name)`, `sql('table.col')`, `sql(string[])`
 *   - SET helper:        `sql({col1: v1, col2: v2})` → `"col1" = $1, "col2" = $2`
 *   - Transactions:      `sql.begin(async (tx) => ...)` with nested begins
 *                        mapped to PostgreSQL SAVEPOINTs
 *   - Raw SQL:           `sql.unsafe(text, params)`
 *   - Cleanup:           `sql.end({ timeout })`
 *   - Generic typing:    `sql<RowT[]>\`...\`` — TS-only, runtime ignored
 *   - camelCase output:  every row's keys are converted snake_case → camelCase
 *
 * Out of scope (not used in codebase, verified by inventory): cursors,
 * streaming, `.values()` / `.raw()`, LISTEN/NOTIFY, custom type decoders,
 * connection pools.
 *
 * Type coercion
 * ─────────────
 * PGlite's defaults match what postgres.js + this codebase already expect:
 *   - text/varchar/citext → string
 *   - numeric/decimal     → string  (consumed via `decimal.js` at UI edge)
 *   - uuid                → string  (compile-time-branded by `src/types/canonical.ts`)
 *   - int2/int4/float     → number
 *   - bool                → boolean
 *   - timestamp(tz)/date  → Date    (consumers call `.toISOString()` when needed)
 *   - json/jsonb          → parsed object/array/scalar
 *   - bytea               → Uint8Array
 *   - arrays              → JS array (recursive)
 *   - NULL                → null    (never undefined)
 *
 * INT8 (bigint) returns `number` in the safe-integer range and `BigInt`
 * outside. The codebase casts every count/agg to `::text` upstream, so we
 * never hit the BigInt branch. If a future query forgets to cast, the call
 * site will fail loudly at type-narrow time — preferable to silent precision
 * loss.
 *
 * Performance
 * ───────────
 * Every query is one `pglite.query()` call (no TCP roundtrip, no parse-bind-
 * execute pipelining concerns — PGlite is in-process WASM). Sub-millisecond
 * for typical reads.
 */
import type { PGlite, Transaction, Results } from "@electric-sql/pglite";

// ─── public types ──────────────────────────────────────────────────────────

/**
 * The shim's public surface — a callable that behaves like postgres.js's
 * `sql` template tag, with the methods we actually use attached.
 *
 * NB: the call signature is overloaded — tagged-template call vs. identifier-
 * helper call — but TypeScript resolves these at the call site so consumers
 * don't have to disambiguate.
 */
export interface PGliteSql {
  // Tagged template — produces a thenable Query.
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Query<T>;

  // Identifier helper — produces a Fragment for inline embedding.
  (value: string | readonly string[] | Record<string, unknown>): Fragment;

  /** Transaction wrapper. Nested calls inside the callback use SAVEPOINTs. */
  begin<T>(callback: (tx: PGliteSql) => Promise<T>): Promise<T>;
  /** Raw SQL with positional `$1..$N` params; same camelCase transform applies. */
  unsafe<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  /** Close the underlying PGlite instance. `timeout` accepted for API parity; ignored. */
  end(opts?: { timeout?: number }): Promise<void>;
}

// ─── internal markers ──────────────────────────────────────────────────────

const QUERY_TAG = Symbol("pgshim.query");
const FRAGMENT_TAG = Symbol("pgshim.fragment");

/**
 * Lazy query object — postgres.js callers expect `sql\`...\`` to return a
 * thenable that runs when awaited, *and* something that can be inlined inside
 * another template tag. This class is both: it's `PromiseLike<T[]>` for top-
 * level await, and it carries `{ strings, values }` so the outer template can
 * splice it in without executing it.
 */
export class Query<T = unknown> implements PromiseLike<T[]> {
  readonly [QUERY_TAG] = true as const;
  readonly strings: readonly string[];
  readonly values: readonly unknown[];

  /** Cached executed promise — set on first `.then()` so the query only runs once. */
  private _executed: Promise<T[]> | null = null;

  constructor(
    private readonly runner: QueryRunner,
    strings: readonly string[],
    values: readonly unknown[],
  ) {
    this.strings = strings;
    this.values = values;
  }

  then<R1 = T[], R2 = never>(
    onfulfilled?: (value: T[]) => R1 | PromiseLike<R1>,
    onrejected?: (reason: unknown) => R2 | PromiseLike<R2>,
  ): Promise<R1 | R2> {
    if (this._executed === null) this._executed = this.execute();
    return this._executed.then(onfulfilled, onrejected);
  }

  catch<R = never>(
    onrejected?: (reason: unknown) => R | PromiseLike<R>,
  ): Promise<T[] | R> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: () => void): Promise<T[]> {
    return this.then(
      (v) => {
        onfinally?.();
        return v;
      },
      (e) => {
        onfinally?.();
        throw e;
      },
    );
  }

  private async execute(): Promise<T[]> {
    const built = buildSql(this.strings, this.values, 1);
    return this.runner(built.sql, built.params);
  }
}

/**
 * Inline-only marker. `sql(...)` returns one of these — interpolating it into
 * a template tag pulls its compiled SQL string into the surrounding query.
 * Never thenable: there's nothing to execute on its own.
 */
export interface Fragment {
  readonly [FRAGMENT_TAG]: true;
  /** Render this fragment, starting parameter numbers at `paramOffset`. */
  build(paramOffset: number): { sql: string; params: unknown[] };
}

function isQuery(v: unknown): v is Query {
  return typeof v === "object" && v !== null && QUERY_TAG in v;
}

function isFragment(v: unknown): v is Fragment {
  return typeof v === "object" && v !== null && FRAGMENT_TAG in v;
}

// ─── camelCase transform ───────────────────────────────────────────────────

/**
 * snake_case → camelCase, mirroring postgres.js's `postgres.camel`.
 *
 * Cached so we don't reallocate the same key string on every row of a 1000-
 * row result set. Bounded growth: keys are column names from migrations, so
 * the cache size is small and predictable.
 */
const camelCache = new Map<string, string>();
function snakeToCamel(input: string): string {
  const hit = camelCache.get(input);
  if (hit !== undefined) return hit;
  const out = input.replace(/_([a-z0-9])/g, (_, c) => (c as string).toUpperCase());
  camelCache.set(input, out);
  return out;
}

/**
 * Transform a single row's keys. Hot path — called once per row. Allocates a
 * new object rather than mutating because consumers sometimes hold on to the
 * shape, and key renames mid-iteration are surprising.
 */
function transformRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const key in row) {
    out[snakeToCamel(key)] = row[key];
  }
  return out as T;
}

function transformRows<T>(rows: readonly Record<string, unknown>[]): T[] {
  const out = new Array<T>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    out[i] = transformRow(rows[i] as Record<string, unknown>) as T;
  }
  return out;
}

// ─── SQL builder ───────────────────────────────────────────────────────────

/**
 * Compile a template-tag (or recursively, a nested Query) into a flat
 * `$1..$N` parameterised SQL string + params array. Hands off to PGlite,
 * which speaks the exact same placeholder dialect.
 *
 * `paramOffset` is the starting number for placeholders — passed through to
 * keep numbering consistent when one Query is nested inside another. The
 * top-level call always passes 1; recursion bumps it by however many params
 * have been emitted so far.
 */
function buildSql(
  strings: readonly string[],
  values: readonly unknown[],
  paramOffset: number,
): { sql: string; params: unknown[]; nextOffset: number } {
  let sql = strings[0] ?? "";
  let paramN = paramOffset;
  const params: unknown[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (isQuery(v)) {
      // Nested template — inline its compiled SQL, share the param numbering.
      const inner = buildSql(v.strings, v.values, paramN);
      sql += inner.sql;
      params.push(...inner.params);
      paramN = inner.nextOffset;
    } else if (isFragment(v)) {
      // Identifier / SET / column-list — fragment decides whether it emits
      // raw SQL only, or raw SQL plus parameters.
      const inner = v.build(paramN);
      sql += inner.sql;
      params.push(...inner.params);
      paramN += inner.params.length;
    } else {
      // Regular value — parameterise.
      sql += `$${paramN}`;
      params.push(serializeValue(v));
      paramN++;
    }

    sql += strings[i + 1] ?? "";
  }

  return { sql, params, nextOffset: paramN };
}

/**
 * PGlite's serializer handles primitives, Date, Buffer, and plain objects
 * (→ JSON for jsonb). We only need to intercept `undefined`, which PGlite
 * treats as `NULL` but TypeScript should not silently promote.
 *
 * Returning the value untouched in every other case lets PGlite's parsers
 * apply their per-OID coercion (Date → ISO string, plain object → JSON.stringify,
 * etc.) without us second-guessing them.
 */
function serializeValue(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

// ─── identifier escaping ───────────────────────────────────────────────────

/**
 * Wrap a single identifier in double quotes, escaping embedded quotes per the
 * SQL spec (`"` → `""`). Identifiers come from the codebase, not user input,
 * but quoting still matters: it preserves mixed case, lets reserved words
 * through (`order`, `user`), and keeps a single failure mode for malformed
 * names instead of varying-by-engine surprises.
 */
function escapeIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Dotted-name escape: `"table.col"` → `"table"."col"`. Used so callers can
 * write `sql('f.id')` without having to manually split.
 *
 * If a part contains its own dot or is empty, fall back to wrapping the whole
 * input — that's still parseable by Postgres, just not split. Robustness over
 * cleverness here.
 */
function escapeDottedIdentifier(name: string): string {
  if (name.length === 0) return '""';
  return name
    .split(".")
    .map((part) => escapeIdentifier(part))
    .join(".");
}

// ─── fragment factories ────────────────────────────────────────────────────

/**
 * Build a Fragment from whatever was passed to `sql(...)`.
 *
 * Three shapes the codebase uses:
 *   - `sql('users')`             → identifier `"users"`
 *   - `sql('f.id')`              → dotted identifier `"f"."id"`
 *   - `sql(['a', 'b'])`          → comma-separated identifier list
 *   - `sql({col1: v1, col2: v2})`→ `"col1" = $N, "col2" = $M` (SET-style)
 *
 * Anything else is a misuse and should crash loudly at the callsite.
 */
function createFragment(
  value: string | readonly string[] | Record<string, unknown>,
): Fragment {
  if (typeof value === "string") {
    const sql = escapeDottedIdentifier(value);
    return {
      [FRAGMENT_TAG]: true,
      build: () => ({ sql, params: [] }),
    };
  }

  if (Array.isArray(value)) {
    const sql = value.map((v) => escapeDottedIdentifier(String(v))).join(", ");
    return {
      [FRAGMENT_TAG]: true,
      build: () => ({ sql, params: [] }),
    };
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    return {
      [FRAGMENT_TAG]: true,
      build(paramOffset: number) {
        const params: unknown[] = [];
        const parts: string[] = [];
        for (let i = 0; i < keys.length; i++) {
          parts.push(`${escapeIdentifier(keys[i])} = $${paramOffset + i}`);
          params.push(serializeValue(obj[keys[i]]));
        }
        return { sql: parts.join(", "), params };
      },
    };
  }

  throw new TypeError(
    `sql() expected a string, string[], or object; got ${typeof value}`,
  );
}

// ─── runner abstraction ────────────────────────────────────────────────────

/**
 * The async backend `Query.execute()` and `sql.unsafe()` call into. Lets the
 * outer transaction wrapper substitute its `Transaction` handle while keeping
 * `Query` indifferent to whether it's running at top-level or inside `begin`.
 */
type QueryRunner = <T>(sql: string, params: readonly unknown[]) => Promise<T[]>;

function makeRunner(
  exec: <T>(
    sql: string,
    params: readonly unknown[],
  ) => Promise<Results<T>>,
): QueryRunner {
  return async <T>(sql: string, params: readonly unknown[]): Promise<T[]> => {
    const result = await exec<Record<string, unknown>>(sql, params);
    return transformRows<T>(result.rows);
  };
}

// ─── public factory ────────────────────────────────────────────────────────

/**
 * Wrap a PGlite instance — or, lazily, a factory that produces one — in the
 * postgres.js-compatible surface. The shape mirrors `ReturnType<typeof postgres>`
 * closely enough that `src/lib/db/*.ts` imports `sql` and uses it unchanged.
 *
 * Why support a factory? `client.ts` is imported synchronously from Server
 * Components, but PGlite boot is async (it has to open the WASM runtime,
 * read the data dir, apply migrations). Passing `() => Promise<PGlite>` lets
 * `sql` be exported synchronously and have each query await the boot the
 * first time it fires, then reuse the resolved instance on every subsequent
 * call. Memoised via a closed-over promise — race-safe under concurrent
 * Server Component renders.
 */
export function createPGliteSql(
  dbOrFactory: PGlite | (() => Promise<PGlite>),
): PGliteSql {
  let memo: Promise<PGlite> | null = null;
  const getDb = (): Promise<PGlite> => {
    if (typeof dbOrFactory !== "function") return Promise.resolve(dbOrFactory);
    if (!memo) memo = dbOrFactory();
    return memo;
  };

  const runner: QueryRunner = async <T>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> => {
    const db = await getDb();
    try {
      const result = await db.query<Record<string, unknown>>(
        sql,
        params as unknown[],
      );
      return transformRows<T>(result.rows);
    } catch (err) {
      // Diagnostic logging: production Next.js otherwise masks server errors
      // to just a digest. The shim is the closest point to the failure so we
      // print the SQL + the engine's error here. Cheap (one console.error
      // per failed query) and the only thing that surfaces real causes
      // through the Electron parent's stderr capture.
      const e = err as { message?: string };
      console.error(
        `[db] query failed: ${e.message ?? String(err)}\n` +
          `     sql: ${sql.slice(0, 240)}${sql.length > 240 ? "…" : ""}\n` +
          `     params: ${JSON.stringify(params).slice(0, 240)}`,
      );
      throw err;
    }
  };

  // The function returned to consumers. We attach methods after constructing
  // it as a plain function so callsites can do both `sql\`...\`` and
  // `sql.begin(...)` without TypeScript getting confused about overloads.
  function sqlFn(...args: unknown[]): unknown {
    // Tagged-template invocation: TemplateStringsArray has a `raw` property
    // and is itself an array. Plain string / object args go to createFragment.
    const first = args[0];
    if (
      Array.isArray(first) &&
      Object.prototype.hasOwnProperty.call(first, "raw")
    ) {
      const strings = first as unknown as TemplateStringsArray;
      return new Query(runner, strings, args.slice(1));
    }
    return createFragment(
      first as string | readonly string[] | Record<string, unknown>,
    );
  }

  // begin: PGlite's `db.transaction(cb)` auto-commits on resolve, auto-rolls
  // back on reject. We wrap `tx` in a fresh shim using the tx's query method
  // so SQL inside the callback hits the in-flight transaction instead of a
  // new top-level connection.
  //
  // Nested begin() inside the callback is rare (one site: option wizard) but
  // legal in postgres.js — and PGlite doesn't allow nested transactions. We
  // emit SAVEPOINTs by hand at the inner level so the codebase doesn't care.
  sqlFn.begin = async function begin<T>(
    callback: (tx: PGliteSql) => Promise<T>,
  ): Promise<T> {
    const db = await getDb();
    return db.transaction(async (tx) => {
      const txSql = wrapTransaction(tx);
      return callback(txSql);
    });
  };

  sqlFn.unsafe = async function unsafe<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return runner<T>(text, params);
  };

  sqlFn.end = async function end(_opts?: { timeout?: number }): Promise<void> {
    const db = await getDb();
    await db.close();
  };

  return sqlFn as unknown as PGliteSql;
}

// ─── transaction wrapping (with savepoint support for nested begin) ───────

/**
 * Wrap a PGlite Transaction object in the same callable shape as the top-
 * level shim. Reusing the public type means the codebase's existing
 * `sql.begin(async (tx) => { tx\`...\`; tx({...}); ... })` patterns work
 * verbatim, including nested `tx.begin(...)` which we translate to
 * SAVEPOINTs because PGlite can't nest real transactions.
 */
function wrapTransaction(tx: Transaction, savepointDepth = 0): PGliteSql {
  const runner = makeRunner(<T>(s: string, p: readonly unknown[]) =>
    tx.query<T>(s, p as unknown[]),
  );

  function txFn(...args: unknown[]): unknown {
    const first = args[0];
    if (
      Array.isArray(first) &&
      Object.prototype.hasOwnProperty.call(first, "raw")
    ) {
      const strings = first as unknown as TemplateStringsArray;
      return new Query(runner, strings, args.slice(1));
    }
    return createFragment(
      first as string | readonly string[] | Record<string, unknown>,
    );
  }

  txFn.begin = async function begin<T>(
    callback: (inner: PGliteSql) => Promise<T>,
  ): Promise<T> {
    // Nested begin → SAVEPOINT. Name them by depth so each is unique within
    // its parent. Depth-based naming also makes log output legible when
    // something fails inside a deep nest.
    const name = `csj_sp_${savepointDepth}`;
    await tx.query(`SAVEPOINT ${name}`);
    try {
      const innerSql = wrapTransaction(tx, savepointDepth + 1);
      const result = await callback(innerSql);
      await tx.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (err) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw err;
    }
  };

  txFn.unsafe = async function unsafe<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    return runner<T>(text, params);
  };

  // Inside a transaction, `end()` is meaningless — never called by app code,
  // but exposed for parity so the type narrows cleanly. No-op.
  txFn.end = async function end(_opts?: { timeout?: number }): Promise<void> {
    // intentional no-op
  };

  return txFn as unknown as PGliteSql;
}
