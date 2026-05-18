/**
 * Seed script — populates a fresh local Postgres with the 27 demo
 * fixtures from src/lib/data/archive-data.ts.
 *
 * Idempotent: skips if the target user already has any activity rows.
 *
 * Run with: `pnpm db:seed`.
 *
 * The fixtures are display-shaped (headlineLabel, daysLabel, …) so the
 * seed script derives plausible underlying values:
 *   - Trade: capital → qty via per-asset base price; gross/net from netPnl;
 *     a stable manual exchange_connection per user holds the synthetic
 *     positions row that activity_trade.position_id FKs to.
 *   - Sale: usd_paid = capital; tokens = current_value / current_price.
 *   - Airdrop: cost basis $0; value_at_claim = current_value / multiplier.
 *   - Spread: no leg rows yet (legs require real Positions which only
 *     the worker pipeline materializes). Stores activity + activity_spread
 *     with derived primary_base + exchanges parsed from `venues` string.
 *
 * The default user is `00000000-0000-0000-0000-000000000001` to align with
 * .env.example's APP_USER_ID default — change `DEMO_USER_ID` below if you
 * run multiple seeded users.
 */
import { sql } from "@/lib/db/client";
import {
  SEED_SPREADS,
  SEED_TRADES,
  SEED_SALES,
  SEED_AIRDROPS,
  type SpreadRow,
  type TradeRow,
  type SaleRow,
  type AirdropRow,
} from "@/lib/data/archive-data";

const DEMO_USER_ID = process.env.APP_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const DEMO_USER_EMAIL = "demo@local";
const MANUAL_CONN_LABEL = "_manual_entry";

// ── Per-asset base price table ──────────────────────────────────────────────
// Used to derive plausible entry/exit prices, qty, current prices etc. from
// the display-shaped fixtures. Stable values so re-runs produce the same
// rows.
const ASSET_BASE_PRICE: Record<string, number> = {
  BTC: 92000,
  ETH: 3200,
  SOL: 190,
  PEPE: 0.0000142,
  EIGEN: 3.8,
  W: 1.1,
  ZETA: 0.28,
  JUP: 1.05,
  ARB: 0.78,
  PYTH: 0.62,
};

const TRADE_FEES_USD = 12.5;

// ── Helpers ────────────────────────────────────────────────────────────────

function isoFromYmd(ymd: string): string {
  // Fixtures store "YYYY-MM-DD". Pin to noon UTC so downstream date arith
  // doesn't drift across timezones.
  return new Date(`${ymd}T12:00:00.000Z`).toISOString();
}

function openedAtFromClose(closedAt: string, daysHeld: number): string {
  const ms = new Date(closedAt).getTime() - daysHeld * 86_400_000;
  return new Date(ms).toISOString();
}

function fixtureAprToDecimal(headlineKind: string, headlineNum: number): number {
  // The fixture's headlineNum is in *display* units:
  //   APR: percent ("14.0" = 14%)
  //   BPS: basis points ("4.3" = 4.3 bps = 0.00043)
  //   BPS/D: bps/day
  //   MTM: multiplier (3.8 = 3.8×, raw)
  if (headlineKind === "APR")   return headlineNum / 100;
  if (headlineKind === "BPS")   return headlineNum / 10000;
  if (headlineKind === "BPS/D") return headlineNum / 10000;
  return headlineNum;
}

// Map UI SpreadType → canonical DB spread_type (the migrations use longer
// names: cash_carry/funding_capture/cross_exchange_perp_arb/calendar/dex_cex_arb).
const SPREAD_TYPE_UI_TO_DB: Record<string, string> = {
  cash_carry: "cash_carry",
  funding: "funding_capture",
  cross_exchange: "cross_exchange_perp_arb",
  calendar: "calendar",
  dex_cex: "dex_cex_arb",
};

const SPREAD_STATUS_UI_TO_DB: Record<string, string> = {
  closed: "closed",
  expired: "expired",
  // trades/sales/airdrops use their own status spaces — handled per type below.
};

// Parses a venues string like "Bitmex + Coinbase" or "Binance / Bybit" into
// exchange catalog codes. Unknown venues map to "binance" so the FK passes.
function parseVenuesToCodes(venues: string): string[] {
  const labels = venues.split(/\s*[+/]\s*/).filter(Boolean).map((s) => s.trim());
  return labels.map(venueLabelToCode);
}

function venueLabelToCode(label: string): string {
  const map: Record<string, string> = {
    Binance: "binance",
    Bybit: "bybit",
    Hyperliquid: "hyperliquid",
    OKX: "okx",
    "OKX DEX": "okx_dex",
    Coinbase: "kraken",         // not in catalog; fallback
    Bitmex: "kraken",           // not in catalog; fallback
    Deribit: "deribit",
    Kraken: "kraken",
    "Deribit Mar-26": "deribit",
  };
  return map[label] ?? "binance";
}

// Trade exchange label → code (5 fixtures use "Binance" / "Bybit" / "Hyperliquid").
function tradeExchangeToCode(label: string): string {
  return venueLabelToCode(label);
}

// ── User + sentinel-connection bootstrap ───────────────────────────────────

async function ensureDemoUser(): Promise<void> {
  // auth.users — local shim mimicking Supabase; we manage inserts directly.
  // We bypass the handle_new_user trigger by inserting the profile FIRST
  // would still raise — so insert into allowlist + auth.users, the trigger
  // then writes profiles.
  const usersExisting = await sql<{ id: string }[]>`
    SELECT id FROM auth.users WHERE id = ${DEMO_USER_ID}::uuid LIMIT 1
  `;
  if (usersExisting.length > 0) return;

  // Add to allowlist so the trigger doesn't reject.
  await sql`
    INSERT INTO public.allowlist (email, role, notes)
    VALUES (${DEMO_USER_EMAIL}, 'admin', 'seeded demo user')
    ON CONFLICT (email) DO NOTHING
  `;
  await sql`
    INSERT INTO auth.users (id, email)
    VALUES (${DEMO_USER_ID}::uuid, ${DEMO_USER_EMAIL})
    ON CONFLICT (id) DO NOTHING
  `;
  // The on_auth_user_created trigger should have inserted the profile row.
  // Verify + insert manually if absent (idempotent).
  await sql`
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (${DEMO_USER_ID}::uuid, ${DEMO_USER_EMAIL}, 'Demo Trader')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function ensureManualConnection(userId: string): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid AND label = ${MANUAL_CONN_LABEL} AND deleted_at IS NULL
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

// ── Insert routines ─────────────────────────────────────────────────────────

// chk_spread_variant only permits variant on cash_carry (funding|basis) and
// funding_capture (same_venue|cross_venue). Map fixture display strings into
// these canonical values; everything else becomes NULL so the constraint
// passes.
function mapSpreadVariant(dbSpreadType: string, fixtureVariant: string): string | null {
  const v = fixtureVariant.toLowerCase();
  if (dbSpreadType === "cash_carry") {
    if (v.includes("basis")) return "basis";
    return "funding";
  }
  if (dbSpreadType === "funding_capture") {
    if (v.includes("cross")) return "cross_venue";
    return "same_venue";
  }
  return null;
}

async function insertSpread(row: SpreadRow, userId: string): Promise<void> {
  const closedIso = isoFromYmd(row.closedAt);
  const openedIso = openedAtFromClose(closedIso, row.daysHeld);
  const aprDecimal = fixtureAprToDecimal(row.headlineKind, row.headlineNum);
  const dbSpreadType = SPREAD_TYPE_UI_TO_DB[row.spreadType] ?? "custom";
  const dbStatus = SPREAD_STATUS_UI_TO_DB[row.status] ?? "closed";
  const exchanges = parseVenuesToCodes(row.venues);
  const dbVariant = mapSpreadVariant(dbSpreadType, row.variant);

  await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'spread', ${dbStatus}::activity_status, ${row.name},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz,
        ${row.capital.toString()}, ${row.netPnl.toString()}, '0', ${row.netPnl.toString()},
        ${row.regimeTags}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_spread (
        activity_id, spread_type, variant, origin, source,
        primary_base, leg_count, apr, exchanges
      ) VALUES (
        ${activity.id}::uuid, ${dbSpreadType}, ${dbVariant}, 'manual', 'system',
        ${row.asset}, 2, ${aprDecimal.toString()}, ${exchanges}::text[]
      )
    `;
  });
}

async function insertTrade(row: TradeRow, userId: string, connectionId: string): Promise<void> {
  const closedIso = isoFromYmd(row.closedAt);
  const openedIso = openedAtFromClose(closedIso, row.daysHeld);
  const basePrice = ASSET_BASE_PRICE[row.asset] ?? 100;
  const qty = row.capital / basePrice;
  const dir = row.side === "short" ? -1 : 1;
  // gross = netPnl + fees (the fixture's netPnl is post-fees)
  const gross = row.netPnl + TRADE_FEES_USD;
  const exit = basePrice + (gross * dir) / qty;
  const aprDecimal = fixtureAprToDecimal(row.headlineKind, row.headlineNum);
  const instrumentType = row.instrument === "future" ? "dated_future" : row.instrument;

  await sql.begin(async (tx) => {
    const [position] = await tx<{ id: string }[]>`
      INSERT INTO public.positions (
        user_id, exchange_connection_id,
        instrument, instrument_type, side, margin_mode,
        total_qty, qty_open, avg_entry_price, avg_exit_price,
        opened_at, closed_at, status,
        realized_pnl_quote, total_fees_quote, quote_currency
      ) VALUES (
        ${userId}::uuid, ${connectionId}::uuid,
        ${row.symbol}, ${instrumentType}::instrument_type, ${row.side},
        ${instrumentType === "spot" ? "spot" : "cross"}::margin_mode,
        ${qty.toString()}, '0', ${basePrice.toString()}, ${exit.toString()},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz, 'closed',
        ${gross.toString()}, ${TRADE_FEES_USD.toString()}, 'USD'
      )
      RETURNING id
    `;
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'trade', 'closed', ${row.name},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz,
        ${row.capital.toString()}, ${gross.toString()}, ${TRADE_FEES_USD.toString()}, ${row.netPnl.toString()},
        ${row.regimeTags}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_trade (
        activity_id, position_id, symbol, exchange, instrument_kind, side,
        entry_thesis, qty, avg_entry_price, avg_exit_price, realized_apr
      ) VALUES (
        ${activity.id}::uuid, ${position.id}::uuid, ${row.symbol},
        ${tradeExchangeToCode(row.exchange)}, ${instrumentType}::instrument_type, ${row.side},
        ${row.note || null},
        ${qty.toString()}, ${basePrice.toString()}, ${exit.toString()},
        ${aprDecimal.toString()}
      )
    `;
  });
}

async function insertSale(row: SaleRow, userId: string): Promise<void> {
  const closedIso = isoFromYmd(row.closedAt);
  const openedIso = openedAtFromClose(closedIso, row.daysHeld);
  const usdPaid = row.capital;
  const currentPrice = ASSET_BASE_PRICE[row.asset] ?? 1;
  const currentValue = usdPaid * row.multiplier;
  const tokens = currentValue / currentPrice;
  const status =
    row.status === "vested" ? "vesting" : row.status === "claimed" ? "vesting" : "pending";
  // Per sale_kind defaults (loosely matching the deriveSaleExecution in the
  // pre-Wave 5A sale detail page).
  const tgePct =
    row.saleKind === "premarket"  ? 100 :
    row.saleKind === "launchpad"  ? 100 :
    row.saleKind === "otc"        ? 25  :
                                    20; // ido
  const linearDays = (row.saleKind === "premarket" || row.saleKind === "launchpad") ? 0 : 18 * 30;
  const cliffDays = (row.saleKind === "premarket" || row.saleKind === "launchpad") ? 0 : 6 * 30;
  const vestingSchedule = cliffDays > 0
    ? { kind: "cliff_plus_linear", cliff_days: cliffDays, linear_days: linearDays, tge_pct: tgePct }
    : { kind: "tge_plus_linear", tge_pct: tgePct, linear_days: linearDays };

  await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'sale', ${status}::activity_status, ${row.name},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz,
        ${usdPaid.toString()}, '0', '0', ${row.netPnl.toString()},
        ${row.regimeTags}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_sale (
        activity_id, token_symbol, sale_kind, sale_venue, sale_date,
        usd_paid, tokens_allocated,
        vesting_schedule, claim_events, total_claimed,
        current_price_usd, current_price_at
      ) VALUES (
        ${activity.id}::uuid, ${row.asset}, ${row.saleKind},
        ${row.venue}, ${openedIso}::timestamptz,
        ${usdPaid.toString()}, ${tokens.toString()},
        ${tx.json(vestingSchedule)}, ${tx.json([])}, '0',
        ${currentPrice.toString()}, now()
      )
    `;
  });
}

async function insertAirdrop(row: AirdropRow, userId: string): Promise<void> {
  const closedIso = isoFromYmd(row.closedAt);
  const openedIso = openedAtFromClose(closedIso, row.daysHeld);
  const currentPrice = ASSET_BASE_PRICE[row.asset] ?? 1;
  // cost basis = $0; net_pnl = current value at MTM. For losers the fixture
  // stores a negative netPnl (e.g. ARB drifted under entry) — abs() before
  // computing tokens / value_at_claim so qty_received satisfies chk_airdrop_qty.
  const currentValue = Math.abs(row.netPnl);
  const valueAtClaim = row.multiplier > 0 ? currentValue / row.multiplier : 0;
  const tokens = currentPrice > 0 ? currentValue / currentPrice : 0;

  await sql.begin(async (tx) => {
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'airdrop', 'claimed', ${row.name},
        ${openedIso}::timestamptz, ${closedIso}::timestamptz,
        '0', ${valueAtClaim.toString()}, '0', ${row.netPnl.toString()},
        ${row.regimeTags}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_airdrop (
        activity_id, token_symbol, protocol,
        qty_received, claim_date,
        value_at_receipt_usd, current_price_usd, current_price_at,
        eligibility_reason
      ) VALUES (
        ${activity.id}::uuid, ${row.asset}, ${row.protocol},
        ${tokens.toString()}, ${closedIso}::timestamptz,
        ${valueAtClaim.toString()}, ${currentPrice.toString()}, now(),
        ${row.note || null}
      )
    `;
  });
}

// ── Main entry ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[seed] target user: ${DEMO_USER_ID}`);

  await ensureDemoUser();

  const existing = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM public.activity
    WHERE user_id = ${DEMO_USER_ID}::uuid
  `;
  if (Number(existing[0]?.count ?? 0) > 0) {
    console.log(`[seed] user already has ${existing[0].count} activities — skipping. Run pnpm db:reset to start fresh.`);
    await sql.end();
    return;
  }

  const connectionId = await ensureManualConnection(DEMO_USER_ID);

  let spreads = 0, trades = 0, sales = 0, airdrops = 0;
  for (const row of SEED_SPREADS) {
    await insertSpread(row, DEMO_USER_ID);
    spreads += 1;
  }
  for (const row of SEED_TRADES) {
    await insertTrade(row, DEMO_USER_ID, connectionId);
    trades += 1;
  }
  for (const row of SEED_SALES) {
    await insertSale(row, DEMO_USER_ID);
    sales += 1;
  }
  for (const row of SEED_AIRDROPS) {
    await insertAirdrop(row, DEMO_USER_ID);
    airdrops += 1;
  }

  console.log(
    `[seed] Seeded ${spreads} spreads, ${trades} trades, ${sales} sales, ${airdrops} airdrops.`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
