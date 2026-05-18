/**
 * POST /api/mcp/v1/get_spread
 *
 * Returns full detail for a single spread: the summary fields, legs (one row
 * per leg, position-linked + manual), fills (atomic exchange executions),
 * and the journal note when present.
 *
 * Source-of-truth tables read:
 *   • public.activity              — supertype
 *   • public.activity_spread       — subtype
 *   • public.spread_pnl (view)     — P&L decomposition + realized APR/bps
 *   • public.spread_legs           — N legs per spread
 *   • public.positions             — JOIN target for position-linked legs
 *   • public.exchange_catalog      — display_name for the leg's exchange
 *   • public.fills                 — fills under each leg's position
 *   • public.notes                 — journal note (1:1 with the spread)
 *   • public.activity_tag          — free-form setup tags
 *
 * SECURITY: every SELECT enumerates its columns. We never touch
 * exchange_connections here so credential ciphertext cannot leak via this
 * endpoint. Comments at the column lists below remind future maintainers.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Decimal as DecimalCtor } from 'decimal.js';
import { sql } from '@/lib/db/client';
import {
  mcpError,
  mcpOk,
  readMcpUserId,
  verifyMcpRequest,
} from '@/lib/mcp/auth';
import {
  rowToSpreadSummary,
  rowToSpreadLegDetail,
  rowToSpreadFillDetail,
  type SpreadRowForSummary,
  type SpreadLegRowForDetail,
  type SpreadFillRowForDetail,
} from '@/lib/mcp/serialize';
import type { SpreadDetail, SpreadNoteDetail } from '@/lib/mcp/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Body = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const refused = verifyMcpRequest(req);
  if (refused) return refused;

  const userId = readMcpUserId();
  if (!userId) {
    return mcpError(
      'misconfigured',
      'APP_USER_ID is not set on the server',
      500,
    );
  }

  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return mcpError('bad_request', 'Body is not valid JSON', 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return mcpError('bad_request', parsed.error.message, 400);
  }

  // Non-UUID inputs route to a clean 404 rather than crashing the
  // postgres::uuid parser. Same pattern as src/lib/db/satellite.ts.
  if (!UUID_RE.test(parsed.data.id)) {
    return mcpError('not_found', 'spread not found', 404);
  }
  const spreadId = parsed.data.id;

  try {
    // 1. Summary row — activity + activity_spread + spread_pnl join. The
    //    same shape list_spreads uses, plus a few extra fields we expose at
    //    detail level (capital, realized APR, bps captured, exit plan,
    //    open-intent target). EXPLICIT columns — no SELECT * — because in
    //    the future a join could otherwise pull credential ciphertext from
    //    exchange_connections if someone refactors without thinking.
    const summaryRows = await sql<
      (SpreadRowForSummary & {
        spreadType: string;
        variant: string | null;
        capitalDeployedUsd: string | null;
        realizedApr: string | null;
        bpsCapturedNet: string | null;
        targetAprAtOpen: string | null;
        expectedHoldingDays: number | null;
        exitPlan: string | null;
      })[]
    >`
      WITH note_agg AS (
        SELECT n.activity_id, true AS has_note
        FROM public.notes n
        WHERE n.user_id = ${userId}::uuid
          AND n.deleted_at IS NULL
      ),
      tag_agg AS (
        SELECT t.activity_id, string_agg(t.tag, E'\x1f') AS free_form_tags
        FROM public.activity_tag t
        WHERE t.user_id = ${userId}::uuid
        GROUP BY t.activity_id
      )
      SELECT
        sp.spread_id                AS spread_id,
        a.status::text              AS status,
        sp.spread_type              AS spread_type,
        sp.variant                  AS variant,
        sp.primary_base             AS primary_base,
        a.name                      AS name,
        a.opened_at                 AS opened_at,
        a.closed_at                 AS closed_at,
        sp.net_pnl_quote            AS net_pnl_quote,
        sp.fees_quote               AS fees_quote,
        sp.funding_received_quote   AS funding_received_quote,
        sp.exchanges                AS exchanges,
        a.regime_tags               AS regime_tags,
        a.custom_tags               AS custom_tags,
        COALESCE(na.has_note, false) AS has_note,
        ta.free_form_tags           AS free_form_tags,
        sp.capital_deployed_usd     AS capital_deployed_usd,
        sp.realized_apr             AS realized_apr,
        sp.bps_captured_net         AS bps_captured_net,
        sp.target_apr_at_open       AS target_apr_at_open,
        sp.expected_holding_days    AS expected_holding_days,
        asp.exit_plan               AS exit_plan
      FROM public.activity a
      JOIN public.activity_spread asp ON asp.activity_id = a.id
      JOIN public.spread_pnl sp       ON sp.spread_id = a.id
      LEFT JOIN note_agg na ON na.activity_id = a.id
      LEFT JOIN tag_agg  ta ON ta.activity_id = a.id
      WHERE a.id = ${spreadId}::uuid
        AND a.user_id = ${userId}::uuid
        AND a.type = 'spread'
        AND a.deleted_at IS NULL
      LIMIT 1
    `;

    if (!summaryRows[0]) {
      return mcpError('not_found', 'spread not found', 404);
    }
    const summaryRow = summaryRows[0];
    const summary = rowToSpreadSummary(summaryRow);

    // 2. Legs — explicit column list. The JOIN to positions is LEFT (manual
    //    legs don't have a position_id). The JOIN to exchange_catalog is
    //    LEFT because the position's connection may have been deleted.
    //
    //    NOTE: we deliberately do NOT join public.exchange_connections. That
    //    table holds credential ciphertext columns and there's no need to
    //    touch it for legs — exchange display name comes from
    //    exchange_catalog and is keyed by the position's connection's
    //    exchange code. We resolve that via positions → connection_id →
    //    exchange_code via a separate lookup that ONLY reads exchange_code
    //    (no ciphertext). The query below combines them in one join chain.
    const legRows = await sql<SpreadLegRowForDetail[]>`
      SELECT
        sl.id                       AS id,
        sl.leg_index                AS leg_index,
        sl.role                     AS role,
        sl.position_id              AS position_id,
        sl.symbol                   AS manual_symbol,
        sl.exchange_label           AS manual_exchange_label,
        sl.side                     AS manual_side,
        sl.qty                      AS manual_qty,
        sl.entry_price              AS manual_entry_price,
        sl.exit_price               AS manual_exit_price,
        sl.fees_usd                 AS manual_fees_usd,
        sl.instrument_type          AS manual_instrument_type,
        p.instrument                AS position_instrument,
        p.instrument_type::text     AS position_instrument_type,
        p.side::text                AS position_side,
        p.total_qty                 AS position_qty,
        p.avg_entry_price           AS position_avg_entry_price,
        p.avg_exit_price            AS position_avg_exit_price,
        p.total_fees_quote          AS position_fees_quote,
        p.opened_at                 AS position_opened_at,
        p.closed_at                 AS position_closed_at,
        ec.display_name             AS exchange_display_name
      FROM public.spread_legs sl
      LEFT JOIN public.positions p
        ON p.id = sl.position_id AND p.user_id = ${userId}::uuid
      LEFT JOIN public.exchange_connections conn
        ON conn.id = p.exchange_connection_id
      LEFT JOIN public.exchange_catalog ec
        ON ec.code = conn.exchange_code
      WHERE sl.activity_id = ${spreadId}::uuid
      ORDER BY sl.leg_index ASC, sl.id ASC
    `;

    // 3. Fills — atomic executions for every position under this spread.
    //    Empty for manual-only spreads (those have NULL position_id and so
    //    no fills land in the result set).
    //
    //    EXPLICIT COLUMNS. We deliberately do not return raw_payload (audit
    //    blob) and do not join exchange_connections (credential ciphertext).
    const fillRows = await sql<(SpreadFillRowForDetail & { legIndex: number })[]>`
      SELECT
        f.id                        AS id,
        sl.leg_index                AS leg_index,
        f.side::text                AS side,
        f.qty                       AS qty,
        f.price                     AS price,
        f.notional                  AS notional,
        f.fee                       AS fee,
        f.fee_currency              AS fee_currency,
        f.is_maker                  AS is_maker,
        f.executed_at               AS executed_at
      FROM public.fills f
      JOIN public.spread_legs sl ON sl.position_id = f.position_id
      WHERE sl.activity_id = ${spreadId}::uuid
        AND f.user_id = ${userId}::uuid
      ORDER BY sl.leg_index ASC, f.executed_at ASC
    `;

    // 4. Note. v1 enforces uq_one_note_per_activity so we expect 0 or 1.
    const noteRows = await sql<
      {
        id: string;
        body: string;
        entryRationale: string | null;
        exitConclusion: string | null;
        createdAt: Date | string;
        updatedAt: Date | string;
      }[]
    >`
      SELECT
        n.id                AS id,
        n.body              AS body,
        n.entry_rationale   AS entry_rationale,
        n.exit_conclusion   AS exit_conclusion,
        n.created_at        AS created_at,
        n.updated_at        AS updated_at
      FROM public.notes n
      WHERE n.activity_id = ${spreadId}::uuid
        AND n.user_id     = ${userId}::uuid
        AND n.deleted_at IS NULL
      LIMIT 1
    `;

    const note: SpreadNoteDetail | null = noteRows[0]
      ? {
          id: noteRows[0].id,
          body: noteRows[0].body,
          entry_rationale: noteRows[0].entryRationale,
          exit_conclusion: noteRows[0].exitConclusion,
          created_at:
            noteRows[0].createdAt instanceof Date
              ? noteRows[0].createdAt.toISOString()
              : String(noteRows[0].createdAt),
          updated_at:
            noteRows[0].updatedAt instanceof Date
              ? noteRows[0].updatedAt.toISOString()
              : String(noteRows[0].updatedAt),
        }
      : null;

    const detail: SpreadDetail = {
      ...summary,
      spread_type: summaryRow.spreadType,
      variant: summaryRow.variant,
      capital_deployed_usd:
        summaryRow.capitalDeployedUsd !== null
          ? new DecimalCtor(summaryRow.capitalDeployedUsd).toString()
          : null,
      realized_apr:
        summaryRow.realizedApr !== null
          ? new DecimalCtor(summaryRow.realizedApr).toString()
          : null,
      bps_captured_net:
        summaryRow.bpsCapturedNet !== null
          ? new DecimalCtor(summaryRow.bpsCapturedNet).toString()
          : null,
      target_apr_at_open:
        summaryRow.targetAprAtOpen !== null
          ? new DecimalCtor(summaryRow.targetAprAtOpen).toString()
          : null,
      expected_holding_days: summaryRow.expectedHoldingDays,
      exit_plan: summaryRow.exitPlan,
      legs: legRows.map(rowToSpreadLegDetail),
      fills: fillRows.map(rowToSpreadFillDetail),
      note,
    };

    return mcpOk(detail);
  } catch (err) {
    console.error('[mcp] get_spread failed', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
    });
    return mcpError('internal', 'get_spread query failed', 500);
  }
}
