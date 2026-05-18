/**
 * Watchlist read helper.
 *
 * Surfaces activities the trader is *monitoring* — non-terminal states where
 * something external must happen before the position can close:
 *
 *   • airdrop.status='pending'         — eligible, awaiting claim window
 *   • sale.status in ('pending', 'vesting') — pre-TGE or partially-vested
 *   • option.status='open'             — especially ones approaching expiry
 *   • spread.status='winding_down'     — one leg closed, awaiting other
 *
 * Single query: four CTEs UNION ALL'd, then ordered by urgency (smallest
 * days-until-deadline first; null deadlines pushed to the bottom).
 *
 * Returns one row per activity with the canonical card fields plus the
 * category-specific deadline + a derived `daysUntilDeadline` so callers
 * don't have to recompute it from a Date instance.
 */
import { sql } from '@/lib/db/client';
import type {
  ActivityId,
  ActivityStatus,
  Decimal,
} from '@/types/canonical';

/**
 * Watchlist category — drives sub-section grouping in the UI. Maps to the
 * subset of activity types/statuses that surface here. Kept narrow so the
 * page can switch on it exhaustively.
 */
export type WatchlistCategory =
  | 'airdrop_pending'
  | 'sale_pre_tge'
  | 'option_expiring'
  | 'spread_winding_down'
  | 'yield_pending';

export interface WatchlistRow {
  /** Source activity id — drives the detail-page link. */
  id: ActivityId;
  /** v_activity_feed.name — the user-facing label. */
  name: string;
  /** Activity status (carries through to the badge). */
  status: ActivityStatus;
  /** Primary symbol from v_activity_feed (BTC, SOL, etc). */
  primarySymbol: string | null;
  /** Card subtitle (cash_carry, premarket, …) — same shape as v_activity_feed. */
  cardSubtitle: string | null;
  /**
   * Category bucket — drives which sub-section the row lives in and which
   * deadline label to render.
   */
  category: WatchlistCategory;
  /**
   * Deadline date — semantics depend on category:
   *   • airdrop_pending     → claim_window_end (NULL if open-ended)
   *   • sale_pre_tge        → next unlock date derived from vesting_schedule
   *                            (falls back to sale_date if no schedule yet)
   *   • option_expiring     → MIN(activity_option_leg.expiry)
   *   • spread_winding_down → activity_spread.expected_basis_convergence_date
   *
   * Always ISO YYYY-MM-DD or null. Null deadlines sort last (less urgent —
   * the trader has no countdown to anchor against).
   */
  deadline: string | null;
  /**
   * Whole days from "today" (server local TZ) to `deadline`. Negative when
   * already overdue. Null when `deadline` is null. The UI uses this to
   * colour the countdown — past-due is rendered in `text-down`.
   */
  daysUntilDeadline: number | null;
  /** Net P&L in USD — surfaces unrealized for option/spread, MTM for sale/airdrop. */
  netPnlUsd: Decimal | null;
  capitalDeployedUsd: Decimal | null;
  /** Strategy tag (if the trader tagged the activity). */
  strategyTag: string | null;
  /** Where the row links to — see hrefFor() in db-adapter.ts. */
  href: string;
}

/**
 * Read every watchlist-eligible activity for the user. Ordered by urgency
 * (ascending daysUntilDeadline) with null deadlines pushed last.
 *
 * The four CTEs share a common projection so the UNION ALL row shape is
 * stable. Each CTE adds the category discriminator + its own deadline
 * derivation. The outer SELECT computes `days_until_deadline` once and
 * sorts on it.
 */
export async function listWatchlistItems(
  userId: string,
): Promise<WatchlistRow[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      status: ActivityStatus;
      type: string;
      primarySymbol: string | null;
      cardSubtitle: string | null;
      category: WatchlistCategory;
      deadline: string | null;
      daysUntilDeadline: number | null;
      netPnlUsd: string | null;
      capitalDeployedUsd: string | null;
      strategyTag: string | null;
    }[]
  >`
    with airdrops_pending as (
      -- Airdrops awaiting claim — eligible but not yet picked up. Deadline
      -- is the claim window close (NULL when the protocol hasn't announced
      -- one yet; row still surfaces but sorts last in its bucket).
      select
        f.id,
        f.name,
        f.status,
        f.type::text                              as type,
        f.primary_symbol                          as primary_symbol,
        f.card_subtitle                           as card_subtitle,
        'airdrop_pending'::text                   as category,
        ada.claim_window_end                      as deadline,
        f.net_pnl_usd                             as net_pnl_usd,
        f.capital_deployed_usd                    as capital_deployed_usd,
        f.strategy_tag                            as strategy_tag
      from public.v_activity_feed f
      join public.activity_airdrop ada on ada.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type   = 'airdrop'
        and f.status = 'pending'
    ),
    sales_pre_tge as (
      -- Pre-TGE or partially-vested sales. Deadline derivation:
      --   1. Custom schedule with future entries → MIN(entry.date)
      --   2. Standard schedule (cliff_days/linear_days) → sale_date + cliff_days
      --   3. Otherwise → sale_date itself (a placeholder so the row still ranks)
      -- The JSON path is intentionally permissive — vesting_schedule shape
      -- evolves and we'd rather render with a stale "next sale_date" than
      -- 500 the page if a field is missing.
      select
        f.id,
        f.name,
        f.status,
        f.type::text                              as type,
        f.primary_symbol                          as primary_symbol,
        f.card_subtitle                           as card_subtitle,
        'sale_pre_tge'::text                      as category,
        coalesce(
          (
            select min((e->>'date')::date)
            from jsonb_array_elements(coalesce(ase.vesting_schedule->'entries', '[]'::jsonb)) e
            where (e->>'date') is not null
              and (e->>'date')::date >= current_date
          ),
          case
            when ase.vesting_schedule ? 'cliff_days'
              then (ase.sale_date::date + ((ase.vesting_schedule->>'cliff_days')::int) * interval '1 day')::date
            else null
          end,
          ase.sale_date::date
        ) as deadline,
        f.net_pnl_usd                             as net_pnl_usd,
        f.capital_deployed_usd                    as capital_deployed_usd,
        f.strategy_tag                            as strategy_tag
      from public.v_activity_feed f
      join public.activity_sale ase on ase.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type   = 'sale'
        and f.status in ('pending', 'vesting')
    ),
    options_open as (
      -- Open option positions — surface earliest leg expiry as the deadline.
      -- For single-leg options this is the option's expiry; for spreads it's
      -- the leading-leg expiry (a calendar spread's front month, the iron
      -- condor's common expiry, etc).
      select
        f.id,
        f.name,
        f.status,
        f.type::text                              as type,
        f.primary_symbol                          as primary_symbol,
        f.card_subtitle                           as card_subtitle,
        'option_expiring'::text                   as category,
        (
          select min(leg.expiry)
          from public.activity_option_leg leg
          where leg.activity_id = f.id
        ) as deadline,
        f.net_pnl_usd                             as net_pnl_usd,
        f.capital_deployed_usd                    as capital_deployed_usd,
        f.strategy_tag                            as strategy_tag
      from public.v_activity_feed f
      where f.user_id = ${userId}::uuid
        and f.type   = 'option'
        and f.status = 'open'
    ),
    spreads_winding as (
      -- Spreads with one leg already closed — the trader is waiting on basis
      -- convergence / counter-leg fill. Deadline is the expected convergence
      -- date the user (or worker) seeded at open.
      select
        f.id,
        f.name,
        f.status,
        f.type::text                              as type,
        f.primary_symbol                          as primary_symbol,
        f.card_subtitle                           as card_subtitle,
        'spread_winding_down'::text               as category,
        asp.expected_basis_convergence_date       as deadline,
        f.net_pnl_usd                             as net_pnl_usd,
        f.capital_deployed_usd                    as capital_deployed_usd,
        f.strategy_tag                            as strategy_tag
      from public.v_activity_feed f
      join public.activity_spread asp on asp.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type   = 'spread'
        and f.status = 'winding_down'
    ),
    yields_pending as (
      -- Yield positions the trader has set up but not yet entered. Status =
      -- 'pending' was enabled by v5.1; the watchlist entry reminds them
      -- "you planned to stake this — go pull the trigger". No natural
      -- deadline (lockup applies after entry, not before), so the row
      -- always sorts last in its bucket.
      select
        f.id,
        f.name,
        f.status,
        f.type::text                              as type,
        f.primary_symbol                          as primary_symbol,
        f.card_subtitle                           as card_subtitle,
        'yield_pending'::text                     as category,
        null::date                                as deadline,
        f.net_pnl_usd                             as net_pnl_usd,
        f.capital_deployed_usd                    as capital_deployed_usd,
        f.strategy_tag                            as strategy_tag
      from public.v_activity_feed f
      where f.user_id = ${userId}::uuid
        and f.type   = 'yield_position'
        and f.status = 'pending'
    ),
    unioned as (
      select * from airdrops_pending
      union all select * from sales_pre_tge
      union all select * from options_open
      union all select * from spreads_winding
      union all select * from yields_pending
    )
    select
      u.id,
      u.name,
      u.status,
      u.type,
      u.primary_symbol,
      u.card_subtitle,
      u.category,
      u.deadline::text                                          as deadline,
      case
        when u.deadline is null then null
        else (u.deadline - current_date)::int
      end                                                       as days_until_deadline,
      u.net_pnl_usd,
      u.capital_deployed_usd,
      u.strategy_tag
    from unioned u
    order by
      -- Most-urgent first. NULL deadlines (open-ended claim windows, missing
      -- convergence dates) are pushed last in each category.
      case when u.deadline is null then 1 else 0 end asc,
      u.deadline asc,
      u.name asc
  `;

  return rows.map((r) => ({
    id: r.id as ActivityId,
    name: r.name,
    status: r.status,
    primarySymbol: r.primarySymbol,
    cardSubtitle: r.cardSubtitle,
    category: r.category,
    deadline: r.deadline,
    daysUntilDeadline: r.daysUntilDeadline,
    netPnlUsd: r.netPnlUsd,
    capitalDeployedUsd: r.capitalDeployedUsd,
    strategyTag: r.strategyTag,
    href: hrefFor(r.id, r.type as WatchlistTypeStr),
  }));
}

// Minimal local copy of the type→href mapping. Importing from db-adapter would
// drag a client-side dependency surface in; keeping the map here keeps the
// helper self-contained and the surface small.
type WatchlistTypeStr = 'airdrop' | 'sale' | 'option' | 'spread';

function hrefFor(id: string, type: WatchlistTypeStr): string {
  switch (type) {
    case 'airdrop':
      return `/airdrops/${id}`;
    case 'sale':
      return `/sales/${id}`;
    case 'option':
      return `/options/${id}`;
    case 'spread':
      return `/spreads/${id}`;
  }
}
