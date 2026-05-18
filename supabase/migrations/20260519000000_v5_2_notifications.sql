-- ============================================================================
-- Migration v5.2: In-app notifications
--
-- Stores deadline-triggered notifications per user. The scanner runs
-- lazily inside the GET /api/notifications handler — no cron needed.
-- Idempotency is guaranteed via a partial unique index on (user_id, kind,
-- activity_id) so repeated scans are safe.
-- ============================================================================

-- Notification kind enum
create type notification_kind as enum (
  'deadline_t_minus_3',
  'deadline_t_minus_1',
  'deadline_today',
  'deadline_overdue',
  'drift_warning'
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           notification_kind not null,
  title          text not null,
  body           text,
  activity_id    uuid references public.activity(id) on delete cascade,
  href           text,
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  dismissed_at   timestamptz
);

-- Dedupe: one notification per (user, kind, activity).
-- drift_warning rows have activity_id IS NULL so the partial index
-- doesn't block them (they use the (user_id, kind) pair instead,
-- and are managed outside the scanner).
create unique index notifications_dedupe_idx
  on public.notifications (user_id, kind, activity_id)
  where activity_id is not null;

-- Unread lookup index — covers the bell count query and the dropdown query.
create index notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null and dismissed_at is null;

-- RLS — owner-only, matching the existing pattern across the schema.
alter table public.notifications enable row level security;

create policy notifications_owner_select on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_owner_insert on public.notifications
  for insert with check (user_id = auth.uid());

create policy notifications_owner_update on public.notifications
  for update using (user_id = auth.uid());

create policy notifications_owner_delete on public.notifications
  for delete using (user_id = auth.uid());
