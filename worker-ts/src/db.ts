/**
 * DB layer for the worker — TS port of `worker/csj_worker/db.py`.
 *
 * Uses `postgres.js` with `postgres.camel` so DB rows arrive in camelCase
 * (matching the conventions in `src/lib/db/client.ts`). The worker can
 * connect to:
 *  - A regular Postgres via `DATABASE_URL` (e.g. local pg, Hetzner pg).
 *  - PGlite-as-a-socket when launched from the Electron desktop app: the
 *    main process spawns a pglite-socket and exposes its UNIX-socket
 *    endpoint via `DATABASE_URL=socket:/path/to/socket`. postgres.js handles
 *    UNIX sockets through `host=...` + `port=undefined`.
 *
 * Transaction discipline mirrors Python:
 *  - Each fill page is its own transaction (crash-consistent replays).
 *  - Connection-state updates run in their own transactions so the UI sees
 *    `syncing` / `error` immediately.
 */
import postgres from 'postgres';

import { type EncryptedField, decryptCredential } from './crypto.js';
import { log } from './log.js';
import { aggregateFills } from './positions.js';
import type {
  ApiKeyCredentials,
  CanonicalFill,
  CanonicalFundingEvent,
  CanonicalInstrument,
  ConnectionRow,
  ConnectionStatus,
  Credentials,
  Exchange,
  FeeKind,
  InstrumentKind,
  PositionSide,
  PositionStatus,
  Side,
  WalletCredentials,
} from './types.js';

// Re-export so callers (main.ts) can import without depending on types.ts directly.
export type { ConnectionRow } from './types.js';

// ---------------------------------------------------------------------------
// Singleton SQL client
// ---------------------------------------------------------------------------

export type SqlClient = ReturnType<typeof postgres>;

const DEFAULT_DATABASE_URL =
  'postgresql://skywalqr@localhost:5432/crypto_spread_journal';

let _sql: SqlClient | undefined;

/**
 * Resolve the DB connection string. Honors:
 *  - `DATABASE_URL` (preferred — webapp mode + most local dev)
 *  - `DESKTOP_MODE=1` + `DESKTOP_SOCKET_PATH=/tmp/csj.sock` → UNIX socket
 *    (Electron + pglite-socket).
 */
export function resolveDatabaseUrl(): string {
  if (process.env.DESKTOP_MODE === '1' && process.env.DESKTOP_SOCKET_PATH) {
    // postgres.js accepts a `socket:` prefix to indicate a UNIX socket; for
    // safety also export a normal pg URL pointing at the socket directory.
    return `postgresql:///crypto_spread_journal?host=${encodeURIComponent(
      process.env.DESKTOP_SOCKET_PATH,
    )}`;
  }
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function getSql(): SqlClient {
  if (_sql) return _sql;
  const conn = resolveDatabaseUrl();
  _sql = postgres(conn, {
    onnotice: () => {},
    transform: postgres.camel,
    // The worker is the only writer for these rows; small pool is fine.
    max: 4,
    // Generous statement timeout — adapter pages can be large.
    idle_timeout: 30,
  });
  return _sql;
}

export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = undefined;
  }
}

// ---------------------------------------------------------------------------
// Connection-row helpers
// ---------------------------------------------------------------------------

function rowToConnection(r: Record<string, unknown>): ConnectionRow {
  // Manual mapping (rather than zod parse) because postgres.js already
  // gives us camelCase keys and proper `Date` / `Buffer` types. Zod parsing
  // is reserved for adapter-side data we don't fully trust.
  const buf = (v: unknown): Buffer | null => {
    if (v === null || v === undefined) return null;
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);
    throw new Error('Expected bytea / Uint8Array');
  };

  return {
    id: String(r.id),
    userId: String(r.userId),
    exchangeCode: String(r.exchangeCode),
    label: String(r.label),
    connectionType: r.connectionType as ConnectionRow['connectionType'],
    apiKeyCiphertext: buf(r.apiKeyCiphertext),
    apiKeyNonce: buf(r.apiKeyNonce),
    apiSecretCiphertext: buf(r.apiSecretCiphertext),
    apiSecretNonce: buf(r.apiSecretNonce),
    apiPassphraseCiphertext: buf(r.apiPassphraseCiphertext),
    apiPassphraseNonce: buf(r.apiPassphraseNonce),
    walletAddressCiphertext: buf(r.walletAddressCiphertext),
    walletAddressNonce: buf(r.walletAddressNonce),
    walletChain: (r.walletChain as string | null) ?? null,
    status: r.status as ConnectionRow['status'],
    lastSyncAt: (r.lastSyncAt as Date | null) ?? null,
    lastSyncCursor: (r.lastSyncCursor as string | null) ?? null,
    lastFillAt: (r.lastFillAt as Date | null) ?? null,
  };
}

const CONNECTION_COLUMNS = `
  id::text                          as id,
  user_id::text                     as user_id,
  exchange_code,
  label,
  connection_type,
  api_key_ciphertext,
  api_key_nonce,
  api_secret_ciphertext,
  api_secret_nonce,
  api_passphrase_ciphertext,
  api_passphrase_nonce,
  wallet_address_ciphertext,
  wallet_address_nonce,
  wallet_chain,
  status::text                      as status,
  last_sync_at,
  last_sync_cursor,
  last_fill_at
`;

/**
 * Reset any connection stuck in `syncing` back to `active` at daemon start.
 * v1 assumption: a single worker per database (no heartbeats yet).
 */
export async function recoverOrphanedSyncing(sql: SqlClient): Promise<number> {
  const result = await sql.unsafe(`
    update public.exchange_connections
       set status='active',
           status_message='recovered from orphaned syncing state'
     where status='syncing' and deleted_at is null
  `);
  return result.count ?? 0;
}

/**
 * Active or rate-limited connections that should be considered for sync.
 * Order: never-synced first, then oldest watermark.
 */
export async function listSyncableConnections(
  sql: SqlClient,
): Promise<ConnectionRow[]> {
  const rows = await sql.unsafe(`
    select ${CONNECTION_COLUMNS}
      from public.exchange_connections
     where deleted_at is null
       and status::text in ('active', 'rate_limited')
     order by last_sync_at nulls first
  `);
  return rows.map(rowToConnection);
}

export async function getConnection(
  sql: SqlClient,
  connectionId: string,
): Promise<ConnectionRow | null> {
  const rows = await sql.unsafe(
    `
      select ${CONNECTION_COLUMNS}
        from public.exchange_connections
       where deleted_at is null
         and id::text = $1
    `,
    [connectionId],
  );
  const head = rows[0];
  return head ? rowToConnection(head) : null;
}

export async function markConnectionSyncing(
  sql: SqlClient,
  connectionId: string,
): Promise<void> {
  await sql.unsafe(
    `
      update public.exchange_connections
         set status='syncing', status_message=null
       where id::text = $1
    `,
    [connectionId],
  );
}

export async function markConnectionSynced(
  sql: SqlClient,
  connectionId: string,
  opts: { fillsAdded: number; lastFillAt: Date | null },
): Promise<void> {
  await sql.unsafe(
    `
      update public.exchange_connections
         set status='active',
             status_message=null,
             last_sync_at=now(),
             last_fill_at=coalesce($2, last_fill_at),
             fills_synced=fills_synced + $3
       where id::text = $1
    `,
    [connectionId, opts.lastFillAt, opts.fillsAdded],
  );
}

export async function markConnectionError(
  sql: SqlClient,
  connectionId: string,
  opts: { status: ConnectionStatus; message: string },
): Promise<void> {
  // Truncate the message to avoid pathological row growth. Secrets should
  // already be masked upstream; this is belt-and-braces.
  const safeMsg = (opts.message ?? '').slice(0, 1000);
  await sql.unsafe(
    `
      update public.exchange_connections
         set status = $2::connection_status,
             status_message = $3
       where id::text = $1
    `,
    [connectionId, opts.status, safeMsg],
  );
}

// ---------------------------------------------------------------------------
// Credentials decryption
// ---------------------------------------------------------------------------

/**
 * Materialize a `Credentials` object from a connection row's ciphertexts.
 * Returns null when the row is missing the required encrypted fields (e.g.
 * a `pending` row not yet populated by the API route).
 *
 * NEVER log the return value of this function.
 */
export function decryptConnectionCredentials(
  row: ConnectionRow,
): Credentials | null {
  if (row.connectionType === 'api_key') {
    if (
      !row.apiKeyCiphertext ||
      !row.apiKeyNonce ||
      !row.apiSecretCiphertext ||
      !row.apiSecretNonce
    ) {
      return null;
    }
    const apiKey = decryptCredential({
      ciphertext: row.apiKeyCiphertext,
      nonce: row.apiKeyNonce,
    });
    const apiSecret = decryptCredential({
      ciphertext: row.apiSecretCiphertext,
      nonce: row.apiSecretNonce,
    });
    let passphrase: string | null = null;
    if (row.apiPassphraseCiphertext && row.apiPassphraseNonce) {
      passphrase = decryptCredential({
        ciphertext: row.apiPassphraseCiphertext,
        nonce: row.apiPassphraseNonce,
      });
    }
    const creds: ApiKeyCredentials = {
      mode: 'api_key',
      apiKey,
      apiSecret,
      passphrase,
    };
    return creds;
  }

  if (row.connectionType === 'wallet_address') {
    if (!row.walletAddressCiphertext || !row.walletAddressNonce) return null;
    const address = decryptCredential({
      ciphertext: row.walletAddressCiphertext,
      nonce: row.walletAddressNonce,
    });
    const creds: WalletCredentials = {
      mode: 'wallet_address',
      address,
      chain: row.walletChain,
    };
    return creds;
  }

  log.warn(
    { connectionType: row.connectionType, connectionId: row.id },
    'db.decrypt.unknown_connection_type',
  );
  return null;
}

/** For symmetry; exported so adapters/tests can build an EncryptedField. */
export function bytesToEncryptedField(
  ciphertext: Buffer,
  nonce: Buffer,
): EncryptedField {
  return { ciphertext, nonce };
}

// ---------------------------------------------------------------------------
// Fill persistence
// ---------------------------------------------------------------------------

/**
 * Insert a page of fills idempotently. Returns the count actually inserted.
 *
 * Uses `ON CONFLICT (exchange_connection_id, raw_exchange_id) DO NOTHING`,
 * so replays of the same page after a crash are no-ops. The caller wraps
 * each page in its own transaction (see `main.ts`).
 */
export async function insertFills(
  sql: SqlClient,
  opts: {
    userId: string;
    exchangeConnectionId: string;
    fills: CanonicalFill[];
  },
): Promise<number> {
  if (opts.fills.length === 0) return 0;

  // Per-row insert mirroring the Python loop. Page sizes are small (≤1000
  // rows) so the overhead vs a multi-row insert is negligible; the win is
  // that we keep `ON CONFLICT DO NOTHING` semantics per-row plus explicit
  // enum casts via `::instrument_type` etc.
  //
  // JSON serialisation: postgres.js' `sql.json()` wrapper is for tagged
  // templates; with `sql.unsafe` + $-placeholders we pass a string and
  // cast via `::jsonb`.
  let inserted = 0;
  for (const f of opts.fills) {
    const result = await sql.unsafe(
      `
        insert into public.fills (
          user_id,
          exchange_connection_id,
          raw_exchange_id,
          instrument,
          instrument_type,
          side,
          position_side,
          reduce_only,
          qty,
          price,
          notional,
          fee,
          fee_currency,
          fee_kind,
          is_maker,
          liquidity_role,
          order_id,
          trade_metadata,
          raw_payload,
          executed_at
        ) values (
          $1, $2, $3, $4, $5::instrument_type, $6::fill_side, $7::position_side,
          $8, $9, $10, $11, $12, $13, $14::fee_kind, $15, $16, $17, $18::jsonb, $19::jsonb, $20
        )
        on conflict (exchange_connection_id, raw_exchange_id) do nothing
      `,
      [
        opts.userId,
        opts.exchangeConnectionId,
        f.externalTradeId,
        f.instrument.rawSymbol,
        f.instrument.kind,
        f.side,
        f.positionSide ?? null,
        f.reduceOnly ?? null,
        f.qty,
        f.price,
        f.notional,
        f.fee,
        f.feeCurrency,
        f.feeKind,
        f.isMaker,
        f.liquidity ?? null,
        f.externalOrderId ?? null,
        JSON.stringify({}),
        JSON.stringify(f.raw ?? {}),
        f.filledAt,
      ],
    );
    inserted += result.count ?? 0;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Positions aggregation — TS port of `positions_aggregator.py`'s DB layer.
//
// The pure fills→positions fold lives in `./positions.ts` (`aggregateFills`).
// Here we mirror the Python DB plumbing: load unmatched fills, run the fold,
// then INSERT position rows + link `fills.position_id`.
//
// The DB trigger `tg_fills_recompute_position` (migration 005) owns the money
// math (`realized_pnl_quote`, `total_fees_quote`, `total_funding_quote`); the
// worker only writes position STRUCTURE and links fills. We never compute or
// write those columns.
//
// Divergence from Python (deliberate): the Python aggregator tracks DB `id`s
// and attaches fills by `id`. The TS `aggregateFills` carries
// `CanonicalFill.externalTradeId` (== the DB `fills.raw_exchange_id` column),
// so `attachFills` matches on `raw_exchange_id`.
// ---------------------------------------------------------------------------

/**
 * Best-effort parse of `(base, quote)` from a venue symbol.
 *
 * The DB only stores the venue symbol text (`fills.instrument`); the canonical
 * `(base, quote)` split is not persisted. `aggregateFills` only ever reads
 * `instrument.rawSymbol` (for grouping) and threads `instrument` through to the
 * emitted `CanonicalPosition`, so the split here is purely cosmetic for the
 * INSERT path — `insertPosition` writes the raw symbol text, not base/quote.
 * We still populate the fields so the reconstructed `CanonicalFill` is a valid
 * shape.
 *
 * Handles ccxt-style `BASE/QUOTE` and `BASE/QUOTE:SETTLE`. Symbols without a
 * `/` separator (bare `BASEQUOTE`) are not split — we yield `('', '')` rather
 * than guess a boundary wrongly.
 */
function splitSymbol(rawSymbol: string): { base: string; quote: string } {
  // Strip a `:SETTLE` suffix (perp/future settlement currency).
  const core = rawSymbol.split(':')[0] ?? rawSymbol;
  const slash = core.indexOf('/');
  if (slash > 0) {
    return {
      base: core.slice(0, slash),
      quote: core.slice(slash + 1),
    };
  }
  // No separator — give up on a clean split rather than guessing wrongly.
  return { base: '', quote: '' };
}

/** Row shape returned by the unmatched-fills query (post-camelCase). */
interface UnmatchedFillRow {
  rawExchangeId: string;
  orderId: string | null;
  instrument: string;
  instrumentType: string;
  side: string;
  positionSide: string | null;
  reduceOnly: boolean | null;
  qty: string;
  price: string;
  notional: string;
  fee: string;
  feeCurrency: string;
  feeKind: string;
  isMaker: boolean;
  liquidityRole: string | null;
  rawPayload: unknown;
  executedAt: Date;
  exchangeCode: string;
}

/**
 * Load every unmatched fill for a connection, oldest first, as
 * `CanonicalFill` objects ready for `aggregateFills`.
 *
 * TS port of Python `_load_unmatched_fills`, scoped to one connection
 * (`exchange_connection_id`) rather than a user. We join
 * `exchange_connections` only to recover `exchange_code` for the
 * `CanonicalInstrument.exchange` field.
 *
 * `externalTradeId` is mapped from the DB `raw_exchange_id` column — this is
 * the value `attachFills` matches on.
 */
export async function loadUnmatchedFills(
  sql: SqlClient,
  exchangeConnectionId: string,
): Promise<CanonicalFill[]> {
  const rows = (await sql.unsafe(
    `
      select
        f.raw_exchange_id,
        f.order_id,
        f.instrument,
        f.instrument_type::text   as instrument_type,
        f.side::text              as side,
        f.position_side::text     as position_side,
        f.reduce_only,
        f.qty::text               as qty,
        f.price::text             as price,
        f.notional::text          as notional,
        f.fee::text               as fee,
        f.fee_currency,
        f.fee_kind::text          as fee_kind,
        f.is_maker,
        f.liquidity_role,
        f.raw_payload,
        f.executed_at,
        c.exchange_code
      from public.fills f
      join public.exchange_connections c
        on c.id = f.exchange_connection_id
     where f.exchange_connection_id = $1::uuid
       and f.position_id is null
     order by f.executed_at asc, f.raw_exchange_id asc
    `,
    [exchangeConnectionId],
  )) as unknown as UnmatchedFillRow[];

  return rows.map((r): CanonicalFill => {
    const { base, quote } = splitSymbol(r.instrument);
    const instrument: CanonicalInstrument = {
      exchange: r.exchangeCode as Exchange,
      kind: r.instrumentType as InstrumentKind,
      base,
      quote,
      expiry: null,
      rawSymbol: r.instrument,
    };
    return {
      externalTradeId: r.rawExchangeId,
      externalOrderId: r.orderId,
      instrument,
      side: r.side as Side,
      qty: r.qty,
      price: r.price,
      notional: r.notional,
      fee: r.fee,
      feeCurrency: r.feeCurrency,
      feeKind: r.feeKind as FeeKind,
      isMaker: r.isMaker,
      liquidity: (r.liquidityRole as 'maker' | 'taker' | null) ?? null,
      positionSide: (r.positionSide as PositionSide | null) ?? null,
      reduceOnly: r.reduceOnly ?? null,
      filledAt: r.executedAt,
      raw:
        r.rawPayload && typeof r.rawPayload === 'object'
          ? (r.rawPayload as Record<string, unknown>)
          : {},
    };
  });
}

/**
 * Insert one `positions` row. Returns the new id (text uuid).
 *
 * TS port of Python `_insert_position`. Rules mirrored exactly:
 *  - `margin_mode` = `'spot'` for spot instruments, `'cross'` otherwise.
 *  - `total_qty` is deliberately set to `qty_open` (NOT lifetime qty) — the
 *    Python aggregator does the same for spread-matcher compatibility.
 *  - We never write `realized_pnl_quote` / `total_fees_quote` /
 *    `total_funding_quote`; the DB trigger owns those.
 */
export async function insertPosition(
  sql: SqlClient,
  opts: {
    userId: string;
    exchangeConnectionId: string;
    instrument: string;
    instrumentType: InstrumentKind;
    side: PositionSide;
    qtyOpen: string;
    avgEntryPrice: string;
    openedAt: Date;
    closedAt: Date | null;
    status: PositionStatus;
  },
): Promise<string> {
  // margin_mode: 'spot' for spot, 'cross' for derivatives (best default).
  const marginMode = opts.instrumentType === 'spot' ? 'spot' : 'cross';
  // total_qty mirrors qty_open — Python `_insert_position` does the same so
  // the spread matcher reads a consistent "current size" figure.
  const totalQty = opts.qtyOpen;
  const rows = await sql.unsafe(
    `
      insert into public.positions (
        user_id,
        exchange_connection_id,
        instrument,
        instrument_type,
        side,
        margin_mode,
        total_qty,
        qty_open,
        avg_entry_price,
        opened_at,
        closed_at,
        status
      ) values (
        $1::uuid, $2::uuid, $3, $4::instrument_type, $5::position_side,
        $6::margin_mode,
        $7, $8, $9,
        $10, $11, $12::position_status
      )
      returning id::text as id
    `,
    [
      opts.userId,
      opts.exchangeConnectionId,
      opts.instrument,
      opts.instrumentType,
      opts.side,
      marginMode,
      totalQty,
      opts.qtyOpen,
      opts.avgEntryPrice,
      opts.openedAt,
      opts.closedAt,
      opts.status,
    ],
  );
  const head = rows[0] as { id: string } | undefined;
  if (!head) {
    // The RETURNING clause guarantees a row; this is belt-and-braces.
    throw new Error('insertPosition: INSERT ... RETURNING produced no row');
  }
  return head.id;
}

/**
 * Set `fills.position_id` for the given fills. Returns the count updated.
 *
 * TS port of Python `_attach_fills`. Matches on `raw_exchange_id` (not `id`)
 * because `aggregateFills` carries `externalTradeId` values, which equal that
 * column. Re-checks `position_id IS NULL` so concurrent re-runs are safe.
 *
 * No-op (returns 0) on an empty id list — side-flip openers have empty
 * `fillIds` (the flip fill stays linked to the closed position).
 */
export async function attachFills(
  sql: SqlClient,
  exchangeConnectionId: string,
  positionId: string,
  externalTradeIds: readonly string[],
): Promise<number> {
  if (externalTradeIds.length === 0) return 0;
  // `raw_exchange_id` is a `text` column; cast the bound array to `text[]`
  // explicitly so Postgres can resolve the parameter type (mirrors the
  // Python aggregator's `any(%s::uuid[])` and the webapp's `ANY(..::text[])`).
  const result = await sql.unsafe(
    `
      update public.fills
         set position_id = $2::uuid
       where exchange_connection_id = $1::uuid
         and raw_exchange_id = any($3::text[])
         and position_id is null
    `,
    [exchangeConnectionId, positionId, externalTradeIds as string[]],
  );
  return result.count ?? 0;
}

/**
 * Build positions from a connection's unmatched fills.
 *
 * TS port of Python `aggregate_positions`, scoped to one connection. Loads
 * unmatched fills, folds them with `aggregateFills`, then per emitted position
 * INSERTs the row and links its fills. The caller owns the transaction
 * boundary (mirrors Python — "caller commits").
 *
 * Idempotent: re-running with no unmatched fills returns zero counters.
 */
export async function aggregateConnectionPositions(
  sql: SqlClient,
  exchangeConnectionId: string,
): Promise<{ positionsInserted: number; fillsAttached: number }> {
  const fills = await loadUnmatchedFills(sql, exchangeConnectionId);
  if (fills.length === 0) {
    return { positionsInserted: 0, fillsAttached: 0 };
  }

  // Recover user_id from the first fill's row is not possible (CanonicalFill
  // carries no user_id); read it from the connection instead.
  const connRows = await sql.unsafe(
    `select user_id::text as user_id from public.exchange_connections where id::text = $1`,
    [exchangeConnectionId],
  );
  const connHead = connRows[0] as { userId: string } | undefined;
  if (!connHead) {
    throw new Error(
      `aggregateConnectionPositions: connection ${exchangeConnectionId} not found`,
    );
  }
  const userId = connHead.userId;

  const aggregated = aggregateFills(fills, exchangeConnectionId);

  let positionsInserted = 0;
  let fillsAttached = 0;
  for (const agg of aggregated) {
    const positionId = await insertPosition(sql, {
      userId,
      exchangeConnectionId,
      instrument: agg.position.instrument.rawSymbol,
      instrumentType: agg.position.instrument.kind,
      side: agg.position.side,
      qtyOpen: agg.position.qtyOpen,
      avgEntryPrice: agg.position.avgEntryPrice,
      // `openedAt` is set by the aggregator from the first contributing fill;
      // `positions.opened_at` is NOT NULL so fall back defensively.
      openedAt: agg.position.openedAt ?? new Date(),
      closedAt: agg.closedAt,
      status: agg.status,
    });
    positionsInserted += 1;
    fillsAttached += await attachFills(
      sql,
      exchangeConnectionId,
      positionId,
      agg.fillIds,
    );
  }
  return { positionsInserted, fillsAttached };
}

// ---------------------------------------------------------------------------
// Funding-event persistence + linking — TS port of the Python funding path.
// ---------------------------------------------------------------------------

/**
 * Insert a page of funding events idempotently. Returns the count inserted.
 *
 * TS port of Python `insert_funding_events`. Uses `ON CONFLICT
 * (exchange_connection_id, raw_exchange_id) DO NOTHING` so page replays are
 * no-ops. `position_id` is left NULL — `linkFundingEvents` sets it once the
 * positions exist. Caller owns the transaction.
 *
 * Sign convention: `funding_events.amount` is SIGNED (positive = received,
 * negative = paid). The adapter emits an ABSOLUTE `amount` plus a `direction`
 * enum; we apply the sign here.
 *
 * Null `externalId`: the adapter-supplied `externalId` is preferred when
 * present; when null we synthesize a stable composite
 * `"<rawSymbol>-<occurredAtMs>"` — byte-identical to what the Python worker
 * does — so the idempotency key stays deterministic across re-syncs.
 */
export async function insertFundingEvents(
  sql: SqlClient,
  opts: {
    userId: string;
    exchangeConnectionId: string;
    events: readonly CanonicalFundingEvent[];
  },
): Promise<number> {
  if (opts.events.length === 0) return 0;

  let inserted = 0;
  for (const ev of opts.events) {
    // Sign the amount: received → positive, paid → negative.
    const signedAmount =
      ev.direction === 'received' ? ev.amount : `-${ev.amount}`;
    // raw_exchange_id: adapter external id when present, else a stable
    // composite (instrument + epoch-ms). Mirrors Python's fallback.
    const externalId =
      ev.externalId ??
      `${ev.instrument.rawSymbol}-${ev.occurredAt.getTime()}`;
    const result = await sql.unsafe(
      `
        insert into public.funding_events (
          user_id,
          exchange_connection_id,
          raw_exchange_id,
          instrument,
          amount,
          funding_rate,
          position_qty,
          currency,
          event_time,
          raw_payload
        ) values (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
        )
        on conflict (exchange_connection_id, raw_exchange_id) do nothing
      `,
      [
        opts.userId,
        opts.exchangeConnectionId,
        externalId,
        ev.instrument.rawSymbol,
        signedAmount,
        ev.fundingRate,
        ev.positionQty,
        ev.amountCurrency,
        ev.occurredAt,
        JSON.stringify(ev.raw ?? {}),
      ],
    );
    inserted += result.count ?? 0;
  }
  return inserted;
}

/**
 * Link unlinked funding events to the position open at the funding tick.
 *
 * TS port of Python `link_funding_events`, scoped to one connection. For each
 * `position_id IS NULL` funding event we pick the position whose lifecycle
 * (`opened_at <= event_time < coalesce(closed_at, 'infinity')`, same
 * `exchange_connection_id` + `instrument`) contains the event. Events with no
 * candidate position stay NULL and are retried next cycle. Returns the count
 * updated.
 *
 * Must run AFTER `aggregateConnectionPositions` — funding links to positions,
 * so the positions must exist first.
 */
export async function linkFundingEvents(
  sql: SqlClient,
  exchangeConnectionId: string,
): Promise<number> {
  const result = await sql.unsafe(
    `
      update public.funding_events fe
         set position_id = sub.position_id
        from (
            select fe2.id as fe_id,
                   p.id   as position_id
              from public.funding_events fe2
              join public.positions p
                on p.exchange_connection_id = fe2.exchange_connection_id
               and p.instrument = fe2.instrument
               and p.opened_at <= fe2.event_time
               and coalesce(p.closed_at, 'infinity'::timestamptz) > fe2.event_time
             where fe2.position_id is null
               and fe2.exchange_connection_id = $1::uuid
               and p.deleted_at is null
        ) as sub
       where fe.id = sub.fe_id
         and fe.position_id is null
    `,
    [exchangeConnectionId],
  );
  return result.count ?? 0;
}
