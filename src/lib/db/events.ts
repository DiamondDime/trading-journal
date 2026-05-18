/**
 * event_log DB helpers (v5).
 *
 * event_log is the movement / accounting table. It is NOT part of the
 * activity supertype — it lives next to it so the trader can journal
 * bridges, conversions, transfers, deposits, withdrawals, NFT trades and
 * losses for cost-basis reconciliation and tax-lot tracking without
 * polluting the activity-shaped polymorphic view.
 *
 * The wizard owns one POST entry-point (`createEventLog`); the list / detail
 * pages and the row-edit form share the read + update helpers below.
 */
import { sql } from '@/lib/db/client';
import type {
  CreateEventLogData,
  UpdateEventLogData,
} from '@/lib/db/zod-schemas';
import type {
  ActivityId,
  EventLogId,
  MovementEventKind,
  UserId,
  Decimal,
  Iso8601,
} from '@/types/canonical';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Row shape returned to the page layer. postgres.js camelCase transform turns
// snake_case columns into camelCase keys; we mirror the EventLog type from
// canonical.ts but in postgres.js's casing.
// ---------------------------------------------------------------------------

export interface EventLogRow {
  id:                EventLogId;
  userId:            UserId;
  kind:              MovementEventKind;
  occurredAt:        Iso8601;
  asset:             string | null;
  amount:            Decimal | null;
  usdValue:          Decimal | null;
  fromVenue:         string | null;
  toVenue:           string | null;
  txHash:            string | null;
  chain:             string | null;
  feeUsd:            Decimal | null;
  description:       string | null;
  relatedActivityId: ActivityId | null;
  createdAt:         Iso8601;
  updatedAt:         Iso8601;
}

export interface ListEventsFilters {
  /** Filter to specific kinds. */
  kind?:    MovementEventKind[];
  /** Inclusive lower bound on occurred_at (ISO). */
  since?:   string;
  /** Inclusive upper bound on occurred_at (ISO). */
  until?:   string;
  /** Asset prefix match (case-insensitive). */
  asset?:   string;
  /** Pagination. */
  limit?:   number;
  offset?:  number;
  /** Sort field — defaults to occurred_at desc. */
  sort?:    'occurred_at' | 'created_at' | 'usd_value';
  sortDir?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listEvents(
  userId: string,
  filters: ListEventsFilters = {},
): Promise<EventLogRow[]> {
  const {
    kind,
    since,
    until,
    asset,
    limit = 50,
    offset = 0,
    sort = 'occurred_at',
    sortDir = 'desc',
  } = filters;

  // Whitelist sort field + direction so we can safely interpolate.
  const sortField = sort === 'created_at'
    ? sql`created_at`
    : sort === 'usd_value'
      ? sql`usd_value`
      : sql`occurred_at`;
  const sortDirSql = sortDir === 'asc' ? sql`asc` : sql`desc`;

  const rows = await sql<EventLogRow[]>`
    SELECT *
    FROM public.event_log
    WHERE user_id = ${userId}::uuid
      ${kind && kind.length > 0
        ? sql`AND kind = ANY(${kind}::movement_event_kind[])`
        : sql``}
      ${since  ? sql`AND occurred_at >= ${since}::timestamptz`  : sql``}
      ${until  ? sql`AND occurred_at <= ${until}::timestamptz`  : sql``}
      ${asset
        ? sql`AND asset ILIKE ${`${asset}%`}`
        : sql``}
    ORDER BY ${sortField} ${sortDirSql}, id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Counts (used by sidebar + analytics)
// ---------------------------------------------------------------------------

/** Total event_log rows for the user (no filtering). */
export async function countEvents(userId: string): Promise<number> {
  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM public.event_log
    WHERE user_id = ${userId}::uuid
  `;
  return Number(count);
}

/** event_log breakdown by kind. Keys = MovementEventKind values. */
export async function countEventsByKind(
  userId: string,
): Promise<Record<MovementEventKind, number>> {
  const rows = await sql<{ kind: MovementEventKind; count: string }[]>`
    SELECT kind, count(*)::text AS count
    FROM public.event_log
    WHERE user_id = ${userId}::uuid
    GROUP BY kind
  `;
  const out: Record<MovementEventKind, number> = {
    bridge:     0,
    convert:    0,
    transfer:   0,
    deposit:    0,
    withdrawal: 0,
    nft_trade:  0,
    loss:       0,
    other:      0,
  };
  for (const r of rows) out[r.kind] = Number(r.count);
  return out;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getEvent(
  userId: string,
  id: string,
): Promise<EventLogRow | null> {
  const rows = await sql<EventLogRow[]>`
    SELECT *
    FROM public.event_log
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createEventLog(
  userId: string,
  input: CreateEventLogData,
): Promise<{ id: string }> {
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO public.event_log (
      user_id, kind, occurred_at,
      asset, amount, usd_value,
      from_venue, to_venue,
      tx_hash, chain, fee_usd,
      description, related_activity_id
    ) VALUES (
      ${userId}::uuid, ${input.kind}::movement_event_kind,
      ${input.occurred_at}::timestamptz,
      ${input.asset ?? null},
      ${input.amount ?? null},
      ${input.usd_value ?? null},
      ${input.from_venue ?? null},
      ${input.to_venue ?? null},
      ${input.tx_hash ?? null},
      ${input.chain ?? null},
      ${input.fee_usd ?? null},
      ${input.description ?? null},
      ${input.related_activity_id ?? null}
    )
    RETURNING id
  `;
  return { id };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Patch an event_log row. Returns false when the row doesn't exist or isn't
 * owned by `userId` so the API layer can 404 cleanly. Absent keys are left
 * untouched; `null` is intentionally distinct from "not set" (the zod
 * schema accepts nullable values) — clear a field by sending `null`.
 *
 * Uses postgres.js's `sql(patches)` helper-style update — builds the SET
 * clause from a snake_case object so we only touch columns the caller asked
 * to change.
 */
export async function updateEventLog(
  userId: string,
  id: string,
  patch: UpdateEventLogData,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;

  const patches: Record<string, unknown> = {};
  if (patch.kind                !== undefined) patches.kind                = patch.kind;
  if (patch.occurred_at         !== undefined) patches.occurred_at         = patch.occurred_at;
  if (patch.asset               !== undefined) patches.asset               = patch.asset;
  if (patch.amount              !== undefined) patches.amount              = patch.amount;
  if (patch.usd_value           !== undefined) patches.usd_value           = patch.usd_value;
  if (patch.from_venue          !== undefined) patches.from_venue          = patch.from_venue;
  if (patch.to_venue            !== undefined) patches.to_venue            = patch.to_venue;
  if (patch.tx_hash             !== undefined) patches.tx_hash             = patch.tx_hash;
  if (patch.chain               !== undefined) patches.chain               = patch.chain;
  if (patch.fee_usd             !== undefined) patches.fee_usd             = patch.fee_usd;
  if (patch.description         !== undefined) patches.description         = patch.description;
  if (patch.related_activity_id !== undefined) patches.related_activity_id = patch.related_activity_id;

  if (Object.keys(patches).length === 0) {
    // Confirm ownership so callers can tell "no change" vs "not found" apart.
    const existing = await getEvent(userId, id);
    return existing !== null;
  }

  const rows = await sql<{ id: string }[]>`
    UPDATE public.event_log
    SET ${sql(patches)}
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteEventLog(
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM public.event_log
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}
