// ============================================================================
// src/app/add/trade/db.ts
//
// Wizard-owned DB layer. Lives here (not in src/lib/db/activity.ts) because the
// trade wizard owns its full create / update / picker query surface and the
// foundation's createTrade in activity.ts only writes a subset of the columns
// migration v5 added. Routing all trade writes through this module keeps the
// new fields (kind / leverage / margin_mode / target_price / stop_price /
// exit_plan / entry_thesis / fees split / funding / borrow / strategy_tag /
// tax_taxable / tax_jurisdiction) reachable from the wizard without forking
// the shared activity.ts helper.
//
// All money values stay as Decimal strings — never f64. The single f64 use is
// `parseDecForCompute` for derived APR / net-P&L preview math.
// ============================================================================
import "server-only";
import { sql } from "@/lib/db/client";
import type { CreateTradeData } from "@/lib/db/zod-schemas";

// ─── Exchange label → catalog code ─────────────────────────────────────────
// Migration 20260515000001 seeds these codes. Coinbase is NOT in the catalog
// — the wizard's UI exposed "Coinbase" historically and the previous mapping
// silently translated it to kraken, which is a data-correctness bug (a Kraken
// trade and a Coinbase trade are different events). v5 rejects unknown labels
// loudly so the form can surface a real error instead of inserting wrong data.
const EXCHANGE_LABEL_TO_CODE: Record<string, string> = {
  Binance: "binance",
  Bybit: "bybit",
  Hyperliquid: "hyperliquid",
  OKX: "okx",
  Deribit: "deribit",
  Phemex: "phemex",
  Bitget: "bitget",
  MEXC: "mexc",
  KuCoin: "kucoin",
  Kraken: "kraken",
  Gate: "gate",
  BingX: "bingx",
};

export function mapExchangeLabelToCode(label: string): string {
  const code = EXCHANGE_LABEL_TO_CODE[label];
  if (!code) {
    throw new Error(
      `Unknown exchange "${label}". Supported: ${Object.keys(EXCHANGE_LABEL_TO_CODE).join(", ")}.`,
    );
  }
  return code;
}

/**
 * Reverse lookup: catalog code → wizard label. Returns `null` for codes that
 * aren't in the mapping (e.g. a worker-imported `aster` row when the wizard
 * doesn't list Aster). Callers MUST decide what to render in that case —
 * silently falling back to "Binance" was the original v4 bug (Coinbase →
 * Kraken misattribution); we surface the unknown value instead.
 */
export function mapExchangeCodeToLabel(code: string): string | null {
  const entry = Object.entries(EXCHANGE_LABEL_TO_CODE).find(([, v]) => v === code);
  return entry?.[0] ?? null;
}

// ─── Manual connection sentinel ─────────────────────────────────────────────
// Mirrors lib/db/activity.ts:ensureManualConnection. positions.exchange_connection_id
// is NOT NULL; OTC/NFT/manual entries have no real exchange link, so we lazily
// provision one "_manual_entry" connection per user.
const MANUAL_CONN_LABEL = "_manual_entry";

async function ensureManualConnection(userId: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid
      AND label = ${MANUAL_CONN_LABEL}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (existing[0]) return existing[0].id;

  const [created] = await sql<{ id: string }[]>`
    INSERT INTO public.exchange_connections (
      user_id, exchange_code, label, connection_type, status, status_message
    ) VALUES (
      ${userId}::uuid, 'binance', ${MANUAL_CONN_LABEL}, 'api_key',
      'pending', 'sentinel for manual journal entries — never synced'
    )
    RETURNING id
  `;
  return created.id;
}

// ─── Picker query ───────────────────────────────────────────────────────────
// Shape consumed by /pick/page.tsx. One row per open position aggregated under
// (connection, instrument, opened-at-bucket). Multiple partial fills against
// the same logical position collapse via positions.id — the worker already
// rolls fills up by position_id, so we read positions directly and don't need
// a GROUP BY at this layer.
//
// `kind` is the wizard's selected discriminator. We map it to instrument_type
// so a spot trade hides perps and vice versa. dated_future/option are
// instrument_type='dated_future'/'option'; otc/nft never live in `positions`
// (they go straight to /fields with no pick option).
export interface OpenPositionRow {
  positionId: string;
  exchangeCode: string;
  exchangeLabel: string;
  symbol: string;
  instrument: "spot" | "perp" | "future";
  side: "long" | "short";
  qty: string;          // total_qty
  avgEntryPrice: string;
  openedAt: string;     // ISO
  feesPaid: string;
  capital: string;      // avg_entry_price * qty
  daysOpen: number;
}

export async function listOpenPositionsForUser(
  userId: string,
  filterKind: "spot" | "perp" | "dated_future" | null,
): Promise<OpenPositionRow[]> {
  // Only positions where no activity_trade already points at them — otherwise
  // submitting from /fields would trip the uq_trade_position unique constraint.
  // Filter by kind when one is provided.
  // Note: positions.instrument_type values come from the instrument_type enum
  //       defined in migration 20260515000001: 'spot' | 'perp' | 'dated_future' | 'option'.
  const kindFilter = filterKind
    ? sql`AND p.instrument_type = ${filterKind}::instrument_type`
    : sql``;

  const rows = await sql<
    {
      id: string;
      exchangeCode: string;
      symbol: string;
      instrumentType: "spot" | "perp" | "dated_future" | "option";
      side: "long" | "short";
      totalQty: string;
      avgEntryPrice: string;
      openedAt: string;
      totalFeesQuote: string;
    }[]
  >`
    SELECT p.id,
           ec.exchange_code AS "exchangeCode",
           p.instrument AS symbol,
           p.instrument_type AS "instrumentType",
           p.side,
           p.total_qty AS "totalQty",
           p.avg_entry_price AS "avgEntryPrice",
           p.opened_at AS "openedAt",
           p.total_fees_quote AS "totalFeesQuote"
      FROM public.positions p
      JOIN public.exchange_connections ec ON ec.id = p.exchange_connection_id
     WHERE p.user_id = ${userId}::uuid
       AND p.status = 'open'
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.activity_trade t
          WHERE t.position_id = p.id
       )
       ${kindFilter}
     ORDER BY p.opened_at DESC
     LIMIT 200
  `;

  const now = Date.now();
  return rows.map((r) => {
    const opened = new Date(r.openedAt).getTime();
    const qty = Number(r.totalQty);
    const px = Number(r.avgEntryPrice);
    const capital = Number.isFinite(qty * px) ? (qty * px).toString() : "0";
    const days =
      Number.isFinite(opened) && now > opened ? (now - opened) / 86_400_000 : 0;
    const instrument: "spot" | "perp" | "future" =
      r.instrumentType === "dated_future"
        ? "future"
        : r.instrumentType === "option"
          ? "future" // option positions get bucketed with "future" in the picker
          : r.instrumentType;
    return {
      positionId: r.id,
      exchangeCode: r.exchangeCode,
      // Unknown codes (e.g. a venue the wizard doesn't list yet) render as a
      // visible sentinel rather than silently misattributing to Binance. The
      // picker card surfaces this so the user can't accidentally journal a
      // trade against the wrong venue.
      exchangeLabel: mapExchangeCodeToLabel(r.exchangeCode) ?? "— unknown —",
      symbol: r.symbol,
      instrument,
      side: r.side,
      qty: r.totalQty,
      avgEntryPrice: r.avgEntryPrice,
      openedAt: r.openedAt,
      feesPaid: r.totalFeesQuote,
      capital,
      daysOpen: days,
    };
  });
}

export async function tradeExistsForPosition(positionId: string): Promise<boolean> {
  const rows = await sql<{ activityId: string }[]>`
    SELECT activity_id AS "activityId"
      FROM public.activity_trade
     WHERE position_id = ${positionId}::uuid
     LIMIT 1
  `;
  return rows.length > 0;
}

// ─── createTrade — extended write path ──────────────────────────────────────
// Writes every column the v5 schema exposes (target/stop, exit plan, fees
// split, perp leverage + margin + funding, borrow cost, strategy_tag,
// tax_taxable, tax_jurisdiction). Open trades are supported by deferring the
// position to status='open' with NULL avg_exit_price / closed_at; the activity
// row mirrors the open status.

export interface ExtendedTradeInput extends CreateTradeData {
  /** When non-empty, link this trade to an existing open position (auto path). */
  positionId?: string;
  /** Wizard status — 'open' allows nullable exit prices. */
  tradeStatus?: "open" | "closed" | "liquidated";
  /** Per-kind extension payloads. Validated by the action; persisted as columns. */
  entryThesis?: string;
  exitNote?: string;
  // OTC fields (kind='otc')
  counterparty?: string;
  settlementDate?: string;
  escrowMethod?: string;
  premiumOrDiscountBps?: string;
  // NFT fields (kind='nft')
  collection?: string;
  tokenId?: string;
  marketplace?: string;
  royaltyPct?: string;
  // Strategy + tax (activity supertype, v5)
  strategyTag?: string;
  taxTaxable?: boolean;
  taxJurisdiction?: string;
}

function parseDecForCompute(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function deriveTradeName(symbol: string, side: string, kind: string): string {
  const base = symbol.split(/[-/_]/)[0] || symbol;
  return `${base} ${side} · ${kind}`;
}

/**
 * Compose a free-form description blob for OTC / NFT trades whose
 * exchange-side semantics don't fit the standard fields. Persisted into the
 * activity_trade.entry_thesis column alongside whatever the user typed so the
 * detail page can render the full context without a separate metadata table.
 */
function composeKindAddendum(input: ExtendedTradeInput): string | null {
  const parts: string[] = [];
  if (input.kind === "otc") {
    if (input.counterparty) parts.push(`Counterparty: ${input.counterparty}`);
    if (input.settlementDate) parts.push(`Settlement: ${input.settlementDate}`);
    if (input.escrowMethod) parts.push(`Escrow: ${input.escrowMethod}`);
    if (input.premiumOrDiscountBps)
      parts.push(`Premium/Discount: ${input.premiumOrDiscountBps} bps`);
  } else if (input.kind === "nft") {
    if (input.collection) parts.push(`Collection: ${input.collection}`);
    if (input.tokenId) parts.push(`Token ID: ${input.tokenId}`);
    if (input.marketplace) parts.push(`Marketplace: ${input.marketplace}`);
    if (input.royaltyPct) parts.push(`Royalty: ${input.royaltyPct}%`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

function combineThesis(
  thesis: string | undefined,
  addendum: string | null,
): string | null {
  const blocks: string[] = [];
  if (thesis && thesis.trim()) blocks.push(thesis.trim());
  if (addendum) blocks.push(addendum);
  if (blocks.length === 0) return null;
  return blocks.join("\n\n");
}

export interface CreatedTrade {
  id: string;
}

export async function createTradeFromWizard(
  userId: string,
  input: ExtendedTradeInput,
): Promise<CreatedTrade> {
  const status = input.tradeStatus ?? "closed";
  const isOpen = status === "open";

  const opened = new Date(input.openedAt).toISOString();
  const closed = isOpen
    ? null
    : new Date(input.closedAt).toISOString();

  const qty = parseDecForCompute(input.qty);
  const entry = parseDecForCompute(input.entryPrice);
  const exit = parseDecForCompute(input.exitPrice);
  const capital = parseDecForCompute(input.capital);

  // Fees split. The wizard supplies feesEntry + feesExit when v5 is in play,
  // and falls back to a single `fees` total when the user hasn't broken it
  // out. Sum either way for the supertype's fees_usd column.
  const feesEntry = parseDecForCompute(input.feesEntry);
  const feesExit = parseDecForCompute(input.feesExit);
  const feesFallback = parseDecForCompute(input.fees);
  const feesTotal =
    feesEntry || feesExit ? feesEntry + feesExit : feesFallback;

  // Net only computes when both prices known.
  const dir = input.side === "short" ? -1 : 1;
  const gross = isOpen ? 0 : qty * (exit - entry) * dir;
  const net = isOpen ? 0 : gross - feesTotal;
  const daysHeld = isOpen
    ? 0
    : (new Date(closed!).getTime() - new Date(opened).getTime()) / 86_400_000;
  const realizedApr =
    !isOpen && capital > 0 && daysHeld > 0
      ? (net / capital) * (365 / daysHeld)
      : null;

  // Map UI exchange label → catalog code. Throws on unknown — caller catches
  // and surfaces the message via the error banner.
  const exchangeCode = mapExchangeLabelToCode(input.exchange);
  const instrumentKind =
    input.instrument === "future" ? "dated_future" : input.instrument;

  // Trade kind decides the schema discriminator and which optional cols are
  // populated. OTC and NFT never tie to a positions row in the real sense, but
  // the activity_trade FK is NOT NULL — so we still create a sentinel
  // position to anchor the trade.
  const tradeKind = input.kind ?? "spot";

  // For perp/dated_future, leverage + margin_mode are meaningful. Spot stays
  // null. The CHECK constraint chk_trade_margin_mode allows null/cross/isolated.
  const leverage = input.leverage ?? null;
  const marginMode = input.marginMode ?? null;
  const marginModeForPosition =
    marginMode ?? (tradeKind === "spot" ? "spot" : "cross");

  // Auto path: rebind to existing position. Manual / OTC / NFT path: create
  // sentinel position. tradeExistsForPosition guards against duplicate trades
  // for the same position id.
  let positionId: string;
  if (input.positionId) {
    const exists = await tradeExistsForPosition(input.positionId);
    if (exists) {
      throw new Error(
        "A trade already exists for this position. Open the existing trade to edit it.",
      );
    }
    positionId = input.positionId;
  } else {
    positionId = ""; // populated inside the transaction
  }

  const connectionId = await ensureManualConnection(userId);
  const thesis = combineThesis(input.entryThesis ?? input.note, composeKindAddendum(input));
  // exit_plan column. Combines a structured plan with the post-mortem exit note
  // so both surface on the detail page without needing a separate column.
  const exitPlanBlocks: string[] = [];
  if (input.exitPlan && input.exitPlan.trim())
    exitPlanBlocks.push(input.exitPlan.trim());
  if (input.exitNote && input.exitNote.trim())
    exitPlanBlocks.push(input.exitNote.trim());
  const exitPlanCombined = exitPlanBlocks.length ? exitPlanBlocks.join("\n\n") : null;

  const activityName = deriveTradeName(input.symbol, input.side, tradeKind);
  const activityStatus = status; // 'open' | 'closed' | 'liquidated' — all valid for trade

  const activityId = await sql.begin(async (tx) => {
    // 1. Position row — only when we don't have one from the picker.
    if (!positionId) {
      const [position] = await tx<{ id: string }[]>`
        INSERT INTO public.positions (
          user_id, exchange_connection_id,
          instrument, instrument_type, side, margin_mode, leverage,
          total_qty, qty_open, avg_entry_price, avg_exit_price,
          opened_at, closed_at, status,
          realized_pnl_quote, total_fees_quote, quote_currency
        ) VALUES (
          ${userId}::uuid, ${connectionId}::uuid,
          ${input.symbol}, ${instrumentKind}::instrument_type, ${input.side},
          ${marginModeForPosition}::margin_mode,
          ${leverage ?? null},
          ${qty.toString()}, ${isOpen ? qty.toString() : "0"},
          ${entry.toString()}, ${isOpen ? null : exit.toString()},
          ${opened}::timestamptz,
          ${closed}::timestamptz,
          ${isOpen ? "open" : "closed"}::position_status,
          ${gross.toString()}, ${feesTotal.toString()}, 'USD'
        )
        RETURNING id
      `;
      positionId = position.id;
    } else {
      // Auto path: don't double-write the position. Optionally pipe leverage/
      // margin_mode through so journaling reconciles with the user's stated
      // open conditions.
      if (leverage !== null || marginMode !== null) {
        await tx`
          UPDATE public.positions
             SET ${leverage !== null ? tx({ leverage }) : tx({})}
                 ${marginMode !== null
                    ? tx`, margin_mode = ${marginMode}::margin_mode`
                    : tx``}
           WHERE id = ${positionId}::uuid
             AND user_id = ${userId}::uuid
        `;
      }
    }

    // 2. Activity supertype.
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags,
        tax_taxable, tax_jurisdiction, strategy_tag
      ) VALUES (
        ${userId}::uuid, 'trade'::activity_type,
        ${activityStatus}::activity_status,
        ${activityName},
        ${opened}::timestamptz, ${closed}::timestamptz,
        ${capital.toString()},
        ${isOpen ? null : gross.toString()},
        ${feesTotal.toString()},
        ${isOpen ? null : net.toString()},
        ${input.regimeTags as string[]}, ${[] as string[]},
        ${input.taxTaxable ?? false},
        ${input.taxJurisdiction ?? null},
        ${input.strategyTag ?? null}
      )
      RETURNING id
    `;

    // 3. Subtype row — v5 columns included.
    await tx`
      INSERT INTO public.activity_trade (
        activity_id, position_id, symbol, exchange, instrument_kind, side,
        entry_thesis, exit_plan, target_price, stop_price,
        qty, avg_entry_price, avg_exit_price, realized_apr,
        kind, leverage, margin_mode,
        fees_entry_usd, fees_exit_usd,
        funding_paid_usd, funding_received_usd, borrow_cost_usd
      ) VALUES (
        ${activity.id}::uuid, ${positionId}::uuid, ${input.symbol},
        ${exchangeCode}, ${instrumentKind}::instrument_type, ${input.side},
        ${thesis},
        ${exitPlanCombined},
        ${input.targetPrice ?? null},
        ${input.stopPrice ?? null},
        ${qty.toString()},
        ${entry.toString()},
        ${isOpen ? null : exit.toString()},
        ${realizedApr !== null ? realizedApr.toString() : null},
        ${tradeKind}::trade_kind,
        ${leverage ?? null},
        ${marginMode ?? null},
        ${feesEntry || feesExit ? feesEntry.toString() : null},
        ${feesEntry || feesExit ? feesExit.toString() : null},
        ${input.fundingPaidUsd ?? null},
        ${input.fundingReceivedUsd ?? null},
        ${input.borrowCostUsd ?? null}
      )
    `;

    return activity.id;
  });

  return { id: activityId };
}

// ─── updateTrade — extended update path ─────────────────────────────────────
export async function updateTradeFromWizard(
  userId: string,
  activityId: string,
  input: ExtendedTradeInput,
): Promise<boolean> {
  const status = input.tradeStatus ?? "closed";
  const isOpen = status === "open";

  const opened = new Date(input.openedAt).toISOString();
  const closed = isOpen ? null : new Date(input.closedAt).toISOString();

  const qty = parseDecForCompute(input.qty);
  const entry = parseDecForCompute(input.entryPrice);
  const exit = parseDecForCompute(input.exitPrice);
  const capital = parseDecForCompute(input.capital);

  const feesEntry = parseDecForCompute(input.feesEntry);
  const feesExit = parseDecForCompute(input.feesExit);
  const feesFallback = parseDecForCompute(input.fees);
  const feesTotal =
    feesEntry || feesExit ? feesEntry + feesExit : feesFallback;

  const dir = input.side === "short" ? -1 : 1;
  const gross = isOpen ? 0 : qty * (exit - entry) * dir;
  const net = isOpen ? 0 : gross - feesTotal;
  const daysHeld = isOpen
    ? 0
    : (new Date(closed!).getTime() - new Date(opened).getTime()) / 86_400_000;
  const realizedApr =
    !isOpen && capital > 0 && daysHeld > 0
      ? (net / capital) * (365 / daysHeld)
      : null;

  const exchangeCode = mapExchangeLabelToCode(input.exchange);
  const instrumentKind =
    input.instrument === "future" ? "dated_future" : input.instrument;
  const tradeKind = input.kind ?? "spot";
  const leverage = input.leverage ?? null;
  const marginMode = input.marginMode ?? null;
  const thesis = combineThesis(input.entryThesis ?? input.note, composeKindAddendum(input));
  const exitPlanBlocks: string[] = [];
  if (input.exitPlan && input.exitPlan.trim())
    exitPlanBlocks.push(input.exitPlan.trim());
  if (input.exitNote && input.exitNote.trim())
    exitPlanBlocks.push(input.exitNote.trim());
  const exitPlanCombined = exitPlanBlocks.length ? exitPlanBlocks.join("\n\n") : null;

  return sql.begin(async (tx) => {
    // 1. Verify ownership + update supertype.
    const parentRows = await tx<{ id: string }[]>`
      UPDATE public.activity
         SET name                 = ${deriveTradeName(input.symbol, input.side, tradeKind)},
             status               = ${status}::activity_status,
             opened_at            = ${opened}::timestamptz,
             closed_at            = ${closed}::timestamptz,
             capital_deployed_usd = ${capital.toString()},
             realized_pnl_usd     = ${isOpen ? null : gross.toString()},
             fees_usd             = ${feesTotal.toString()},
             net_pnl_usd          = ${isOpen ? null : net.toString()},
             regime_tags          = ${input.regimeTags as string[]},
             tax_taxable          = ${input.taxTaxable ?? false},
             tax_jurisdiction     = ${input.taxJurisdiction ?? null},
             strategy_tag         = ${input.strategyTag ?? null}
       WHERE id = ${activityId}::uuid
         AND user_id = ${userId}::uuid
         AND deleted_at IS NULL
         AND type = 'trade'
       RETURNING id
    `;
    if (parentRows.length === 0) return false;

    // 2. Update subtype.
    await tx`
      UPDATE public.activity_trade
         SET symbol               = ${input.symbol},
             exchange             = ${exchangeCode},
             instrument_kind      = ${instrumentKind}::instrument_type,
             side                 = ${input.side},
             entry_thesis         = ${thesis},
             exit_plan            = ${exitPlanCombined},
             target_price         = ${input.targetPrice ?? null},
             stop_price           = ${input.stopPrice ?? null},
             qty                  = ${qty.toString()},
             avg_entry_price      = ${entry.toString()},
             avg_exit_price       = ${isOpen ? null : exit.toString()},
             realized_apr         = ${realizedApr !== null ? realizedApr.toString() : null},
             kind                 = ${tradeKind}::trade_kind,
             leverage             = ${leverage ?? null},
             margin_mode          = ${marginMode ?? null},
             fees_entry_usd       = ${feesEntry || feesExit ? feesEntry.toString() : null},
             fees_exit_usd        = ${feesEntry || feesExit ? feesExit.toString() : null},
             funding_paid_usd     = ${input.fundingPaidUsd ?? null},
             funding_received_usd = ${input.fundingReceivedUsd ?? null},
             borrow_cost_usd      = ${input.borrowCostUsd ?? null}
       WHERE activity_id = ${activityId}::uuid
    `;

    return true;
  });
}

/** Fetch a trade activity for the edit-mode seeding on /fields. */
export async function getTradeForEdit(
  userId: string,
  activityId: string,
): Promise<{
  name: string;
  status: "open" | "closed" | "liquidated";
  capitalDeployedUsd: string;
  feesUsd: string;
  openedAt: string;
  closedAt: string | null;
  regimeTags: string[];
  strategyTag: string | null;
  taxTaxable: boolean;
  taxJurisdiction: string | null;
  symbol: string;
  exchange: string;
  instrumentKind: "spot" | "perp" | "dated_future" | "option";
  side: "long" | "short";
  entryThesis: string | null;
  exitPlan: string | null;
  targetPrice: string | null;
  stopPrice: string | null;
  qty: string;
  avgEntryPrice: string;
  avgExitPrice: string | null;
  kind: "spot" | "perp" | "dated_future" | "option" | "otc" | "nft";
  leverage: string | null;
  marginMode: "cross" | "isolated" | null;
  feesEntryUsd: string | null;
  feesExitUsd: string | null;
  fundingPaidUsd: string | null;
  fundingReceivedUsd: string | null;
  borrowCostUsd: string | null;
} | null> {
  const rows = await sql<
    {
      name: string;
      status: "open" | "closed" | "liquidated";
      capitalDeployedUsd: string;
      feesUsd: string;
      openedAt: string;
      closedAt: string | null;
      regimeTags: string[];
      strategyTag: string | null;
      taxTaxable: boolean;
      taxJurisdiction: string | null;
      symbol: string;
      exchange: string;
      instrumentKind: "spot" | "perp" | "dated_future" | "option";
      side: "long" | "short";
      entryThesis: string | null;
      exitPlan: string | null;
      targetPrice: string | null;
      stopPrice: string | null;
      qty: string;
      avgEntryPrice: string;
      avgExitPrice: string | null;
      kind: "spot" | "perp" | "dated_future" | "option" | "otc" | "nft";
      leverage: string | null;
      marginMode: "cross" | "isolated" | null;
      feesEntryUsd: string | null;
      feesExitUsd: string | null;
      fundingPaidUsd: string | null;
      fundingReceivedUsd: string | null;
      borrowCostUsd: string | null;
    }[]
  >`
    SELECT a.name,
           a.status::text AS status,
           a.capital_deployed_usd AS "capitalDeployedUsd",
           a.fees_usd AS "feesUsd",
           a.opened_at AS "openedAt",
           a.closed_at AS "closedAt",
           a.regime_tags AS "regimeTags",
           a.strategy_tag AS "strategyTag",
           a.tax_taxable AS "taxTaxable",
           a.tax_jurisdiction AS "taxJurisdiction",
           t.symbol,
           t.exchange,
           t.instrument_kind::text AS "instrumentKind",
           t.side::text AS side,
           t.entry_thesis AS "entryThesis",
           t.exit_plan AS "exitPlan",
           t.target_price AS "targetPrice",
           t.stop_price AS "stopPrice",
           t.qty,
           t.avg_entry_price AS "avgEntryPrice",
           t.avg_exit_price AS "avgExitPrice",
           t.kind::text AS kind,
           t.leverage,
           t.margin_mode AS "marginMode",
           t.fees_entry_usd AS "feesEntryUsd",
           t.fees_exit_usd AS "feesExitUsd",
           t.funding_paid_usd AS "fundingPaidUsd",
           t.funding_received_usd AS "fundingReceivedUsd",
           t.borrow_cost_usd AS "borrowCostUsd"
      FROM public.activity a
      JOIN public.activity_trade t ON t.activity_id = a.id
     WHERE a.id = ${activityId}::uuid
       AND a.user_id = ${userId}::uuid
       AND a.deleted_at IS NULL
       AND a.type = 'trade'
     LIMIT 1
  `;
  return rows[0] ?? null;
}
