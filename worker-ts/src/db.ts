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
import type {
  ApiKeyCredentials,
  CanonicalFill,
  ConnectionRow,
  ConnectionStatus,
  Credentials,
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
