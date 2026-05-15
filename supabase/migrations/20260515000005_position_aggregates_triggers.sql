-- ============================================================================
-- Migration 005: Triggers that keep position aggregates in sync
--
-- Strategy: cached columns on positions, updated via trigger on fills/funding.
-- Rationale: positions are read on every spread render; recomputing from raw
-- fills on each read is too slow. Writes (sync-time) are batched and rare
-- relative to reads.
-- ============================================================================

create or replace function public.recompute_position_aggregates(p_position_id uuid)
returns void
language plpgsql
as $$
declare
  v_fees           numeric(38,18) := 0;
  v_funding        numeric(38,18) := 0;
  v_realized       numeric(38,18) := 0;
  v_buy_notional   numeric(38,18) := 0;
  v_sell_notional  numeric(38,18) := 0;
  v_status         position_status;
begin
  select coalesce(sum(fee), 0) into v_fees
    from public.fills where position_id = p_position_id;

  select coalesce(sum(amount), 0) into v_funding
    from public.funding_events where position_id = p_position_id;

  select status into v_status from public.positions where id = p_position_id;

  -- Simplified realized PnL: notional sell - notional buy (for closed positions).
  -- App code handles FIFO/LIFO accounting for partial closes; this is the cache update.
  select
    coalesce(sum(case when side = 'buy'  then qty * price else 0 end), 0),
    coalesce(sum(case when side = 'sell' then qty * price else 0 end), 0)
    into v_buy_notional, v_sell_notional
    from public.fills where position_id = p_position_id;

  v_realized := case
    when v_status = 'closed' then v_sell_notional - v_buy_notional
    else 0
  end;

  update public.positions
    set realized_pnl_quote   = v_realized,
        total_fees_quote     = v_fees,
        total_funding_quote  = v_funding,
        updated_at           = now()
    where id = p_position_id;
end;
$$;

comment on function public.recompute_position_aggregates is
  'Rebuilds cached aggregate columns on positions from underlying fills + funding_events.';

create or replace function public.tg_fills_recompute_position()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.position_id is not null then
      perform public.recompute_position_aggregates(old.position_id);
    end if;
    return old;
  else
    if new.position_id is not null then
      perform public.recompute_position_aggregates(new.position_id);
    end if;
    if tg_op = 'UPDATE' and old.position_id is distinct from new.position_id and old.position_id is not null then
      perform public.recompute_position_aggregates(old.position_id);
    end if;
    return new;
  end if;
end;
$$;

create trigger fills_aggregate_sync
  after insert or update or delete on public.fills
  for each row execute function public.tg_fills_recompute_position();

create or replace function public.tg_funding_recompute_position()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.position_id is not null then
      perform public.recompute_position_aggregates(old.position_id);
    end if;
    return old;
  else
    if new.position_id is not null then
      perform public.recompute_position_aggregates(new.position_id);
    end if;
    return new;
  end if;
end;
$$;

create trigger funding_aggregate_sync
  after insert or update or delete on public.funding_events
  for each row execute function public.tg_funding_recompute_position();
