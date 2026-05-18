-- wipe-user-data.sql
-- Removes all user-generated data while preserving:
--   profiles / allowlist  (the demo user row stays)
--   exchange_catalog      (static reference: Binance/Bybit/etc)
--   spread_type_catalog   (static reference: spread types)
--
-- Run:  psql -d crypto_spread_journal -f scripts/wipe-user-data.sql
--
-- Using TRUNCATE … CASCADE so FK order is handled automatically,
-- but we still list children before parents for clarity.

BEGIN;

-- ── Leaf tables (no FK dependents) ────────────────────────────────────────
TRUNCATE TABLE saved_views       CASCADE;
TRUNCATE TABLE activity_tag      CASCADE;
TRUNCATE TABLE activity_tags     CASCADE;
TRUNCATE TABLE activity_option_leg CASCADE;
TRUNCATE TABLE activity_screenshot CASCADE;

-- ── Note attachments before notes ────────────────────────────────────────
TRUNCATE TABLE note_attachments  CASCADE;
TRUNCATE TABLE notes             CASCADE;

-- ── Activity sub-type tables (FK → activity) ──────────────────────────────
TRUNCATE TABLE activity_airdrop        CASCADE;
TRUNCATE TABLE activity_excursion      CASCADE;
TRUNCATE TABLE activity_option         CASCADE;
TRUNCATE TABLE activity_sale           CASCADE;
TRUNCATE TABLE activity_satisfaction   CASCADE;
TRUNCATE TABLE activity_spread         CASCADE;    -- spread_legs FK → this
TRUNCATE TABLE activity_trade          CASCADE;
TRUNCATE TABLE activity_yield_position CASCADE;

-- ── Spread legs (FK → activity_spread) ───────────────────────────────────
TRUNCATE TABLE spread_legs       CASCADE;

-- ── Spread candidates (FK → activity) ────────────────────────────────────
TRUNCATE TABLE spread_candidates CASCADE;

-- ── Tags (FK ← activity_tags, already cleared) ────────────────────────────
TRUNCATE TABLE tags              CASCADE;

-- ── Root activity table ───────────────────────────────────────────────────
TRUNCATE TABLE activity          CASCADE;

-- ── Event log (FK → activity, already cleared) ────────────────────────────
TRUNCATE TABLE event_log         CASCADE;

-- ── Exchange connection dependents ────────────────────────────────────────
TRUNCATE TABLE fills             CASCADE;
TRUNCATE TABLE funding_events    CASCADE;
TRUNCATE TABLE exchange_balances CASCADE;
TRUNCATE TABLE sync_jobs         CASCADE;
TRUNCATE TABLE mark_prices       CASCADE;

-- ── Positions (FK ← fills/activity_trade/spread_legs) ────────────────────
TRUNCATE TABLE positions         CASCADE;

-- ── Portfolio snapshots ───────────────────────────────────────────────────
TRUNCATE TABLE portfolio_snapshots CASCADE;

-- ── Exchange connections (parent of fills/balances/sync_jobs/positions) ───
TRUNCATE TABLE exchange_connections CASCADE;

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────
SELECT
  'activity'            AS tbl, count(*) FROM activity            UNION ALL
SELECT 'activity_airdrop',      count(*) FROM activity_airdrop    UNION ALL
SELECT 'activity_excursion',    count(*) FROM activity_excursion  UNION ALL
SELECT 'activity_option',       count(*) FROM activity_option     UNION ALL
SELECT 'activity_option_leg',   count(*) FROM activity_option_leg UNION ALL
SELECT 'activity_sale',         count(*) FROM activity_sale       UNION ALL
SELECT 'activity_satisfaction', count(*) FROM activity_satisfaction UNION ALL
SELECT 'activity_screenshot',   count(*) FROM activity_screenshot UNION ALL
SELECT 'activity_spread',       count(*) FROM activity_spread     UNION ALL
SELECT 'activity_tag',          count(*) FROM activity_tag        UNION ALL
SELECT 'activity_tags',         count(*) FROM activity_tags       UNION ALL
SELECT 'activity_trade',        count(*) FROM activity_trade      UNION ALL
SELECT 'activity_yield_position', count(*) FROM activity_yield_position UNION ALL
SELECT 'event_log',             count(*) FROM event_log           UNION ALL
SELECT 'exchange_balances',     count(*) FROM exchange_balances   UNION ALL
SELECT 'exchange_connections',  count(*) FROM exchange_connections UNION ALL
SELECT 'fills',                 count(*) FROM fills               UNION ALL
SELECT 'funding_events',        count(*) FROM funding_events      UNION ALL
SELECT 'mark_prices',           count(*) FROM mark_prices         UNION ALL
SELECT 'note_attachments',      count(*) FROM note_attachments    UNION ALL
SELECT 'notes',                 count(*) FROM notes               UNION ALL
SELECT 'portfolio_snapshots',   count(*) FROM portfolio_snapshots UNION ALL
SELECT 'positions',             count(*) FROM positions           UNION ALL
SELECT 'saved_views',           count(*) FROM saved_views         UNION ALL
SELECT 'spread_candidates',     count(*) FROM spread_candidates   UNION ALL
SELECT 'spread_legs',           count(*) FROM spread_legs         UNION ALL
SELECT 'sync_jobs',             count(*) FROM sync_jobs           UNION ALL
SELECT 'tags',                  count(*) FROM tags
ORDER BY 1;

-- Preserved tables (should stay non-zero):
SELECT 'profiles (KEPT)'         AS tbl, count(*) FROM profiles          UNION ALL
SELECT 'allowlist (KEPT)',                count(*) FROM allowlist         UNION ALL
SELECT 'exchange_catalog (KEPT)',         count(*) FROM exchange_catalog  UNION ALL
SELECT 'spread_type_catalog (KEPT)',      count(*) FROM spread_type_catalog
ORDER BY 1;
