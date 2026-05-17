-- ============================================================================
-- v4 — Exchange catalog expansion (Wave 12B)
-- ============================================================================
-- Adds:
--   * logo_url           — placeholder for venue logo (UI wave populates).
--   * referral_url       — placeholder for venue affiliate link (user paste).
--   * supports_futures   — dated-future capability flag (separate from perp).
--   * supports_funding_history — explicit; not all venues expose funding.
--   * adapter_kind       — 'ccxt_universal' or 'bespoke' (matches the
--                          backend adapter registry).
--   * api_docs_url       — for traceability into the venue's official docs.
--   * notes              — operator-facing notes / quirks.
--
-- Backfills the new columns for every existing row, idempotently. Adds the
-- HTX entry that was missing from the original catalog.
--
-- All inserts use ON CONFLICT DO UPDATE so re-running this migration is safe.
-- ============================================================================

alter table public.exchange_catalog
  add column if not exists logo_url text,
  add column if not exists referral_url text,
  add column if not exists supports_futures boolean not null default false,
  add column if not exists supports_funding_history boolean not null default false,
  add column if not exists adapter_kind text not null default 'ccxt_universal'
    check (adapter_kind in ('ccxt_universal', 'bespoke')),
  add column if not exists api_docs_url text,
  add column if not exists notes text,
  add column if not exists priority integer not null default 100;

comment on column public.exchange_catalog.logo_url is
  'Public URL or relative path (/public/logos/<code>.svg) for the venue logo.';

comment on column public.exchange_catalog.referral_url is
  'Affiliate / referral URL for new-user signups. NULL when the user has not '
  'configured one. Surfaced in the connection UI as a "Get a key" link.';

comment on column public.exchange_catalog.supports_futures is
  'Dated-future contracts (separate from perpetuals). Binance + Gate + OKX + '
  'HTX have these; most others do not.';

comment on column public.exchange_catalog.adapter_kind is
  '''ccxt_universal'' = ccxt-backed via CcxtUniversalAdapter; ''bespoke'' = '
  'hand-built adapter (only Hyperliquid currently — no ccxt coverage).';

comment on column public.exchange_catalog.priority is
  'Sort order in selection UIs (lower = higher priority). Defaults to 100.';


-- ============================================================================
-- Insert HTX (was missing from the original catalog)
-- ============================================================================

insert into public.exchange_catalog (
  code, display_name, venue_type, supports_spot, supports_perp, supports_options,
  auth_mode
) values (
  'htx', 'HTX', 'cex', true, true, false, 'api_key'
) on conflict (code) do nothing;


-- ============================================================================
-- Backfill capabilities + adapter_kind + api_docs_url for the 10 v1 CEX venues
-- ============================================================================

-- Binance
update public.exchange_catalog set
  display_name       = 'Binance',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = true,
  supports_futures   = true,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://developers.binance.com/docs/',
  priority           = 10,
  notes              = 'Largest CEX by volume. USD-M and coin-M perps supported via universal adapter.'
where code = 'binance';

-- Bybit
update public.exchange_catalog set
  display_name       = 'Bybit',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = true,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://bybit-exchange.github.io/docs/v5/intro',
  priority           = 20,
  notes              = 'v5 unified account. Linear + inverse perps + spot.'
where code = 'bybit';

-- OKX
update public.exchange_catalog set
  display_name       = 'OKX',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = true,
  supports_futures   = true,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://www.okx.com/docs-v5/en/',
  priority           = 30,
  notes              = 'Requires passphrase. Spot + SWAP + dated FUTURES + OPTION.'
where code = 'okx';

-- BingX
update public.exchange_catalog set
  display_name       = 'BingX',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://bingx-api.github.io/docs/',
  priority           = 40,
  notes              = 'No permission introspection — UI must require user attestation of read-only.'
where code = 'bingx';

-- Gate
update public.exchange_catalog set
  display_name       = 'Gate',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = true,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://www.gate.com/docs/developers/apiv4/',
  priority           = 50,
  notes              = 'Withdraw check via side-channel probe of /wallet/withdraw_status endpoint.'
where code = 'gate';

-- MEXC
update public.exchange_catalog set
  display_name       = 'MEXC',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://mexcdevelop.github.io/apidocs/',
  priority           = 60,
  notes              = 'No permission introspection — UI must require user attestation of read-only.'
where code = 'mexc';

-- KuCoin
update public.exchange_catalog set
  display_name       = 'KuCoin',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://docs.kucoin.com/futures/',
  priority           = 70,
  notes              = 'Requires passphrase. "Transfer" permission is the closest analog to withdraw.'
where code = 'kucoin';

-- Bitget
update public.exchange_catalog set
  display_name       = 'Bitget',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://www.bitget.com/api-doc/contract/intro',
  priority           = 80,
  notes              = 'Requires passphrase. v2 api-key-info endpoint exposes permsList.'
where code = 'bitget';

-- HTX
update public.exchange_catalog set
  display_name       = 'HTX',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = true,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://www.htx.com/en-us/opend/newApiPages/',
  priority           = 90,
  notes              = 'Formerly Huobi. ccxt 4.4+ uses ''htx'' as class name.'
where code = 'htx';

-- Phemex
update public.exchange_catalog set
  display_name       = 'Phemex',
  venue_type         = 'cex',
  supports_spot      = true,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'ccxt_universal',
  api_docs_url       = 'https://phemex-docs.github.io/',
  priority           = 100,
  notes              = 'No permission introspection — UI must require user attestation.'
where code = 'phemex';

-- Hyperliquid (bespoke; not on ccxt)
update public.exchange_catalog set
  display_name       = 'Hyperliquid',
  venue_type         = 'dex',
  supports_spot      = false,
  supports_perp      = true,
  supports_options   = false,
  supports_futures   = false,
  supports_funding_history = true,
  adapter_kind       = 'bespoke',
  api_docs_url       = 'https://hyperliquid.gitbook.io/hyperliquid-docs',
  priority           = 110,
  notes              = 'Wallet-based DEX. No ccxt coverage; bespoke adapter handles the proprietary /info endpoint.'
where code = 'hyperliquid';


-- ============================================================================
-- Mark non-v1 venues as is_active = false so they don't appear in the picker
-- until their adapters are wired. The user can flip them back on later.
-- ============================================================================

update public.exchange_catalog set
  is_active = false,
  adapter_kind = 'bespoke',
  notes = coalesce(notes, '') || ' (Not in v1 — adapter not implemented.)'
where code in ('deribit', 'okx_dex', 'aster', 'kraken');


-- ============================================================================
-- Sanity check: every active row that uses adapter_kind='ccxt_universal'
-- must have an api_docs_url set.
-- ============================================================================

do $$
declare
  missing_rows int;
begin
  select count(*) into missing_rows
  from public.exchange_catalog
  where is_active = true
    and adapter_kind = 'ccxt_universal'
    and (api_docs_url is null or api_docs_url = '');
  if missing_rows > 0 then
    raise exception 'exchange_catalog: % active ccxt_universal rows missing api_docs_url', missing_rows;
  end if;
end$$;
