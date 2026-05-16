/**
 * Test-DB helpers.
 *
 * Pattern:
 *   • `seedTestUser(userId?)` — idempotent. Creates allowlist + auth.users +
 *     profile + a "manual entry" sentinel exchange_connection. Returns IDs.
 *   • `seedTestActivity({ type, userId, ... })` — inserts a minimally-valid
 *     activity + matching subtype row. Returns the new activity id.
 *   • `resetUserData(userId)` — truncates all user-owned rows across the
 *     tables this user can touch. Run in `beforeEach`.
 *
 * The helpers use the same `sql` singleton the production code imports so we
 * exercise the real DB pipeline (camelCase transform, jsonb wrapping, etc.).
 *
 * Decimal values are passed as strings to mirror the production callers.
 */
import { sql } from '@/lib/db/client';

export const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
export const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

const TEST_USER_EMAIL = 'test@local';
const OTHER_USER_EMAIL = 'other@local';
const MANUAL_CONN_LABEL = '_manual_entry';

interface SeededUser {
  id: string;
  email: string;
  connectionId: string;
}

/**
 * Ensure a test user + their manual-connection sentinel exists. Idempotent.
 * The auth.users trigger inserts the profile row automatically so we only
 * have to touch allowlist + auth.users + exchange_connections.
 */
export async function seedTestUser(
  userId = TEST_USER_ID,
  email = TEST_USER_EMAIL,
): Promise<SeededUser> {
  await sql`
    INSERT INTO public.allowlist (email, role, notes)
    VALUES (${email}, 'admin', 'test user')
    ON CONFLICT (email) DO NOTHING
  `;
  await sql`
    INSERT INTO auth.users (id, email)
    VALUES (${userId}::uuid, ${email})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (${userId}::uuid, ${email}, ${email})
    ON CONFLICT (id) DO NOTHING
  `;

  const existing = await sql<{ id: string }[]>`
    SELECT id FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid AND label = ${MANUAL_CONN_LABEL}
    LIMIT 1
  `;
  let connectionId: string;
  if (existing[0]) {
    connectionId = existing[0].id;
  } else {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO public.exchange_connections (
        user_id, exchange_code, label, connection_type, status, status_message
      ) VALUES (
        ${userId}::uuid, 'binance', ${MANUAL_CONN_LABEL}, 'api_key',
        'pending', 'test sentinel'
      )
      RETURNING id
    `;
    connectionId = row.id;
  }

  return { id: userId, email, connectionId };
}

/**
 * Truncate all rows this user touches. Called from beforeEach so each test
 * starts fresh. We skip the manual-connection sentinel and the auth/profile
 * rows so seedTestUser() stays cheap.
 *
 * Order matters — child rows first because of the FK constraints.
 */
export async function resetUserData(userId = TEST_USER_ID): Promise<void> {
  await sql`DELETE FROM public.notes WHERE user_id = ${userId}::uuid`;
  await sql`DELETE FROM public.spread_legs sl
    USING public.activity a
    WHERE sl.activity_id = a.id AND a.user_id = ${userId}::uuid`;
  await sql`
    DELETE FROM public.activity
    WHERE user_id = ${userId}::uuid
  `;
  await sql`
    DELETE FROM public.positions
    WHERE user_id = ${userId}::uuid
  `;
  // Keep the manual-connection sentinel — re-creating it across hundreds of
  // tests was a measurable cost. Drop other connections we may have inserted
  // for credential-flow tests.
  await sql`
    DELETE FROM public.exchange_connections
    WHERE user_id = ${userId}::uuid AND label <> ${MANUAL_CONN_LABEL}
  `;
}

// ---------------------------------------------------------------------------
// seedTestActivity — factory for activity rows. Each variant inserts the
// supertype + subtype + (for trade) a position row in one transaction.
// ---------------------------------------------------------------------------

export interface SeedTradeOpts {
  userId?: string;
  connectionId: string;
  status?: 'closed' | 'open';
  netPnl?: number;
  capital?: number;
  symbol?: string;
  side?: 'long' | 'short';
  name?: string;
  closedAt?: string; // ISO
}

export async function seedTradeActivity(opts: SeedTradeOpts): Promise<string> {
  const userId = opts.userId ?? TEST_USER_ID;
  const closedAt = opts.closedAt ?? '2026-05-01T00:00:00Z';
  const openedAt = '2026-04-25T00:00:00Z';
  const capital = opts.capital ?? 10000;
  const netPnl = opts.netPnl ?? 500;
  const side = opts.side ?? 'long';
  const symbol = opts.symbol ?? 'BTC-PERP';
  const name = opts.name ?? `${symbol.split('-')[0]} ${side} · perp`;
  const status = opts.status ?? 'closed';

  return sql.begin(async (tx) => {
    const [pos] = await tx<{ id: string }[]>`
      INSERT INTO public.positions (
        user_id, exchange_connection_id,
        instrument, instrument_type, side, margin_mode,
        total_qty, qty_open, avg_entry_price, avg_exit_price,
        opened_at, closed_at, status,
        realized_pnl_quote, total_fees_quote, quote_currency
      ) VALUES (
        ${userId}::uuid, ${opts.connectionId}::uuid,
        ${symbol}, 'perp'::instrument_type, ${side}, 'cross'::margin_mode,
        '0.5', '0', '65000', '67000',
        ${openedAt}::timestamptz, ${closedAt}::timestamptz, 'closed',
        ${(netPnl + 12.5).toString()}, '12.5', 'USD'
      )
      RETURNING id
    `;
    const [act] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'trade', ${status}::activity_status, ${name},
        ${openedAt}::timestamptz, ${closedAt}::timestamptz,
        ${capital.toString()}, ${(netPnl + 12.5).toString()}, '12.5', ${netPnl.toString()},
        ${[] as string[]}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_trade (
        activity_id, position_id, symbol, exchange, instrument_kind, side,
        qty, avg_entry_price, avg_exit_price, realized_apr
      ) VALUES (
        ${act.id}::uuid, ${pos.id}::uuid, ${symbol},
        'binance', 'perp'::instrument_type, ${side},
        '0.5', '65000', '67000', '0.42'
      )
    `;
    return act.id;
  });
}

export interface SeedSaleOpts {
  userId?: string;
  name?: string;
  asset?: string;
  saleKind?: 'ido' | 'launchpad' | 'premarket' | 'otc';
  usdPaid?: number;
  netPnl?: number;
}

export async function seedSaleActivity(opts: SeedSaleOpts = {}): Promise<string> {
  const userId = opts.userId ?? TEST_USER_ID;
  const usdPaid = opts.usdPaid ?? 5000;
  const netPnl = opts.netPnl ?? 1000;
  const asset = opts.asset ?? 'EIGEN';
  const saleKind = opts.saleKind ?? 'launchpad';
  const name = opts.name ?? `${asset} sale`;

  return sql.begin(async (tx) => {
    const [act] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'sale', 'vesting', ${name},
        '2026-04-01T00:00:00Z'::timestamptz,
        ${usdPaid.toString()}, '0', '0', ${netPnl.toString()},
        ${[] as string[]}::text[], ${[] as string[]}::text[]
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
        ${act.id}::uuid, ${asset}, ${saleKind},
        'Binance Launchpad', '2026-04-01T00:00:00Z'::timestamptz,
        ${usdPaid.toString()}, '1000',
        ${tx.json({ kind: 'all_at_tge' })}, ${tx.json([])}, '0',
        '6', now()
      )
    `;
    return act.id;
  });
}

export interface SeedAirdropOpts {
  userId?: string;
  asset?: string;
  netPnl?: number;
  protocol?: string;
}

export async function seedAirdropActivity(opts: SeedAirdropOpts = {}): Promise<string> {
  const userId = opts.userId ?? TEST_USER_ID;
  const asset = opts.asset ?? 'JUP';
  const protocol = opts.protocol ?? 'Jupiter';
  const netPnl = opts.netPnl ?? 800;

  return sql.begin(async (tx) => {
    const [act] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'airdrop', 'claimed', ${`${asset} drop`},
        '2026-04-15T00:00:00Z'::timestamptz, '2026-04-15T00:00:00Z'::timestamptz,
        '0', ${netPnl.toString()}, '0', ${netPnl.toString()},
        ${[] as string[]}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    await tx`
      INSERT INTO public.activity_airdrop (
        activity_id, token_symbol, protocol,
        qty_received, claim_date,
        value_at_receipt_usd, current_price_usd, current_price_at
      ) VALUES (
        ${act.id}::uuid, ${asset}, ${protocol},
        '800', '2026-04-15T00:00:00Z'::timestamptz,
        ${netPnl.toString()}, '1.0', now()
      )
    `;
    return act.id;
  });
}

export interface SeedSpreadOpts {
  userId?: string;
  name?: string;
  spreadType?: 'cash_carry' | 'cross_exchange_perp_arb' | 'funding_capture' | 'calendar' | 'dex_cex_arb' | 'custom';
  netPnl?: number;
  status?: 'closed' | 'open' | 'expired';
}

export async function seedSpreadActivity(opts: SeedSpreadOpts = {}): Promise<string> {
  const userId = opts.userId ?? TEST_USER_ID;
  const name = opts.name ?? 'BTC cash-and-carry';
  const spreadType = opts.spreadType ?? 'cash_carry';
  const netPnl = opts.netPnl ?? 750;
  const status = opts.status ?? 'closed';

  return sql.begin(async (tx) => {
    const [act] = await tx<{ id: string }[]>`
      INSERT INTO public.activity (
        user_id, type, status, name,
        opened_at, closed_at,
        capital_deployed_usd, realized_pnl_usd, fees_usd, net_pnl_usd,
        regime_tags, custom_tags
      ) VALUES (
        ${userId}::uuid, 'spread', ${status}::activity_status, ${name},
        '2026-04-01T00:00:00Z'::timestamptz, '2026-04-20T00:00:00Z'::timestamptz,
        '50000', ${netPnl.toString()}, '0', ${netPnl.toString()},
        ${[] as string[]}::text[], ${[] as string[]}::text[]
      )
      RETURNING id
    `;
    // chk_spread_variant requires variant=funding|basis for cash_carry, etc.
    const variant = spreadType === 'cash_carry' ? 'funding' : null;
    await tx`
      INSERT INTO public.activity_spread (
        activity_id, spread_type, variant, origin, source,
        primary_base, leg_count, apr, exchanges
      ) VALUES (
        ${act.id}::uuid, ${spreadType}, ${variant}, 'manual', 'system',
        'BTC', 2, '0.18', ${['binance', 'bybit']}::text[]
      )
    `;
    return act.id;
  });
}
