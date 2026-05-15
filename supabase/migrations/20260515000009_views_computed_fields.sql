-- ============================================================================
-- Migration 009: Views & materialized views for computed fields
-- ============================================================================

-- Mark prices — shared across users, populated by sync worker
create table public.mark_prices (
  instrument    text not null,
  exchange_code text not null references public.exchange_catalog(code),
  price         numeric(38,18) not null,
  ts            timestamptz not null,
  primary key (instrument, exchange_code, ts)
);

comment on table public.mark_prices is
  'Time-bucketed mark prices per instrument/exchange. Populated by sync worker. Shared across users.';

create index mark_prices_latest_idx
  on public.mark_prices (instrument, exchange_code, ts desc);

alter table public.mark_prices enable row level security;
create policy mark_prices_read on public.mark_prices
  for select to authenticated using (true);

-- ============================================================================
-- View: position_pnl — live realized + unrealized + funding + fees per position
-- ============================================================================

create or replace view public.position_pnl
with (security_invoker = true) as
select
  p.id                                                          as position_id,
  p.user_id,
  p.exchange_connection_id,
  p.instrument,
  p.instrument_type,
  p.side,
  p.status,
  p.opened_at,
  p.closed_at,
  p.qty_open,
  p.total_qty,
  p.avg_entry_price,
  p.avg_exit_price,
  p.realized_pnl_quote,
  p.total_fees_quote,
  p.total_funding_quote,
  case
    when p.status = 'closed' then 0
    when latest_mark.price is null then null
    when p.side = 'long'  then (latest_mark.price - p.avg_entry_price) * p.qty_open
    when p.side = 'short' then (p.avg_entry_price - latest_mark.price) * p.qty_open
  end                                                           as unrealized_pnl_quote,
  (
    coalesce(p.realized_pnl_quote, 0)
    + coalesce(
        case
          when p.status = 'closed' then 0
          when latest_mark.price is null then 0
          when p.side = 'long'  then (latest_mark.price - p.avg_entry_price) * p.qty_open
          when p.side = 'short' then (p.avg_entry_price - latest_mark.price) * p.qty_open
        end, 0)
    + coalesce(p.total_funding_quote, 0)
    - coalesce(p.total_fees_quote, 0)
  )                                                             as net_pnl_quote,
  latest_mark.price                                             as last_mark_price,
  latest_mark.ts                                                as last_mark_at
from public.positions p
left join lateral (
  select mp.price, mp.ts
    from public.mark_prices mp
    join public.exchange_connections ec on ec.id = p.exchange_connection_id
   where mp.instrument = p.instrument and mp.exchange_code = ec.exchange_code
   order by mp.ts desc
   limit 1
) latest_mark on true
where p.deleted_at is null;

comment on view public.position_pnl is
  'Per-position PnL with live unrealized. RLS via security_invoker.';

-- ============================================================================
-- View: spread_pnl — roll up legs into spread-level metrics
-- ============================================================================

create or replace view public.spread_pnl
with (security_invoker = true) as
with leg_pnl as (
  select
    sl.spread_id,
    s.user_id,
    sum(pp.realized_pnl_quote)               as realized_pnl,
    sum(coalesce(pp.unrealized_pnl_quote,0)) as unrealized_pnl,
    sum(pp.total_funding_quote)              as funding_pnl,
    sum(pp.total_fees_quote)                 as fees,
    count(*)                                 as leg_count
  from public.spread_legs sl
  join public.spreads s on s.id = sl.spread_id
  join public.position_pnl pp on pp.position_id = sl.position_id
  where s.deleted_at is null
  group by sl.spread_id, s.user_id
)
select
  s.id                                       as spread_id,
  s.user_id,
  s.spread_type,
  s.status,
  s.name,
  s.primary_base,
  s.opened_at,
  s.closed_at,
  s.capital_deployed_usd,
  lp.leg_count,
  coalesce(lp.realized_pnl,   0)             as realized_pnl_quote,
  coalesce(lp.unrealized_pnl, 0)             as unrealized_pnl_quote,
  coalesce(lp.funding_pnl,    0)             as funding_pnl_quote,
  coalesce(lp.fees,           0)             as fees_quote,
  (coalesce(lp.realized_pnl, 0) + coalesce(lp.unrealized_pnl, 0)
    + coalesce(lp.funding_pnl, 0) - coalesce(lp.fees, 0))      as net_pnl_quote,
  (coalesce(lp.realized_pnl, 0) + coalesce(lp.unrealized_pnl, 0)) as gross_pnl_quote,
  case
    when s.opened_at is null then null
    else extract(epoch from (coalesce(s.closed_at, now()) - s.opened_at)) / 86400.0
  end                                        as days_held,
  case
    when s.capital_deployed_usd is null or s.capital_deployed_usd = 0 then null
    when s.opened_at is null then null
    else
      ((coalesce(lp.realized_pnl, 0) + coalesce(lp.unrealized_pnl, 0)
        + coalesce(lp.funding_pnl, 0) - coalesce(lp.fees, 0)) / s.capital_deployed_usd)
        / nullif(extract(epoch from (coalesce(s.closed_at, now()) - s.opened_at)) / (86400.0 * 365), 0)
  end                                        as apr_computed,
  s.regime_tags,
  s.custom_tags,
  s.exchanges,
  s.created_at,
  s.updated_at
from public.spreads s
left join leg_pnl lp on lp.spread_id = s.id
where s.deleted_at is null;

comment on view public.spread_pnl is
  'Spread-level aggregate: gross/net/funding/fees PnL + APR computed live.';

-- ============================================================================
-- Materialized view: daily PnL roll-up
-- Refresh via scheduled function (every 5min).
-- ============================================================================

create materialized view public.daily_pnl as
with realized as (
  select
    f.user_id,
    date_trunc('day', f.executed_at) as day,
    sum(-f.fee) as fees_pnl
  from public.fills f
  group by f.user_id, date_trunc('day', f.executed_at)
),
funding as (
  select
    fe.user_id,
    date_trunc('day', fe.event_time) as day,
    sum(fe.amount) as funding_pnl
  from public.funding_events fe
  group by fe.user_id, date_trunc('day', fe.event_time)
),
closes as (
  select
    p.user_id,
    date_trunc('day', p.closed_at) as day,
    sum(p.realized_pnl_quote) as realized_pnl
  from public.positions p
  where p.status = 'closed' and p.closed_at is not null and p.deleted_at is null
  group by p.user_id, date_trunc('day', p.closed_at)
)
select
  coalesce(r.user_id, fn.user_id, c.user_id)                  as user_id,
  coalesce(r.day, fn.day, c.day)                              as day,
  coalesce(r.fees_pnl, 0)                                     as fees_pnl,
  coalesce(fn.funding_pnl, 0)                                 as funding_pnl,
  coalesce(c.realized_pnl, 0)                                 as realized_pnl,
  coalesce(r.fees_pnl, 0) + coalesce(fn.funding_pnl, 0) + coalesce(c.realized_pnl, 0) as net_pnl
from realized r
full outer join funding fn on fn.user_id = r.user_id and fn.day = r.day
full outer join closes  c  on c.user_id  = coalesce(r.user_id, fn.user_id) and c.day = coalesce(r.day, fn.day);

create unique index daily_pnl_user_day_idx on public.daily_pnl (user_id, day);

comment on materialized view public.daily_pnl is
  'Per-user per-day PnL roll-up. Refresh every 5min.';

create or replace function public.refresh_daily_pnl()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently public.daily_pnl;
$$;

-- Wrapped per-user view (since RLS can't be set on materialized views directly)
create or replace view public.my_daily_pnl
with (security_barrier = true) as
select * from public.daily_pnl where user_id = auth.uid();

comment on view public.my_daily_pnl is
  'Per-user filter over daily_pnl. Use this from the app — never query daily_pnl directly.';

grant select on public.my_daily_pnl    to authenticated;
grant select on public.position_pnl    to authenticated;
grant select on public.spread_pnl      to authenticated;
revoke all   on public.daily_pnl       from authenticated;
