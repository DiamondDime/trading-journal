/**
 * PGlite shim — end-to-end tests against an in-memory PGlite instance.
 *
 * We test against real PGlite (not a mock) because the whole point of the
 * shim is that the resulting SQL must execute identically to what postgres.js
 * would produce. A mock would let buggy SQL through.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createPGliteSql, type PGliteSql } from "../../src/lib/db/pglite-shim";

let db: PGlite;
let sql: PGliteSql;

beforeAll(async () => {
  db = await PGlite.create({
    dataDir: undefined, // in-memory
    extensions: { citext, pgcrypto },
  });
  sql = createPGliteSql(db);

  // Schema fixture — small enough to grok, covers every type the shim must
  // handle. Includes a snake_case column so we can verify the camelCase
  // transform on every read.
  await db.exec(`
    create table widgets (
      id            uuid primary key default gen_random_uuid(),
      name          text not null,
      quantity      integer not null default 0,
      price_usd     numeric(20, 8) not null default 0,
      tags          text[] not null default '{}',
      payload       jsonb not null default '{}'::jsonb,
      created_at    timestamptz not null default now(),
      deleted_at    timestamptz
    );
  `);
});

afterAll(async () => {
  await db.close();
});

describe("PGlite shim — tagged template basics", () => {
  it("returns rows from a simple SELECT", async () => {
    await db.query("insert into widgets (name) values ('alpha'), ('beta')");
    const rows = await sql<{ name: string }>`select name from widgets order by name`;
    expect(rows.map((r) => r.name)).toEqual(["alpha", "beta"]);
  });

  it("parameterises interpolated values with $1, $2, ...", async () => {
    const rows = await sql<{ name: string }>`
      select name from widgets where name = ${"alpha"}
    `;
    expect(rows).toEqual([{ name: "alpha" }]);
  });

  it("respects multiple parameter slots in order", async () => {
    await db.exec("delete from widgets; insert into widgets (name, quantity) values ('x', 1), ('y', 2), ('z', 3)");
    const rows = await sql<{ name: string }>`
      select name from widgets
      where quantity >= ${2} and quantity <= ${3}
      order by quantity
    `;
    expect(rows.map((r) => r.name)).toEqual(["y", "z"]);
  });

  it("passes through PG type coercion: numeric stays a string", async () => {
    await db.exec("delete from widgets");
    await sql`insert into widgets (name, price_usd) values (${"pricey"}, ${"1234.56789012"})`;
    const rows = await sql<{ priceUsd: string }>`select price_usd from widgets`;
    expect(rows[0].priceUsd).toBe("1234.56789012");
    expect(typeof rows[0].priceUsd).toBe("string");
  });

  it("passes through PG type coercion: text array stays an array", async () => {
    await db.exec("delete from widgets");
    await sql`insert into widgets (name, tags) values (${"a"}, ${["one", "two", "three"]})`;
    const rows = await sql<{ tags: string[] }>`select tags from widgets`;
    expect(rows[0].tags).toEqual(["one", "two", "three"]);
  });

  it("passes through PG type coercion: jsonb survives roundtrip", async () => {
    await db.exec("delete from widgets");
    const payload = { foo: "bar", nested: { count: 3 } };
    await sql`insert into widgets (name, payload) values (${"j"}, ${payload})`;
    const rows = await sql<{ payload: typeof payload }>`select payload from widgets`;
    expect(rows[0].payload).toEqual(payload);
  });

  it("converts SQL NULL to JS null (never undefined)", async () => {
    await db.exec("delete from widgets");
    await db.exec("insert into widgets (name, deleted_at) values ('z', null)");
    const rows = await sql<{ deletedAt: Date | null }>`select deleted_at from widgets`;
    expect(rows[0].deletedAt).toBeNull();
  });

  it("undefined params serialize as NULL", async () => {
    await db.exec("delete from widgets");
    await sql`insert into widgets (name, deleted_at) values (${"z"}, ${undefined})`;
    const rows = await sql<{ deletedAt: Date | null }>`select deleted_at from widgets`;
    expect(rows[0].deletedAt).toBeNull();
  });
});

describe("PGlite shim — camelCase transform", () => {
  it("renames snake_case columns to camelCase on every row", async () => {
    await db.exec("delete from widgets; insert into widgets (name, price_usd) values ('a', 1), ('b', 2)");
    const rows = await sql<{ priceUsd: string; createdAt: Date }>`
      select price_usd, created_at from widgets order by name
    `;
    expect(rows[0]).toHaveProperty("priceUsd");
    expect(rows[0]).toHaveProperty("createdAt");
    expect(rows[0]).not.toHaveProperty("price_usd");
  });

  it("handles columns with no underscores", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('a')");
    const rows = await sql<{ name: string }>`select name from widgets`;
    expect(rows[0]).toHaveProperty("name");
  });

  it("handles columns with multiple underscores", async () => {
    const rows = await sql<{ pgIsInRecovery: boolean }>`
      select pg_is_in_recovery() as pg_is_in_recovery
    `;
    expect(rows[0]).toHaveProperty("pgIsInRecovery");
  });
});

describe("PGlite shim — nested template fragments", () => {
  it("inlines a nested Query into the outer template", async () => {
    await db.exec("delete from widgets; insert into widgets (name, quantity) values ('a', 1), ('b', 2), ('c', 3)");
    const tail = sql`and quantity > ${1}`;
    const rows = await sql<{ name: string }>`
      select name from widgets where name is not null ${tail} order by name
    `;
    expect(rows.map((r) => r.name)).toEqual(["b", "c"]);
  });

  it("renumbers $N placeholders across nested fragments", async () => {
    await db.exec("delete from widgets; insert into widgets (name, quantity) values ('a', 5)");
    const inner = sql`and quantity = ${5}`;
    const rows = await sql<{ name: string }>`
      select name from widgets where name = ${"a"} ${inner}
    `;
    expect(rows).toEqual([{ name: "a" }]);
  });

  it("handles empty conditional fragments (sql``)", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('a'), ('b')");
    const conditional = false ? sql`and name = 'a'` : sql``;
    const rows = await sql<{ name: string }>`
      select name from widgets where name is not null ${conditional} order by name
    `;
    expect(rows).toHaveLength(2);
  });
});

describe("PGlite shim — identifier helpers", () => {
  it("escapes a plain identifier", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('a')");
    const rows = await sql<{ name: string }>`select name from ${sql("widgets")}`;
    expect(rows[0].name).toBe("a");
  });

  it("escapes a dotted identifier (table.col)", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('a')");
    const rows = await sql<{ name: string }>`
      select w.name from widgets w order by ${sql("w.name")}
    `;
    expect(rows[0].name).toBe("a");
  });

  it("renders an array of identifiers as a comma-separated list", async () => {
    await db.exec("delete from widgets; insert into widgets (name, quantity) values ('a', 7)");
    const rows = await sql<{ name: string; quantity: number }>`
      select ${sql(["name", "quantity"])} from widgets
    `;
    expect(rows[0]).toEqual({ name: "a", quantity: 7 });
  });

  it("renders an object as a SET clause with parameterised values", async () => {
    await db.exec("delete from widgets; insert into widgets (name, quantity) values ('a', 1)");
    await sql`update widgets set ${sql({ name: "renamed", quantity: 42 })} where name = ${"a"}`;
    const rows = await sql<{ name: string; quantity: number }>`select name, quantity from widgets`;
    expect(rows[0]).toEqual({ name: "renamed", quantity: 42 });
  });
});

describe("PGlite shim — transactions", () => {
  it("commits when callback resolves", async () => {
    await db.exec("delete from widgets");
    await sql.begin(async (tx) => {
      await tx`insert into widgets (name) values (${"tx-commit"})`;
    });
    const rows = await sql<{ name: string }>`select name from widgets`;
    expect(rows.map((r) => r.name)).toContain("tx-commit");
  });

  it("rolls back when callback throws", async () => {
    await db.exec("delete from widgets");
    await expect(
      sql.begin(async (tx) => {
        await tx`insert into widgets (name) values (${"tx-rollback"})`;
        throw new Error("intentional rollback trigger");
      }),
    ).rejects.toThrow("intentional rollback trigger");
    const rows = await sql<{ name: string }>`select name from widgets`;
    expect(rows.map((r) => r.name)).not.toContain("tx-rollback");
  });

  it("returns the callback's return value", async () => {
    await db.exec("delete from widgets");
    const result = await sql.begin(async (tx) => {
      const rows = await tx<{ count: string }>`
        select count(*)::text as count from widgets
      `;
      return rows[0].count;
    });
    expect(result).toBe("0");
  });

  it("supports nested begin via SAVEPOINT (outer commits, inner rolls back)", async () => {
    await db.exec("delete from widgets");
    await sql.begin(async (tx) => {
      await tx`insert into widgets (name) values (${"outer-row"})`;
      await expect(
        tx.begin(async (inner) => {
          await inner`insert into widgets (name) values (${"inner-row"})`;
          throw new Error("inner rollback");
        }),
      ).rejects.toThrow("inner rollback");
      // Outer still alive
      await tx`insert into widgets (name) values (${"after-rollback"})`;
    });
    const rows = await sql<{ name: string }>`select name from widgets order by name`;
    const names = rows.map((r) => r.name);
    expect(names).toContain("outer-row");
    expect(names).toContain("after-rollback");
    expect(names).not.toContain("inner-row");
  });

  it("nested begin can commit successfully", async () => {
    await db.exec("delete from widgets");
    await sql.begin(async (tx) => {
      await tx.begin(async (inner) => {
        await inner`insert into widgets (name) values (${"nested-ok"})`;
      });
    });
    const rows = await sql<{ name: string }>`select name from widgets`;
    expect(rows.map((r) => r.name)).toContain("nested-ok");
  });

  it("tx supports identifier and SET helpers like top-level sql", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('original')");
    await sql.begin(async (tx) => {
      await tx`update widgets set ${tx({ name: "tx-renamed" })} where name = ${"original"}`;
    });
    const rows = await sql<{ name: string }>`select name from widgets`;
    expect(rows[0].name).toBe("tx-renamed");
  });
});

describe("PGlite shim — sql.unsafe", () => {
  it("executes raw SQL with positional params", async () => {
    await db.exec("delete from widgets");
    await sql.unsafe("insert into widgets (name, quantity) values ($1, $2)", ["raw", 99]);
    const rows = await sql.unsafe<{ name: string; quantity: number }>(
      "select name, quantity from widgets",
    );
    expect(rows[0]).toEqual({ name: "raw", quantity: 99 });
  });

  it("camelCases unsafe results too", async () => {
    await db.exec("delete from widgets; insert into widgets (name) values ('a')");
    const rows = await sql.unsafe<{ priceUsd: string }>("select price_usd from widgets");
    expect(rows[0]).toHaveProperty("priceUsd");
  });
});

describe("PGlite shim — query laziness", () => {
  it("does not execute until awaited", async () => {
    await db.exec("delete from widgets");
    // Construct a Query but never await it.
    const _q = sql`insert into widgets (name) values (${"never-runs"})`;
    void _q; // suppress unused
    const rows = await sql<{ count: string }>`select count(*)::text as count from widgets`;
    expect(rows[0].count).toBe("0");
  });

  it("executes once even if awaited multiple times", async () => {
    await db.exec("delete from widgets");
    const q = sql`insert into widgets (name) values (${"once"}) returning name`;
    const r1 = await q;
    const r2 = await q;
    expect(r1).toEqual(r2);
    const rows = await sql<{ count: string }>`select count(*)::text as count from widgets where name = ${"once"}`;
    expect(rows[0].count).toBe("1");
  });
});
