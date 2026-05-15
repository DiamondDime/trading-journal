-- ============================================================================
-- Migration 008: Row-Level Security policies
-- Rule: every user-scoped table denies all access unless user_id = auth.uid().
-- Reference tables (catalogs) are read-only for authenticated, admin-only for writes.
-- ============================================================================

-- allowlist
alter table public.allowlist enable row level security;

create policy allowlist_select_own_or_admin on public.allowlist
  for select to authenticated
  using (
    email = (select email from public.profiles where id = auth.uid())
    or public.is_admin(auth.uid())
  );

create policy allowlist_admin_all on public.allowlist
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- profiles
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- exchange_connections
alter table public.exchange_connections enable row level security;

create policy exchange_connections_owner_all on public.exchange_connections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- positions
alter table public.positions enable row level security;

create policy positions_owner_all on public.positions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- fills
alter table public.fills enable row level security;

create policy fills_owner_all on public.fills
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- funding_events
alter table public.funding_events enable row level security;

create policy funding_owner_all on public.funding_events
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- sync_jobs
alter table public.sync_jobs enable row level security;

create policy sync_jobs_owner_select on public.sync_jobs
  for select to authenticated using (user_id = auth.uid());
-- Inserts/updates done by service-role worker only

-- spreads
alter table public.spreads enable row level security;

create policy spreads_owner_all on public.spreads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- spread_legs
alter table public.spread_legs enable row level security;

create policy spread_legs_owner_all on public.spread_legs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- spread_candidates
alter table public.spread_candidates enable row level security;

create policy spread_candidates_owner_all on public.spread_candidates
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- tags
alter table public.tags enable row level security;

create policy tags_owner_all on public.tags
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- spread_tags
alter table public.spread_tags enable row level security;

create policy spread_tags_owner_all on public.spread_tags
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- saved_views
alter table public.saved_views enable row level security;

create policy saved_views_owner_all on public.saved_views
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- notes
alter table public.notes enable row level security;

create policy notes_owner_all on public.notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- note_attachments
alter table public.note_attachments enable row level security;

create policy note_attachments_owner_all on public.note_attachments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Reference catalogs
alter table public.exchange_catalog enable row level security;
alter table public.spread_type_catalog enable row level security;

create policy exchange_catalog_read on public.exchange_catalog
  for select to authenticated using (true);

create policy spread_type_catalog_read on public.spread_type_catalog
  for select to authenticated using (true);

create policy exchange_catalog_admin_write on public.exchange_catalog
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy spread_type_catalog_admin_write on public.spread_type_catalog
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
