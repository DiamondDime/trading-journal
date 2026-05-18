/**
 * POST /api/import/csv — manual CSV trade-history import.
 *
 * Why this exists
 * ───────────────
 * Auto-import via ccxt covers ~13 venues. The journal also has to support
 * users on Backpack / Vertex / Drift / Hyperliquid spot / etc. where we
 * either don't have an adapter or the venue doesn't ship an API. CSV is
 * the universal escape valve. The endpoint accepts a file, runs the
 * exchange-specific parser, and either previews (`dryRun=true`) or
 * persists into the `fills` table — same atomic unit the worker writes,
 * so downstream aggregations don't need to know where the data came from.
 *
 * Form fields:
 *   • file:       the CSV/TSV body (required, <= 10MB)
 *   • exchange:   one of SUPPORTED_EXCHANGES (required)
 *   • connection: uuid of an existing exchange_connection (required for write)
 *   • dryRun:     "true"|"false" — if true, returns first 10 normalized rows
 *                 without writing anything. Defaults to false.
 *   • dateFrom:   optional ISO date — drop fills executed_at < this
 *   • dateTo:     optional ISO date — drop fills executed_at > this
 *
 * On write: inserts use ON CONFLICT (exchange_connection_id, raw_exchange_id)
 * DO NOTHING — same idempotency contract as the worker's insert_fills.
 * Returns { inserted, skipped, errors } so the UI can show what happened.
 *
 * Cap: 10MB. Bigger exports should be split. The whole file is read into
 * memory once for parsing — streaming the parser would be premature; 10MB
 * is ~50K rows of binance export, which is more than a year of active
 * trading for most users.
 */
import { withAuth } from '@/lib/api/handler';
import { errors, ok } from '@/lib/api/response';
import { sql } from '@/lib/db/client';
import {
  parseCsv,
  filterByDateRange,
  isSupportedExchange,
  type NormalizedFill,
} from '@/lib/csv-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const PREVIEW_ROWS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withAuth(async (req, { userId }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errors.badRequest('VALIDATION', 'Expected multipart/form-data');
  }

  const file = form.get('file');
  const exchangeRaw = form.get('exchange');
  const connectionRaw = form.get('connection');
  const dryRunRaw = form.get('dryRun');
  const dateFromRaw = form.get('dateFrom');
  const dateToRaw = form.get('dateTo');

  if (!(file instanceof File)) {
    return errors.badRequest('VALIDATION', 'Missing `file` field');
  }
  if (file.size <= 0) {
    return errors.badRequest('VALIDATION', 'File is empty');
  }
  if (file.size > MAX_BYTES) {
    return errors.unprocessable(
      'FILE_TOO_LARGE',
      `CSV exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)}MB cap`,
    );
  }
  if (typeof exchangeRaw !== 'string' || !isSupportedExchange(exchangeRaw)) {
    return errors.badRequest(
      'VALIDATION',
      'Missing or invalid `exchange` field',
    );
  }

  const dryRun = dryRunRaw === 'true' || dryRunRaw === 'on';
  const dateFrom = typeof dateFromRaw === 'string' && dateFromRaw
    ? new Date(dateFromRaw)
    : null;
  const dateTo = typeof dateToRaw === 'string' && dateToRaw
    ? new Date(dateToRaw)
    : null;
  if (dateFrom && Number.isNaN(dateFrom.getTime())) {
    return errors.badRequest('VALIDATION', '`dateFrom` is not a valid date');
  }
  if (dateTo && Number.isNaN(dateTo.getTime())) {
    return errors.badRequest('VALIDATION', '`dateTo` is not a valid date');
  }

  let content: string;
  try {
    content = await file.text();
  } catch {
    return errors.badRequest('VALIDATION', 'Could not read file as UTF-8');
  }

  const result = parseCsv(content, exchangeRaw);
  const filtered = filterByDateRange(result.fills, dateFrom, dateTo);

  if (dryRun) {
    return ok({
      dryRun: true,
      total: filtered.length,
      preview: filtered.slice(0, PREVIEW_ROWS),
      errors: result.errors,
    });
  }

  // Write path requires a connection id. We don't auto-create connections
  // here — the user has to add the exchange in Settings → Exchanges first
  // so that fills tie to a tangible row.
  if (typeof connectionRaw !== 'string' || !UUID_RE.test(connectionRaw)) {
    return errors.badRequest(
      'VALIDATION',
      'Missing or invalid `connection` field (required for non-dry-run import)',
    );
  }

  // Verify the connection belongs to the current user. The fills table FKs
  // to exchange_connections but we want a friendly 404 instead of a 500.
  const ownership = await sql<{ id: string; exchangeCode: string }[]>`
    SELECT id, exchange_code
    FROM public.exchange_connections
    WHERE id = ${connectionRaw}::uuid
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (ownership.length === 0) {
    return errors.notFound('Exchange connection not found');
  }

  const { inserted, skipped } = await insertFills(userId, connectionRaw, filtered);

  return ok({
    dryRun: false,
    inserted,
    skipped,
    errors: result.errors,
  });
});

/**
 * Insert a batch of normalized fills. Mirrors the worker's `insert_fills`
 * idempotency contract: `ON CONFLICT (exchange_connection_id, raw_exchange_id)
 * DO NOTHING` so re-uploads of the same file are no-ops.
 *
 * We insert one row at a time inside a single transaction. Doing this with
 * a `VALUES (...), (...), (...)` template is fiddly with postgres.js when
 * the count is dynamic, and CSV imports are not a hot path — 50K rows
 * inserted serially through a local socket takes ~5s, well within UI
 * tolerance. If that becomes a bottleneck, switch to `sql.values()` batch
 * inserts later.
 */
async function insertFills(
  userId: string,
  connectionId: string,
  fills: NormalizedFill[],
): Promise<{ inserted: number; skipped: number }> {
  if (fills.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  await sql.begin(async (tx) => {
    for (const f of fills) {
      const result = await tx<{ id: string }[]>`
        INSERT INTO public.fills (
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
        ) VALUES (
          ${userId}::uuid,
          ${connectionId}::uuid,
          ${f.rawExchangeId},
          ${f.instrument},
          ${f.instrumentType}::instrument_type,
          ${f.side}::fill_side,
          ${f.positionSide as string | null},
          ${f.reduceOnly},
          ${f.qty}::numeric,
          ${f.price}::numeric,
          ${f.notional}::numeric,
          ${f.fee}::numeric,
          ${f.feeCurrency},
          ${f.feeKind}::fee_kind,
          ${f.isMaker},
          ${f.liquidityRole},
          ${f.orderId},
          ${JSON.stringify({ source: 'csv_import' })}::jsonb,
          ${JSON.stringify(f.rawPayload)}::jsonb,
          ${f.executedAt}::timestamptz
        )
        ON CONFLICT (exchange_connection_id, raw_exchange_id) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) inserted++;
    }
  });

  return { inserted, skipped: fills.length - inserted };
}
