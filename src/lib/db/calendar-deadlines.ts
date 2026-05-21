/**
 * Calendar deadline reads.
 *
 * The calendar grid shows PAST activity as chips. This module supplies the
 * forward-looking half: upcoming deadlines that fall inside the visible grid
 * window, so the calendar can render a "due" badge on those cells.
 *
 * Deadline sources (5 kinds):
 *   • option_expiry      — MIN(activity_option_leg.expiry) for open options
 *   • vesting_unlock     — next vesting-schedule unlock for pre-TGE / vesting sales
 *   • airdrop_claim      — claim_window_end for pending airdrops
 *   • spread_convergence — expected_basis_convergence_date for winding-down spreads
 *   • reminder           — remind_at of pending manual reminders
 *
 * The first four mirror the deadline derivation in `watchlist.ts` (same CTE
 * shapes); here they are constrained to a date range rather than ranked by
 * urgency. Every query gates on user_id; RLS is defence-in-depth.
 */
import { sql } from '@/lib/db/client';
import type { UserId } from '@/types/canonical';

/** Discriminator for a deadline — drives the tooltip label + (optionally) icon. */
export type DeadlineKind =
  | 'option_expiry'
  | 'vesting_unlock'
  | 'airdrop_claim'
  | 'spread_convergence'
  | 'reminder';

/** One upcoming deadline, resolved for calendar rendering. */
export interface CalendarDeadline {
  /** Stable React key — `${kind}:${sourceId}`. */
  id: string;
  /** YYYY-MM-DD bucket key for the calendar grid. */
  date: string;
  kind: DeadlineKind;
  /** Activity / reminder name — shown in the cell tooltip. */
  name: string;
  /** Detail-page href for the deadline's source. */
  href: string;
}

/**
 * Upcoming deadlines whose date falls inside [startDate, endDate] (both
 * inclusive, YYYY-MM-DD). Used by the calendar page to badge cells.
 *
 * The four activity CTEs share the watchlist's deadline derivation; the fifth
 * UNION arm pulls pending manual reminders. The outer SELECT date-filters and
 * orders deterministically (date, then name).
 */
export async function getUpcomingDeadlines(
  userId: UserId,
  startDate: string,
  endDate: string,
): Promise<CalendarDeadline[]> {
  const rows = await sql<
    {
      sourceId: string;
      linkId: string | null;
      activityType: string | null;
      kind: DeadlineKind;
      name: string;
      deadline: string;
    }[]
  >`
    with airdrop_claims as (
      -- Pending airdrops with an announced claim window close.
      select
        f.id                                  as source_id,
        f.id                                  as link_id,
        f.type::text                          as activity_type,
        'airdrop_claim'::text                 as kind,
        f.name                                as name,
        ada.claim_window_end::date            as deadline
      from public.v_activity_feed f
      join public.activity_airdrop ada on ada.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type    = 'airdrop'
        and f.status  = 'pending'
        and ada.claim_window_end is not null
    ),
    vesting_unlocks as (
      -- Next vesting unlock for pre-TGE / mid-vesting sales. Mirrors the
      -- watchlist's permissive vesting_schedule derivation.
      select
        f.id                                  as source_id,
        f.id                                  as link_id,
        f.type::text                          as activity_type,
        'vesting_unlock'::text                as kind,
        f.name                                as name,
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
        )                                     as deadline
      from public.v_activity_feed f
      join public.activity_sale ase on ase.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type    = 'sale'
        and f.status in ('pending', 'vesting')
    ),
    option_expiries as (
      -- Earliest leg expiry for open option positions.
      select
        f.id                                  as source_id,
        f.id                                  as link_id,
        f.type::text                          as activity_type,
        'option_expiry'::text                 as kind,
        f.name                                as name,
        (
          select min(leg.expiry)
          from public.activity_option_leg leg
          where leg.activity_id = f.id
        )                                     as deadline
      from public.v_activity_feed f
      where f.user_id = ${userId}::uuid
        and f.type    = 'option'
        and f.status  = 'open'
    ),
    spread_convergences as (
      -- Expected basis-convergence date for winding-down spreads.
      select
        f.id                                  as source_id,
        f.id                                  as link_id,
        f.type::text                          as activity_type,
        'spread_convergence'::text            as kind,
        f.name                                as name,
        asp.expected_basis_convergence_date::date as deadline
      from public.v_activity_feed f
      join public.activity_spread asp on asp.activity_id = f.id
      where f.user_id = ${userId}::uuid
        and f.type    = 'spread'
        and f.status  = 'winding_down'
        and asp.expected_basis_convergence_date is not null
    ),
    reminder_dates as (
      -- Pending manual reminders. A reminder linked to a live activity carries
      -- that activity's id + type so the calendar badge can deep-link to it
      -- (matching the notification bell); a standalone reminder leaves both
      -- NULL and the href falls back to /watchlist. The activity LEFT JOIN
      -- mirrors scanDueReminders exactly — same deleted_at-is-null rule.
      select
        r.id                                  as source_id,
        a.id                                  as link_id,
        a.type::text                          as activity_type,
        'reminder'::text                      as kind,
        r.title                               as name,
        r.remind_at::date                     as deadline
      from public.reminders r
      left join public.activity a
        on a.id = r.activity_id
       and a.deleted_at is null
      where r.user_id      = ${userId}::uuid
        and r.completed_at is null
        and r.dismissed_at is null
    ),
    unioned as (
      select * from airdrop_claims
      union all select * from vesting_unlocks
      union all select * from option_expiries
      union all select * from spread_convergences
      union all select * from reminder_dates
    )
    select
      u.source_id,
      u.link_id,
      u.activity_type,
      u.kind,
      u.name,
      to_char(u.deadline, 'YYYY-MM-DD') as deadline
    from unioned u
    where u.deadline is not null
      and u.deadline between ${startDate}::date and ${endDate}::date
    order by u.deadline asc, u.name asc
  `;

  return rows.map((r) => ({
    id: `${r.kind}:${r.sourceId}`,
    date: r.deadline,
    kind: r.kind,
    name: r.name,
    href: deadlineHref(r.linkId, r.activityType),
  }));
}

/**
 * Resolve a deadline's deep-link from its link target. Every activity-backed
 * deadline — and a reminder linked to a live activity — routes to that
 * activity's detail page; a standalone reminder (linkId NULL) routes to the
 * watchlist, where pending items are managed.
 */
function deadlineHref(
  linkId: string | null,
  activityType: string | null,
): string {
  if (linkId == null || activityType == null) return '/watchlist';
  switch (activityType) {
    case 'spread':
      return `/spreads/${linkId}`;
    case 'trade':
      return `/trades/${linkId}`;
    case 'sale':
      return `/sales/${linkId}`;
    case 'airdrop':
      return `/airdrops/${linkId}`;
    case 'yield_position':
      return `/yield-positions/${linkId}`;
    case 'option':
      return `/options/${linkId}`;
    default:
      return '/watchlist';
  }
}
