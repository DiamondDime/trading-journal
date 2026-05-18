-- ============================================================================
-- Migration v5.1 — Wave-2 wizard follow-ups.
--
-- Closes gaps where Wave-2 wizards collected user input but the v5 schema
-- had no column to persist it. Surfaced by W2c (sale) and W2e (yield)
-- completion reports. Additive only — no destructive changes.
--
-- 1. activity_yield_position
--      + lockup_days        — days the position is locked before withdrawal
--                             is permitted (0 = flexible). Drives the lockup
--                             countdown widget on the detail page.
--      + auto_compound      — whether rewards are auto-restaked. Affects the
--                             "compounded total" projection on review.
--      + exit_conditions    — free-text exit thesis (analogue of
--                             activity_spread.exit_plan).
--
-- 2. activity_sale
--      + eligibility_reason — structured note explaining how the trader got
--                             into the allocation (KYC tier, prior holdings,
--                             quest completion, etc.). Distinct from
--                             entry_thesis (which is the strategic note).
--
-- 3. chk_activity_status_by_type
--      Allow `yield_position` status `pending` — the master plan wants a
--      pre-active "I'm about to stake" watchlist entry; v5 forbade it.
-- ============================================================================

-- 1. activity_yield_position additions ---------------------------------------

alter table public.activity_yield_position
  add column if not exists lockup_days     integer,
  add column if not exists auto_compound   boolean not null default false,
  add column if not exists exit_conditions text;

comment on column public.activity_yield_position.lockup_days is
  'Days the position is locked before withdrawal is permitted. 0 = flexible. '
  'NULL = unknown. Drives the lockup-countdown widget on the detail page.';

comment on column public.activity_yield_position.auto_compound is
  'Whether rewards are auto-restaked. When true, the review-step projection '
  'uses compound interest math for "expected_total_yield_usd".';

comment on column public.activity_yield_position.exit_conditions is
  'Free-text exit thesis. Analogous to activity_spread.exit_plan. '
  'Example: "unstake if APY drops below 4% for 3 consecutive epochs".';

-- 2. activity_sale.eligibility_reason ----------------------------------------

alter table public.activity_sale
  add column if not exists eligibility_reason text;

comment on column public.activity_sale.eligibility_reason is
  'How the trader got into the allocation: KYC tier, prior token holdings, '
  'launchpad staking commitment, quest completion, whitelist criteria. '
  'Distinct from notes.entry_rationale which captures the *strategic* thesis.';

-- 3. Allow yield_position.status = 'pending' ---------------------------------
-- v5 forbade it; master plan wants the "I''m about to stake" watchlist entry.

alter table public.activity drop constraint if exists chk_activity_status_by_type;

alter table public.activity add constraint chk_activity_status_by_type check (
  (type = 'spread'         and status in ('open','winding_down','orphaned','expired','closed')) or
  (type = 'trade'          and status in ('open','liquidated','closed'))                        or
  (type = 'sale'           and status in ('pending','vesting','closed'))                        or
  (type = 'airdrop'        and status in ('pending','claimed','closed'))                        or
  (type = 'yield_position' and status in ('pending','open','unwinding','closed'))               or
  (type = 'option'         and status in ('open','closed'))
);

-- 4. Bump activity.updated_at on the new yield columns via the existing trigger.
-- (No-op: bump_activity_updated_at already fires on any UPDATE.)
