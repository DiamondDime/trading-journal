-- ============================================================================
-- Migration 010 — Lock vocabulary from the v1 arbitrage domain brief
--                 (docs/vocabulary.md is the human-readable contract)
--
-- Adds:
--   • Lifecycle states: winding_down, orphaned, expired
--   • spreads.variant — per-type subtype (cash_carry: funding|basis,
--     funding_capture: same_venue|cross_venue)
--   • Open-intent columns — trader's expectations at open (used by post-trade
--     "was the thesis right?" review)
--   • spread_legs.intended_price + intended_price_set_at — slippage review
--   • spread_pnl view rebuild — decomposition (funding / basis / fees / net)
--     and per-spread-type card_headline {metric, value, format}
-- ============================================================================

-- 1. Lifecycle states ---------------------------------------------------------
-- Each ALTER TYPE auto-commits (psql runs each statement as its own tx with
-- our migrate script). Safe to use the new values in later statements.

ALTER TYPE spread_status ADD VALUE IF NOT EXISTS 'winding_down';
ALTER TYPE spread_status ADD VALUE IF NOT EXISTS 'orphaned';
ALTER TYPE spread_status ADD VALUE IF NOT EXISTS 'expired';

-- 2. Refresh the date/state CHECK to cover the new states ---------------------

ALTER TABLE public.spreads
  DROP CONSTRAINT IF EXISTS chk_spread_status_dates;

ALTER TABLE public.spreads
  ADD CONSTRAINT chk_spread_status_dates CHECK (
    (status = 'candidate'    AND opened_at IS NULL     AND closed_at IS NULL)     OR
    (status = 'rejected')                                                          OR
    (status = 'open'         AND opened_at IS NOT NULL AND closed_at IS NULL)      OR
    (status = 'winding_down' AND opened_at IS NOT NULL AND closed_at IS NULL)      OR
    (status = 'orphaned'     AND opened_at IS NOT NULL)                            OR
    (status = 'expired'      AND opened_at IS NOT NULL AND closed_at IS NOT NULL)  OR
    (status = 'closed'       AND opened_at IS NOT NULL AND closed_at IS NOT NULL)
  );

-- 3. variant + open-intent columns -------------------------------------------

ALTER TABLE public.spreads
  ADD COLUMN IF NOT EXISTS variant                         text,
  ADD COLUMN IF NOT EXISTS target_apr_at_open              numeric(10, 6),
  ADD COLUMN IF NOT EXISTS expected_holding_days           integer,
  ADD COLUMN IF NOT EXISTS expected_basis_convergence_date date,
  ADD COLUMN IF NOT EXISTS exit_plan                       text,
  ADD COLUMN IF NOT EXISTS borrow_cost_assumed_bps         numeric(10, 4),
  ADD COLUMN IF NOT EXISTS close_threshold_apr             numeric(10, 6),
  ADD COLUMN IF NOT EXISTS close_threshold_periods         integer,
  ADD COLUMN IF NOT EXISTS max_gas_budget_usd              numeric(20, 8),
  ADD COLUMN IF NOT EXISTS slippage_tolerance_bps          numeric(10, 4);

COMMENT ON COLUMN public.spreads.variant IS
  'Per-type subtype. cash_carry: funding|basis. funding_capture: same_venue|cross_venue. Other types: NULL.';
COMMENT ON COLUMN public.spreads.target_apr_at_open IS
  'Trader-expected APR at open as decimal (0.178 = 17.8%). Post-trade review divides realized by this.';
COMMENT ON COLUMN public.spreads.expected_holding_days IS
  'Rough holding-period target. Compared to days_held on close.';
COMMENT ON COLUMN public.spreads.expected_basis_convergence_date IS
  'Cash-and-carry basis-version: expected basis-converges-to-zero date (usually the future expiry).';
COMMENT ON COLUMN public.spreads.exit_plan IS
  'Free-text exit thesis. Example: "close if funding flips for >3 ticks" or "hold to expiry".';
COMMENT ON COLUMN public.spreads.borrow_cost_assumed_bps IS
  'Borrow cost assumed at open (basis-variant cash-carry with margin spot leg). bps.';
COMMENT ON COLUMN public.spreads.close_threshold_apr IS
  'Funding-capture: APR threshold below which strategy auto-tags as needing exit.';
COMMENT ON COLUMN public.spreads.close_threshold_periods IS
  'Funding-capture: how many consecutive funding periods below close_threshold_apr trigger the alert.';
COMMENT ON COLUMN public.spreads.max_gas_budget_usd IS
  'DEX-CEX: gas budget at open. Realized vs budget surfaces on the post-trade review.';
COMMENT ON COLUMN public.spreads.slippage_tolerance_bps IS
  'Per-leg slippage tolerated (cross-exchange + DEX-CEX). Used by orphan/slippage-breach alerts.';

-- Variant must match the spread type
ALTER TABLE public.spreads
  DROP CONSTRAINT IF EXISTS chk_spread_variant;

ALTER TABLE public.spreads
  ADD CONSTRAINT chk_spread_variant CHECK (
    variant IS NULL
    OR (spread_type = 'cash_carry'      AND variant IN ('funding', 'basis'))
    OR (spread_type = 'funding_capture' AND variant IN ('same_venue', 'cross_venue'))
  );

-- 4. Per-leg execution-review fields -----------------------------------------

ALTER TABLE public.spread_legs
  ADD COLUMN IF NOT EXISTS intended_price        numeric(38, 18),
  ADD COLUMN IF NOT EXISTS intended_price_set_at timestamptz;

COMMENT ON COLUMN public.spread_legs.intended_price IS
  'Trader-intended entry price. Used to compute realized slippage_bps vs avg_fill_price on the position.';

-- 5. Rebuild spread_pnl with PnL decomposition + per-type card headline -------

DROP VIEW IF EXISTS public.spread_pnl CASCADE;

CREATE VIEW public.spread_pnl AS
WITH leg_pnl AS (
  SELECT
    sl.spread_id,
    s.user_id,
    SUM(pp.realized_pnl_quote)                AS realized_pnl,
    SUM(COALESCE(pp.unrealized_pnl_quote, 0)) AS unrealized_pnl,
    SUM(pp.total_funding_quote)               AS funding_pnl,
    SUM(pp.total_fees_quote)                  AS fees,
    COUNT(*)                                  AS leg_count
  FROM public.spread_legs sl
  JOIN public.spreads      s  ON s.id           = sl.spread_id
  JOIN public.position_pnl pp ON pp.position_id = sl.position_id
  WHERE s.deleted_at IS NULL
  GROUP BY sl.spread_id, s.user_id
),
metrics AS (
  SELECT
    s.id                                          AS spread_id,
    s.user_id,
    s.spread_type,
    s.variant,
    s.status,
    s.name,
    s.primary_base,
    s.opened_at,
    s.closed_at,
    s.capital_deployed_usd,
    s.target_apr_at_open,
    s.expected_holding_days,
    s.regime_tags,
    s.custom_tags,
    s.exchanges,
    s.created_at,
    s.updated_at,
    COALESCE(lp.leg_count, 0)                     AS leg_count,

    -- ---- PnL decomposition (the stacked-bar chart's inputs) ---------------
    COALESCE(lp.realized_pnl,   0)                AS realized_pnl_quote,
    -- basis_pnl_quote ≈ net MTM of the legs (delta-neutral spreads should be small)
    COALESCE(lp.unrealized_pnl, 0)                AS basis_pnl_quote,
    COALESCE(lp.funding_pnl,    0)                AS funding_received_quote,
    COALESCE(lp.fees,           0)                AS fees_quote,

    -- net = realized + basis + funding − fees
    (COALESCE(lp.realized_pnl,   0)
     + COALESCE(lp.unrealized_pnl, 0)
     + COALESCE(lp.funding_pnl,  0)
     - COALESCE(lp.fees,         0))              AS net_pnl_quote,

    -- gross = realized + basis (no funding, no fees)
    (COALESCE(lp.realized_pnl,   0)
     + COALESCE(lp.unrealized_pnl, 0))            AS gross_pnl_quote,

    -- days_held (open → close, or open → now if still active)
    CASE
      WHEN s.opened_at IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (COALESCE(s.closed_at, NOW()) - s.opened_at)) / 86400.0
    END                                           AS days_held
  FROM public.spreads s
  LEFT JOIN leg_pnl lp ON lp.spread_id = s.id
  WHERE s.deleted_at IS NULL
)
SELECT
  m.*,

  -- Realized APR on capital (linear, no compounding)
  CASE
    WHEN m.capital_deployed_usd IS NULL OR m.capital_deployed_usd = 0 THEN NULL
    WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
    ELSE (m.net_pnl_quote / m.capital_deployed_usd) * (365.0 / m.days_held)
  END                                             AS realized_apr,

  -- bps captured net = net/capital * 10000 (cross-exchange, DEX-CEX framing)
  CASE
    WHEN m.capital_deployed_usd IS NULL OR m.capital_deployed_usd = 0 THEN NULL
    ELSE (m.net_pnl_quote / m.capital_deployed_usd) * 10000
  END                                             AS bps_captured_net,

  -- bps/day = bps_captured_net / days_held (calendar framing)
  CASE
    WHEN m.capital_deployed_usd IS NULL OR m.capital_deployed_usd = 0 THEN NULL
    WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
    ELSE ((m.net_pnl_quote / m.capital_deployed_usd) * 10000) / m.days_held
  END                                             AS bps_per_day,

  -- realized vs expected APR (>1 = beat thesis; <0.7 = thesis underdelivered)
  CASE
    WHEN m.target_apr_at_open IS NULL OR m.target_apr_at_open = 0 THEN NULL
    WHEN m.capital_deployed_usd IS NULL OR m.capital_deployed_usd = 0 THEN NULL
    WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
    ELSE ((m.net_pnl_quote / m.capital_deployed_usd) * (365.0 / m.days_held))
         / m.target_apr_at_open
  END                                             AS realized_vs_expected_apr,

  -- ---- Per-type card headline: what the trader's eye lands on first ----
  -- (metric name + numeric value + display format; frontend renders blindly)
  CASE m.spread_type
    WHEN 'cross_exchange_perp_arb' THEN 'bps_captured'
    WHEN 'cash_carry'              THEN 'realized_apr'
    WHEN 'calendar'                THEN 'bps_per_day'
    WHEN 'funding_capture'         THEN 'realized_apr'
    WHEN 'dex_cex_arb'             THEN 'bps_captured'
    ELSE                                'net_pnl_quote'
  END                                             AS card_headline_metric,

  CASE m.spread_type
    WHEN 'cross_exchange_perp_arb'
      THEN (m.net_pnl_quote / NULLIF(m.capital_deployed_usd, 0)) * 10000
    WHEN 'cash_carry'
      THEN CASE WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
                ELSE (m.net_pnl_quote / NULLIF(m.capital_deployed_usd, 0))
                     * (365.0 / m.days_held) END
    WHEN 'calendar'
      THEN CASE WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
                ELSE ((m.net_pnl_quote / NULLIF(m.capital_deployed_usd, 0)) * 10000)
                     / m.days_held END
    WHEN 'funding_capture'
      THEN CASE WHEN m.days_held IS NULL OR m.days_held = 0 THEN NULL
                ELSE (m.net_pnl_quote / NULLIF(m.capital_deployed_usd, 0))
                     * (365.0 / m.days_held) END
    WHEN 'dex_cex_arb'
      THEN (m.net_pnl_quote / NULLIF(m.capital_deployed_usd, 0)) * 10000
    ELSE m.net_pnl_quote
  END                                             AS card_headline_value,

  CASE m.spread_type
    WHEN 'cross_exchange_perp_arb' THEN 'bps'
    WHEN 'cash_carry'              THEN 'apr_pct'
    WHEN 'calendar'                THEN 'bps_per_day'
    WHEN 'funding_capture'         THEN 'apr_pct'
    WHEN 'dex_cex_arb'             THEN 'bps'
    ELSE                                'usd'
  END                                             AS card_headline_format
FROM metrics m;

COMMENT ON VIEW public.spread_pnl IS
  'Per-spread aggregate + PnL decomposition + per-type card headline. Source for /spreads list, /spreads/[id] detail page, and post-trade review thesis-delta.';

GRANT SELECT ON public.spread_pnl TO authenticated;
