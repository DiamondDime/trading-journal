-- ============================================================================
-- Migration v5.4 — Remove tax-classification flags
--
-- Drops the v5 tax surface entirely: the `tax_taxable` / `tax_jurisdiction`
-- columns on public.activity. This journal does no tax reporting; the two
-- flags were optional metadata that nothing downstream ever consumed.
--
-- `v_activity_feed` selects both columns, so it is dropped and recreated
-- without them — a view's columns cannot be removed in place (Postgres only
-- allows CREATE OR REPLACE VIEW to append, never to drop). No other database
-- object depends on the view.
--
-- NOT reversible: dropping the columns discards any tax flags a user had set.
-- ============================================================================

-- 1. Drop the dependent view ------------------------------------------------
drop view if exists public.v_activity_feed cascade;

-- 2. Drop the tax columns ---------------------------------------------------
alter table public.activity drop column if exists tax_taxable;
alter table public.activity drop column if exists tax_jurisdiction;

-- 3. Recreate v_activity_feed without the tax columns -----------------------
-- Verbatim copy of the v5 definition (migration 20260518000000) with the two
-- `a.tax_taxable` / `a.tax_jurisdiction` select-list lines removed.
create view public.v_activity_feed as
with days_held_cte as (
  select
    a.id,
    case
      when a.opened_at is null then null
      else extract(epoch from (coalesce(a.closed_at, now()) - a.opened_at)) / 86400.0
    end as days_held
  from public.activity a
  where a.deleted_at is null
)
select
  a.id, a.user_id, a.type, a.status, a.name,
  a.opened_at, a.closed_at,
  a.capital_deployed_usd, a.realized_pnl_usd, a.unrealized_pnl_usd,
  a.fees_usd, a.net_pnl_usd,
  a.regime_tags, a.custom_tags,
  a.strategy_tag,

  -- Polymorphic card headline value
  -- - spread:         realized_apr computed live from net_pnl/capital/days
  -- - trade:          realized_apr from activity_trade (worker-computed)
  -- - sale:           MTM multiplier (current_price * tokens / cost_basis)
  -- - airdrop:        MTM multiplier (current_price * qty / value_at_receipt)
  -- - yield_position: realized_apy_pct if closed, else expected_apy_pct
  -- - option (single_leg): realized_pnl_usd
  -- - option (spread):     realized_pnl_usd (or net_premium if open)
  case a.type
    when 'spread' then case
      when a.capital_deployed_usd is null or a.capital_deployed_usd = 0 then null
      when dh.days_held is null or dh.days_held = 0 then null
      else (a.net_pnl_usd / a.capital_deployed_usd) * (365.0 / dh.days_held)
    end
    when 'trade'   then att.realized_apr
    when 'sale'    then case
      when ase.usd_paid > 0
       and ase.tokens_allocated > 0
       and ase.current_price_usd is not null
        then (ase.tokens_allocated * ase.current_price_usd) / ase.usd_paid
      else null
    end
    when 'airdrop' then case
      when ada.value_at_receipt_usd > 0
       and ada.current_price_usd is not null
       and ada.qty_received is not null
        then (ada.current_price_usd * ada.qty_received) / ada.value_at_receipt_usd
      else null
    end
    when 'yield_position' then case
      when a.status = 'closed' and ayp.realized_apy_pct is not null then ayp.realized_apy_pct
      when ayp.expected_apy_pct is not null then ayp.expected_apy_pct
      else null
    end
    when 'option' then ao.realized_pnl_usd
  end                                                       as headline_value,

  case a.type
    when 'spread'         then 'realized_apr'
    when 'trade'          then 'realized_apr'
    when 'sale'           then 'mtm_multiplier'
    when 'airdrop'        then 'mtm_multiplier'
    when 'yield_position' then 'apy_pct'
    when 'option'         then 'realized_pnl_usd'
  end                                                       as headline_kind,

  -- Card-headline display hint (frontend renders blindly)
  case a.type
    when 'spread'         then 'apr_pct'
    when 'trade'          then 'apr_pct'
    when 'sale'           then 'mtm_x'
    when 'airdrop'        then 'mtm_x'
    when 'yield_position' then 'apy_pct'
    when 'option'         then 'usd'
  end                                                       as headline_format,

  -- Subtype-specific symbol/asset hint for the unified feed
  case a.type
    when 'spread'         then asp.primary_base
    when 'trade'          then att.symbol
    when 'sale'           then ase.token_symbol
    when 'airdrop'        then ada.token_symbol
    when 'yield_position' then ayp.asset
    when 'option'         then ao.underlying
  end                                                       as primary_symbol,

  -- Short secondary line on the card. Activity-specific.
  case a.type
    when 'spread'         then asp.spread_type::text
    when 'trade'          then att.exchange || ' · ' || att.instrument_kind::text
    when 'sale'           then ase.sale_kind::text
    when 'airdrop'        then ada.protocol
    when 'yield_position' then ayp.protocol || ' · ' || ayp.kind::text
    when 'option'         then case
      when ao.subtype = 'option_spread' and ao.spread_style is not null
        then 'Option · ' || ao.spread_style::text
      else 'Option · single_leg'
    end
  end                                                       as card_subtitle,

  a.created_at, a.updated_at
from public.activity a
join days_held_cte dh on dh.id = a.id
left join public.activity_spread         asp on asp.activity_id = a.id and a.type = 'spread'
left join public.activity_trade          att on att.activity_id = a.id and a.type = 'trade'
left join public.activity_sale           ase on ase.activity_id = a.id and a.type = 'sale'
left join public.activity_airdrop        ada on ada.activity_id = a.id and a.type = 'airdrop'
left join public.activity_yield_position ayp on ayp.activity_id = a.id and a.type = 'yield_position'
left join public.activity_option         ao  on ao.activity_id  = a.id and a.type = 'option'
where a.deleted_at is null;

comment on view public.v_activity_feed is
  'Polymorphic cross-activity feed. One row per non-deleted activity. '
  'headline_value + headline_kind + headline_format drive activity-agnostic '
  'card rendering. card_subtitle is a short secondary line per type. '
  'Extended in v5 to cover yield_position + option types and surface '
  'strategy_tag.';

grant select on public.v_activity_feed to authenticated;
