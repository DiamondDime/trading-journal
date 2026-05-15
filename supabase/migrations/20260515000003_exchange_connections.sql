-- ============================================================================
-- Migration 003: ExchangeConnection — user's link to an exchange
--
-- Encryption strategy (v1):
--   - API key/secret/passphrase AND wallet address encrypted at APP LAYER
--     with AES-256-GCM. Master key in env vars (Next.js + worker).
--   - Supabase only ever sees ciphertext.
--   - Plaintext only briefly in Next.js during key submission (write side),
--     and on the Hetzner worker during exchange calls (read side).
--
-- Migration path to v2 (when going public): replace env-based master key
-- with KMS-managed key — only the key-fetch changes; ciphertext format stays.
-- ============================================================================

create table public.exchange_connections (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  exchange_code               text not null references public.exchange_catalog(code),
  label                       text not null,
  connection_type             text not null check (connection_type in ('api_key', 'wallet_address')),

  -- App-layer AES-256-GCM ciphertexts. Each field has its own random nonce.
  api_key_ciphertext          bytea,
  api_key_nonce               bytea,
  api_secret_ciphertext       bytea,
  api_secret_nonce            bytea,
  api_passphrase_ciphertext   bytea,
  api_passphrase_nonce        bytea,
  -- Last-4 of api_key for UI display (never log full)
  api_key_hint                text,

  -- Wallet address (DEX) — also encrypted: linkage to user identity is privacy-sensitive
  wallet_address_ciphertext   bytea,
  wallet_address_nonce        bytea,
  wallet_chain                text,

  -- Encryption key version — supports rotation without re-encrypting old rows
  encryption_key_version      integer not null default 1,

  -- Operational state
  status                      connection_status not null default 'pending',
  status_message              text,
  last_sync_at                timestamptz,
  last_sync_cursor            text,
  last_fill_at                timestamptz,
  fills_synced                bigint not null default 0,

  -- Permissions snapshot — read-only enforcement
  permissions_json            jsonb not null default '{}'::jsonb,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,

  constraint chk_api_or_wallet check (
    (connection_type = 'api_key'
       and api_key_ciphertext is not null
       and api_secret_ciphertext is not null
       and wallet_address_ciphertext is null)
    or
    (connection_type = 'wallet_address'
       and wallet_address_ciphertext is not null
       and api_key_ciphertext is null)
    or
    (status = 'pending'  -- allow incomplete row briefly during insert→encrypt flow
       and api_key_ciphertext is null
       and api_secret_ciphertext is null
       and wallet_address_ciphertext is null)
  ),

  constraint uq_user_exchange_label unique (user_id, exchange_code, label)
);

comment on table public.exchange_connections is
  'A user link to a single exchange account (API key) or wallet (read-only). Credentials AES-256-GCM encrypted at app layer.';
comment on column public.exchange_connections.api_key_ciphertext is
  'AES-256-GCM ciphertext of api_key. Decrypted only on Hetzner worker using CREDENTIALS_MASTER_KEY env var.';
comment on column public.exchange_connections.encryption_key_version is
  'Key version for rotation support. v1 = base64 master key in env. v2+ = KMS-managed.';
comment on column public.exchange_connections.permissions_json is
  'Snapshot of permissions the API key reports. Rejected at connect-time if withdraw permission detected.';

create index exchange_connections_user_id_idx
  on public.exchange_connections (user_id)
  where deleted_at is null;

create index exchange_connections_status_idx
  on public.exchange_connections (status, last_sync_at)
  where deleted_at is null;

create index exchange_connections_sync_due_idx
  on public.exchange_connections (last_sync_at nulls first)
  where status = 'active' and deleted_at is null;

create trigger exchange_connections_updated_at
  before update on public.exchange_connections
  for each row execute function public.tg_set_updated_at();
