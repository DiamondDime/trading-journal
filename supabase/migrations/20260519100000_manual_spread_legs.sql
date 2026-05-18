-- ============================================================================
-- Migration — Manual spread legs support
--
-- Allows spread_legs rows that are NOT linked to a position (manual entry
-- path where the user types symbol/price/qty directly rather than selecting
-- from imported exchange fills).
--
-- Changes:
--   1. Makes spread_legs.position_id nullable (was NOT NULL).
--   2. Drops the unique constraint uq_position_in_one_activity that relied
--      on position_id being non-null and unique — manual rows would all have
--      NULL which would violate uniqueness in Postgres.
--   3. Adds manual-leg columns: symbol, exchange_label, side, qty,
--      entry_price, exit_price, fees_usd, instrument_type.
--   4. Adds a CHECK: position_id IS NOT NULL OR symbol IS NOT NULL — so every
--      row has at least one identifying source.
--   5. Re-applies the unique constraint scoped to (activity_id, position_id)
--      with a WHERE position_id IS NOT NULL partial index so NULLs don't
--      violate it.
-- ============================================================================

-- 1. Make position_id nullable -----------------------------------------------

ALTER TABLE public.spread_legs
  ALTER COLUMN position_id DROP NOT NULL;

-- 2. Drop the all-row unique constraint on position_id -----------------------

ALTER TABLE public.spread_legs
  DROP CONSTRAINT IF EXISTS uq_position_in_one_activity;

-- 3. Add manual-leg columns --------------------------------------------------

ALTER TABLE public.spread_legs
  ADD COLUMN IF NOT EXISTS symbol          text,
  ADD COLUMN IF NOT EXISTS exchange_label  text,
  ADD COLUMN IF NOT EXISTS side            text,
  ADD COLUMN IF NOT EXISTS qty             numeric(38, 18),
  ADD COLUMN IF NOT EXISTS entry_price     numeric(38, 18),
  ADD COLUMN IF NOT EXISTS exit_price      numeric(38, 18),
  ADD COLUMN IF NOT EXISTS fees_usd        numeric(38, 18),
  ADD COLUMN IF NOT EXISTS instrument_type text;

COMMENT ON COLUMN public.spread_legs.symbol IS
  'Manual-entry leg: instrument symbol (e.g. BTC, BTC-PERP). NULL for position-linked rows.';
COMMENT ON COLUMN public.spread_legs.exchange_label IS
  'Manual-entry leg: free-text exchange name (e.g. Binance, Hyperliquid). NULL for position-linked rows.';
COMMENT ON COLUMN public.spread_legs.side IS
  'Manual-entry leg: long or short direction. For position-linked rows the side lives on positions.side.';
COMMENT ON COLUMN public.spread_legs.qty IS
  'Manual-entry leg: quantity. For position-linked rows this mirrors positions.total_qty.';
COMMENT ON COLUMN public.spread_legs.entry_price IS
  'Manual-entry leg: average entry price in USD. Equivalent to positions.avg_entry_price for position-linked rows.';
COMMENT ON COLUMN public.spread_legs.exit_price IS
  'Manual-entry leg: average exit price in USD. NULL when position is still open.';
COMMENT ON COLUMN public.spread_legs.fees_usd IS
  'Manual-entry leg: total round-trip fees in USD.';
COMMENT ON COLUMN public.spread_legs.instrument_type IS
  'Manual-entry leg: spot | perp | dated_future.';

-- 4. Integrity check: at least one of position_id or symbol must be set ------

ALTER TABLE public.spread_legs
  ADD CONSTRAINT chk_spread_leg_source
    CHECK (position_id IS NOT NULL OR symbol IS NOT NULL);

-- 5. Partial unique index: one position per activity (position-linked rows only)
-- This replaces the dropped all-row unique constraint with a partial index
-- so NULLs in position_id don't block multiple manual rows per spread.

DROP INDEX IF EXISTS public.spread_legs_position_idx;

CREATE UNIQUE INDEX spread_legs_unique_position
  ON public.spread_legs (position_id)
  WHERE position_id IS NOT NULL;

CREATE INDEX spread_legs_activity_position_idx
  ON public.spread_legs (activity_id, position_id)
  WHERE position_id IS NOT NULL;
