-- ============================================================================
-- Migration 003: ExchangeConnection — user's link to an exchange
--
-- Encryption strategy (v1, documented in docs/specs/architecture.md):
--   - API key/secret/passphrase stored in Supabase Vault (pgsodium-backed).
--     The connection row holds opaque secret_id UUIDs only.
--   - Wallet addresses are encrypted with pgsodium AEAD at column level
--     (we need them as query-able read keys, so col-resident).
--   - Plaintext credentials never appear in regular queries.
--   - Plaintext fetched only via security-definer functions which check ownership.
--
-- Future migration path (when product goes public): replace Vault with
-- app-layer envelope encryption + external KMS — see security audit doc.
-- ============================================================================

create table public.exchange_connections (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  exchange_code            text not null references public.exchange_catalog(code),
  label                    text not null,
  connection_type          text not null check (connection_type in ('api_key', 'wallet_address')),

  -- Vault secret IDs (opaque UUIDs — plaintext lives in vault.secrets)
  api_key_secret_id        uuid,
  api_secret_secret_id     uuid,
  api_passphrase_secret_id uuid,
  -- Last 4 chars of api_key for UI display (never logged in full)
  api_key_hint             text,

  -- Wallet (encrypted at column level)
  wallet_address_encrypted bytea,
  wallet_address_nonce     bytea,
  wallet_chain             text,

  -- Operational state
  status                   connection_status not null default 'pending',
  status_message           text,
  last_sync_at             timestamptz,
  last_sync_cursor         text,
  last_fill_at             timestamptz,
  fills_synced             bigint not null default 0,

  -- Permissions snapshot — read-only enforcement
  permissions_json         jsonb not null default '{}'::jsonb,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint chk_api_or_wallet check (
    (connection_type = 'api_key'
       and api_key_secret_id is not null
       and api_secret_secret_id is not null
       and wallet_address_encrypted is null)
    or
    (connection_type = 'wallet_address'
       and wallet_address_encrypted is not null
       and api_key_secret_id is null)
  ),

  constraint uq_user_exchange_label unique (user_id, exchange_code, label)
);

comment on table public.exchange_connections is
  'A user link to a single exchange account (API key) or wallet (read-only). Secrets stored in Supabase Vault.';
comment on column public.exchange_connections.api_key_secret_id is
  'FK to vault.secrets. Plaintext retrieved via get_exchange_credentials() (owner) or worker_get_exchange_credentials() (service-role).';
comment on column public.exchange_connections.wallet_address_encrypted is
  'pgsodium AEAD-encrypted wallet address. Plaintext via get_wallet_address() function.';
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

-- ============================================================================
-- Credential helpers
-- ============================================================================

-- Store credentials: callable by authenticated user (security definer wraps Vault write)
create or replace function public.store_exchange_api_credentials(
  p_connection_id  uuid,
  p_api_key        text,
  p_api_secret     text,
  p_api_passphrase text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_owner uuid;
  v_key_secret_id uuid;
  v_secret_secret_id uuid;
  v_passphrase_secret_id uuid;
  v_hint text;
begin
  select user_id into v_owner
    from public.exchange_connections
    where id = p_connection_id and deleted_at is null;

  if v_owner is null then
    raise exception 'Connection not found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- Store in Vault — returns UUID
  v_key_secret_id := vault.create_secret(p_api_key, 'connection_' || p_connection_id::text || '_key');
  v_secret_secret_id := vault.create_secret(p_api_secret, 'connection_' || p_connection_id::text || '_secret');

  if p_api_passphrase is not null then
    v_passphrase_secret_id := vault.create_secret(p_api_passphrase, 'connection_' || p_connection_id::text || '_passphrase');
  end if;

  v_hint := '••••' || right(p_api_key, 4);

  update public.exchange_connections
    set api_key_secret_id = v_key_secret_id,
        api_secret_secret_id = v_secret_secret_id,
        api_passphrase_secret_id = v_passphrase_secret_id,
        api_key_hint = v_hint,
        updated_at = now()
    where id = p_connection_id;
end;
$$;

comment on function public.store_exchange_api_credentials is
  'Store API credentials in Supabase Vault. Callable by owner only (auth.uid() check).';

revoke all on function public.store_exchange_api_credentials(uuid, text, text, text) from public;
grant execute on function public.store_exchange_api_credentials(uuid, text, text, text) to authenticated;

-- Read credentials: owner-only (via auth.uid)
create or replace function public.get_exchange_credentials(p_connection_id uuid)
returns table (api_key text, api_secret text, api_passphrase text)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_owner uuid;
  v_api_key_id uuid;
  v_api_secret_id uuid;
  v_passphrase_id uuid;
begin
  select user_id, api_key_secret_id, api_secret_secret_id, api_passphrase_secret_id
    into v_owner, v_api_key_id, v_api_secret_id, v_passphrase_id
    from public.exchange_connections
    where id = p_connection_id and deleted_at is null;

  if v_owner is null then
    raise exception 'Connection not found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'Not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      (select decrypted_secret from vault.decrypted_secrets where id = v_api_key_id),
      (select decrypted_secret from vault.decrypted_secrets where id = v_api_secret_id),
      case
        when v_passphrase_id is null then null
        else (select decrypted_secret from vault.decrypted_secrets where id = v_passphrase_id)
      end;
end;
$$;

comment on function public.get_exchange_credentials is
  'Return plaintext API credentials — owner-only via auth.uid() check.';

revoke all on function public.get_exchange_credentials(uuid) from public;
grant execute on function public.get_exchange_credentials(uuid) to authenticated;

-- Worker credential read: bypasses auth.uid() — only callable with service_role.
-- Worker runs on Hetzner with service_role key; this function is the ONLY way
-- for it to fetch plaintext. Plaintext is then immediately zeroed in worker memory.
create or replace function public.worker_get_exchange_credentials(p_connection_id uuid)
returns table (
  user_id          uuid,
  exchange_code    text,
  connection_type  text,
  api_key          text,
  api_secret       text,
  api_passphrase   text,
  wallet_address   text,
  wallet_chain     text
)
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_role text;
begin
  -- Reject if not service_role
  select current_setting('request.jwt.claim.role', true) into v_role;
  if v_role is null or v_role <> 'service_role' then
    raise exception 'Service-role required' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      ec.user_id,
      ec.exchange_code,
      ec.connection_type,
      case when ec.api_key_secret_id is null then null
           else (select decrypted_secret from vault.decrypted_secrets where id = ec.api_key_secret_id) end,
      case when ec.api_secret_secret_id is null then null
           else (select decrypted_secret from vault.decrypted_secrets where id = ec.api_secret_secret_id) end,
      case when ec.api_passphrase_secret_id is null then null
           else (select decrypted_secret from vault.decrypted_secrets where id = ec.api_passphrase_secret_id) end,
      case when ec.wallet_address_encrypted is null then null
           else convert_from(
                  pgsodium.crypto_aead_det_decrypt(
                    ec.wallet_address_encrypted,
                    convert_to(ec.user_id::text, 'utf8'),
                    pgsodium.derive_key(ec.id::oid),
                    ec.wallet_address_nonce
                  ), 'utf8') end,
      ec.wallet_chain
    from public.exchange_connections ec
    where ec.id = p_connection_id and ec.deleted_at is null;
end;
$$;

comment on function public.worker_get_exchange_credentials is
  'Service-role-only: returns plaintext credentials for the Python worker. Worker must zero memory after use.';

revoke all on function public.worker_get_exchange_credentials(uuid) from public, authenticated;
grant execute on function public.worker_get_exchange_credentials(uuid) to service_role;

-- Store wallet address (encrypted at column-level via pgsodium AEAD)
create or replace function public.store_wallet_address(
  p_connection_id uuid,
  p_wallet_address text,
  p_chain text default null
)
returns void
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  v_owner uuid;
  v_nonce bytea;
  v_encrypted bytea;
begin
  select user_id into v_owner
    from public.exchange_connections
    where id = p_connection_id and deleted_at is null;

  if v_owner is null then raise exception 'Connection not found'; end if;
  if v_owner <> auth.uid() then raise exception 'Not authorized' using errcode = 'insufficient_privilege'; end if;

  v_nonce := pgsodium.crypto_aead_det_noncegen();
  v_encrypted := pgsodium.crypto_aead_det_encrypt(
    convert_to(p_wallet_address, 'utf8'),
    convert_to(v_owner::text, 'utf8'),
    pgsodium.derive_key(p_connection_id::oid),
    v_nonce
  );

  update public.exchange_connections
    set wallet_address_encrypted = v_encrypted,
        wallet_address_nonce = v_nonce,
        wallet_chain = p_chain,
        updated_at = now()
    where id = p_connection_id;
end;
$$;

revoke all on function public.store_wallet_address(uuid, text, text) from public;
grant execute on function public.store_wallet_address(uuid, text, text) to authenticated;
