/**
 * Ingestion worker entry point — TS port of `worker/csj_worker/main.py`.
 *
 * CLI surface (using minimal argv parsing — no extra deps):
 *
 *   tsx src/main.ts                          # daemon loop
 *   tsx src/main.ts --once                   # one cycle then exit
 *   tsx src/main.ts sync --connection-id ID  # sync a single connection
 *
 * Environment
 * -----------
 *   DATABASE_URL                  default: postgresql://skywalqr@localhost:5432/crypto_spread_journal
 *   DESKTOP_MODE=1                use pglite UNIX socket (`DESKTOP_SOCKET_PATH`)
 *   DESKTOP_SOCKET_PATH           absolute path to pglite-socket
 *   CREDENTIALS_MASTER_KEY        required at startup
 *   WORKER_POLL_INTERVAL_SECONDS  default: 300
 *   WORKER_LOOKBACK_DAYS          default: 30 (first sync cap; ignored if watermark set)
 *   WORKER_LOG_LEVEL              default: info
 *   WORKER_LOG_PRETTY=1           force pino-pretty output
 *
 * Crash consistency: each fill page is its own transaction. Watermark only
 * advances after fills commit. SIGTERM/SIGINT triggers graceful shutdown.
 */
import * as dbx from './db.js';
import { log } from './log.js';
import { getAdapter } from './adapters/index.js';
import type { ExchangeAdapter, FetchWindow } from './adapters/base.js';
import {
  AdapterAuthError,
  AdapterError,
  AdapterPermissionError,
  AdapterRateLimitedError,
  AdapterUnsupportedError,
} from './adapters/base.js';
import type { ConnectionStatus, Credentials } from './types.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Per-connection sync
// ---------------------------------------------------------------------------

interface SyncResult {
  status: 'ok' | 'error' | 'skipped';
  reason?: string;
  fillsAdded?: number;
  pages?: number;
  lastFillAt?: string | null;
}

async function syncOneConnection(
  sql: dbx.SqlClient,
  row: dbx.ConnectionRow,
  opts: { lookbackDays: number },
): Promise<SyncResult> {
  const baseCtx = {
    connectionId: row.id,
    exchange: row.exchangeCode,
    label: row.label,
    userId: row.userId,
  };
  log.info(baseCtx, 'sync.start');

  let adapter: ExchangeAdapter | null;
  try {
    adapter = getAdapter(row.exchangeCode);
  } catch (err) {
    if (err instanceof AdapterUnsupportedError) {
      log.warn(
        { ...baseCtx, err: err.message },
        'sync.adapter_not_yet_ported',
      );
      return { status: 'skipped', reason: 'adapter_not_yet_ported' };
    }
    throw err;
  }
  if (!adapter) {
    log.warn(baseCtx, 'sync.adapter_not_implemented');
    return { status: 'skipped', reason: 'adapter_not_implemented' };
  }

  let credentials: Credentials | null;
  try {
    credentials = dbx.decryptConnectionCredentials(row);
  } catch (err) {
    log.error(
      { ...baseCtx, err: (err as Error).name },
      'sync.decrypt_failed',
    );
    await markErrorInOwnTx(sql, row.id, 'error', 'Credential decryption failed (key mismatch?)');
    return { status: 'error', reason: 'decrypt_failed' };
  }
  if (!credentials) {
    log.info({ ...baseCtx, connectionType: row.connectionType }, 'sync.skip_incomplete_credentials');
    return { status: 'skipped', reason: 'incomplete_credentials' };
  }

  // Mark syncing in its own tx so the UI sees the transition immediately.
  await dbx.markConnectionSyncing(sql, row.id);

  const now = new Date();
  const since = row.lastSyncAt ?? new Date(now.getTime() - opts.lookbackDays * 86400_000);
  const until = now;
  const window: FetchWindow = { since, until };

  let fillsAdded = 0;
  let pages = 0;
  let lastFillAt: Date | null = row.lastFillAt;

  try {
    for await (const page of adapter.fetchFills(credentials, window)) {
      if (page.length === 0) continue;
      pages += 1;
      const inserted = await dbx.insertFills(sql, {
        userId: row.userId,
        exchangeConnectionId: row.id,
        fills: page,
      });
      fillsAdded += inserted;
      const pageLast = page.reduce<Date>(
        (acc, f) => (f.filledAt > acc ? f.filledAt : acc),
        new Date(0),
      );
      if (!lastFillAt || pageLast > lastFillAt) lastFillAt = pageLast;

      log.info(
        {
          ...baseCtx,
          page: pages,
          rows: page.length,
          inserted,
          pageLast: pageLast.toISOString(),
        },
        'sync.page_committed',
      );
    }
  } catch (err) {
    return await handleAdapterError(sql, row, baseCtx, err, fillsAdded);
  }

  await dbx.markConnectionSynced(sql, row.id, {
    fillsAdded,
    lastFillAt,
  });

  log.info({ ...baseCtx, fillsAdded, pages }, 'sync.complete');
  return {
    status: 'ok',
    fillsAdded,
    pages,
    lastFillAt: lastFillAt ? lastFillAt.toISOString() : null,
  };
}

async function handleAdapterError(
  sql: dbx.SqlClient,
  row: dbx.ConnectionRow,
  baseCtx: Record<string, unknown>,
  err: unknown,
  fillsAdded: number,
): Promise<SyncResult> {
  if (err instanceof AdapterAuthError) {
    log.warn({ ...baseCtx, errorMsg: err.message.slice(0, 200) }, 'sync.auth_failed');
    await markErrorInOwnTx(sql, row.id, 'auth_failed', err.message);
    return { status: 'error', reason: 'auth_failed', fillsAdded };
  }
  if (err instanceof AdapterPermissionError) {
    log.warn({ ...baseCtx, errorMsg: err.message.slice(0, 200) }, 'sync.permission');
    await markErrorInOwnTx(sql, row.id, 'auth_failed', `Permission: ${err.message}`);
    return { status: 'error', reason: 'permission', fillsAdded };
  }
  if (err instanceof AdapterRateLimitedError) {
    log.warn(
      { ...baseCtx, retryAfter: err.retryAfter, errorMsg: err.message.slice(0, 200) },
      'sync.rate_limited',
    );
    await markErrorInOwnTx(sql, row.id, 'rate_limited', err.message);
    return { status: 'error', reason: 'rate_limited', fillsAdded };
  }
  if (err instanceof AdapterError) {
    log.warn(
      { ...baseCtx, code: err.code, errorMsg: err.message.slice(0, 200) },
      'sync.adapter_error',
    );
    await markErrorInOwnTx(sql, row.id, 'error', err.message);
    return { status: 'error', reason: err.code, fillsAdded };
  }

  // Generic exception — log type + minimal context. Never include raw repr.
  const e = err as Error;
  log.error(
    { ...baseCtx, err: e.name, errorMsg: (e.message ?? '').slice(0, 200) },
    'sync.unexpected_error',
  );
  await markErrorInOwnTx(sql, row.id, 'error', `${e.name}: ${e.message}`);
  return { status: 'error', reason: 'unexpected', fillsAdded };
}

async function markErrorInOwnTx(
  sql: dbx.SqlClient,
  connectionId: string,
  status: ConnectionStatus,
  message: string,
): Promise<void> {
  try {
    await dbx.markConnectionError(sql, connectionId, { status, message });
  } catch (err) {
    log.error(
      { connectionId, err: (err as Error).name },
      'sync.status_update_failed',
    );
  }
}

// ---------------------------------------------------------------------------
// One-shot cycle: sync every eligible connection
// ---------------------------------------------------------------------------

async function runOnce(opts: { lookbackDays: number }): Promise<{
  connectionsSynced: number;
  fillsAdded: number;
}> {
  const sql = dbx.getSql();
  const summary = { connectionsSynced: 0, fillsAdded: 0 };

  const recovered = await dbx.recoverOrphanedSyncing(sql);
  if (recovered > 0) {
    log.warn({ count: recovered }, 'cycle.recovered_orphans');
  }

  const connections = await dbx.listSyncableConnections(sql);
  log.info({ connectionCount: connections.length }, 'cycle.start');

  if (connections.length === 0) {
    log.info('cycle.no_connections');
  }
  for (const row of connections) {
    const result = await syncOneConnection(sql, row, opts);
    if (result.status === 'ok') {
      summary.connectionsSynced += 1;
      summary.fillsAdded += result.fillsAdded ?? 0;
    }
  }

  // TODO: matcher (not in this session's scope).

  log.info(summary, 'cycle.complete');
  return summary;
}

// ---------------------------------------------------------------------------
// Single-connection mode
// ---------------------------------------------------------------------------

async function runSingleConnection(
  connectionId: string,
  opts: { lookbackDays: number },
): Promise<number> {
  const sql = dbx.getSql();
  const row = await dbx.getConnection(sql, connectionId);
  if (!row) {
    log.error({ connectionId }, 'single.not_found');
    return 2;
  }
  const result = await syncOneConnection(sql, row, opts);
  return result.status === 'ok' ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Daemon loop
// ---------------------------------------------------------------------------

async function runDaemon(opts: {
  pollIntervalSeconds: number;
  lookbackDays: number;
}): Promise<void> {
  let stop = false;
  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const signalHandler = (sig: NodeJS.Signals) => {
    log.info({ signal: sig }, 'daemon.signal');
    stop = true;
    resolveStop?.();
  };
  process.on('SIGTERM', signalHandler);
  process.on('SIGINT', signalHandler);

  log.info(
    {
      pollIntervalSeconds: opts.pollIntervalSeconds,
      lookbackDays: opts.lookbackDays,
    },
    'daemon.start',
  );

  while (!stop) {
    try {
      await runOnce({ lookbackDays: opts.lookbackDays });
    } catch (err) {
      log.error(
        { err: (err as Error).name, message: (err as Error).message },
        'daemon.cycle_crashed',
      );
    }
    if (stop) break;

    // Wait for either the interval or a stop signal.
    // The timer is intentionally NOT unref()'d — it must keep the event loop
    // alive so SIGTERM has something to interrupt.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, opts.pollIntervalSeconds * 1000);
      const cleanup = () => clearTimeout(timer);
      stopPromise.then(() => {
        cleanup();
        resolve();
      });
    });
  }

  log.info('daemon.stopped');
}

// ---------------------------------------------------------------------------
// Argv parsing — minimal, no extra dep
// ---------------------------------------------------------------------------

interface ParsedArgs {
  cmd: 'daemon' | 'once' | 'sync';
  connectionId?: string;
  lookbackDays: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const lookbackDays = envInt('WORKER_LOOKBACK_DAYS', 30);
  const parsed: ParsedArgs = { cmd: 'daemon', lookbackDays };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--once':
        parsed.cmd = 'once';
        i += 1;
        break;
      case 'sync': {
        parsed.cmd = 'sync';
        i += 1;
        while (i < args.length) {
          const sub = args[i];
          if (sub === '--connection-id') {
            const value = args[i + 1];
            if (!value) throw new Error('--connection-id requires a value');
            parsed.connectionId = value;
            i += 2;
          } else if (sub === '--lookback-days') {
            const value = args[i + 1];
            if (!value) throw new Error('--lookback-days requires a value');
            parsed.lookbackDays = Number.parseInt(value, 10);
            i += 2;
          } else {
            i += 1;
          }
        }
        break;
      }
      case '--lookback-days': {
        const value = args[i + 1];
        if (!value) throw new Error('--lookback-days requires a value');
        parsed.lookbackDays = Number.parseInt(value, 10);
        i += 2;
        break;
      }
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        i += 1;
        break;
    }
  }
  return parsed;
}

function printUsage(): void {
  // eslint-disable-next-line no-console -- usage text is for humans
  console.log(`csj-worker-ts — Crypto Spread Journal ingestion worker (TS)

Usage:
  tsx src/main.ts                            # daemon loop
  tsx src/main.ts --once                     # single cycle then exit
  tsx src/main.ts sync --connection-id <id>  # sync a single connection

Environment:
  DATABASE_URL                  Postgres URL (default: local)
  DESKTOP_MODE=1                use pglite UNIX socket
  DESKTOP_SOCKET_PATH           absolute path to pglite-socket
  CREDENTIALS_MASTER_KEY        required at startup (openssl rand -base64 32)
  WORKER_POLL_INTERVAL_SECONDS  default 300
  WORKER_LOOKBACK_DAYS          default 30 (first sync window)
  WORKER_LOG_LEVEL              default info
  WORKER_LOG_PRETTY=1           force pretty stdout
`);
}

function redactUrl(url: string): string {
  // Mask password in postgresql://user:pass@host/db
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '<unparseable-database-url>';
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv);

  // Fail fast if master key missing — every code path needs it.
  try {
    // Side-effect: throws on missing/invalid env.
    await import('./crypto.js').then((m) => {
      // Run a no-op decrypt to validate the env var format.
      void m;
      if (!process.env.CREDENTIALS_MASTER_KEY) {
        throw new Error(
          'CREDENTIALS_MASTER_KEY env var is required. Generate with: openssl rand -base64 32',
        );
      }
      // Re-validate base64 length:
      const key = Buffer.from(process.env.CREDENTIALS_MASTER_KEY, 'base64');
      if (key.length !== 32) {
        throw new Error('CREDENTIALS_MASTER_KEY must decode to 32 bytes');
      }
    });
  } catch (err) {
    log.error({ hint: (err as Error).message }, 'startup.no_master_key');
    return 2;
  }

  const databaseUrl = dbx.resolveDatabaseUrl();
  log.info(
    {
      databaseUrl: redactUrl(databaseUrl),
      lookbackDays: args.lookbackDays,
      cmd: args.cmd,
    },
    'startup.config',
  );

  try {
    if (args.cmd === 'sync') {
      if (!args.connectionId) {
        log.error('sync command requires --connection-id');
        return 2;
      }
      return await runSingleConnection(args.connectionId, {
        lookbackDays: args.lookbackDays,
      });
    }
    if (args.cmd === 'once') {
      await runOnce({ lookbackDays: args.lookbackDays });
      return 0;
    }
    const poll = envInt('WORKER_POLL_INTERVAL_SECONDS', 300);
    await runDaemon({ pollIntervalSeconds: poll, lookbackDays: args.lookbackDays });
    return 0;
  } catch (err) {
    log.error(
      { err: (err as Error).name, message: (err as Error).message },
      'startup.crashed',
    );
    return 1;
  } finally {
    await dbx.closeSql();
  }
}

main().then((rc) => {
  process.exit(rc);
}).catch((err) => {
  log.error({ err: (err as Error).message }, 'startup.fatal');
  process.exit(1);
});
