-- ============================================================================
-- Migration v5.3 — Manual reminders
--
-- Adds a `reminders` table for user-created reminders that surface through the
-- existing notification bell. A reminder can optionally be linked to an
-- activity (so it can deep-link into the detail page) or stand alone.
--
-- The lazy notification scanner (scanAndSync) picks up DUE reminders and
-- materializes a `manual_reminder` notification row, deduped via a partial
-- unique index on (user_id, reminder_id). This mirrors the existing
-- deadline-notification flow exactly — no cron, idempotent on every poll.
--
-- Lifecycle: deleting a reminder cascades to remove its notification (FK
-- `on delete cascade`). Completing/dismissing a reminder stamps a timestamp
-- on the reminder AND dismisses any already-materialized notification (done
-- in the app layer — src/lib/db/reminders.ts), so the bell stays in sync.
--
-- Additive only. Reversibility: drop the `reminders` table, drop the
-- `reminder_id` column + its index on `notifications`. The enum value
-- `manual_reminder` cannot be removed from `notification_kind` (Postgres has
-- no DROP VALUE) but is harmless if unused.
-- ============================================================================

-- 1. Extend the notification-kind enum --------------------------------------
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on older
-- Postgres. The `pnpm db:migrate` script runs each file with plain `psql -f`
-- (no `--single-transaction`), so every statement here auto-commits as its
-- own transaction — exactly as migration 010 (v1_spread_vocabulary) relies on.
-- That means the new value is committed before any later statement in this
-- file references it, and it applies cleanly on Postgres and PGlite alike.
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'manual_reminder';

-- 2. reminders table --------------------------------------------------------

create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Optional link to an activity. ON DELETE CASCADE so deleting an activity
  -- wipes its reminders too — consistent with every other activity-linked
  -- table (activity_tag, activity_excursion, …).
  activity_id   uuid references public.activity(id) on delete cascade,
  remind_at     timestamptz not null,
  title         text not null check (length(trim(title)) > 0 and length(title) <= 200),
  note          text check (note is null or length(note) <= 2000),
  created_at    timestamptz not null default now(),
  -- Set when the user marks the reminder done. Pending = both NULL.
  completed_at  timestamptz,
  -- Set when the user dismisses the reminder without completing it.
  dismissed_at  timestamptz
);

comment on table public.reminders is
  'User-created manual reminders. Surface through the notification bell once '
  'remind_at passes (materialized by scanAndSync). Pending = completed_at IS '
  'NULL AND dismissed_at IS NULL.';

-- Pending-reminder lookup + scanner ordering both filter/sort on this pair.
create index reminders_user_remind_at_idx
  on public.reminders (user_id, remind_at);

-- 3. RLS — owner-only, mirroring public.notifications -----------------------

alter table public.reminders enable row level security;

create policy reminders_owner_select on public.reminders
  for select using (user_id = auth.uid());

create policy reminders_owner_insert on public.reminders
  for insert with check (user_id = auth.uid());

create policy reminders_owner_update on public.reminders
  for update using (user_id = auth.uid());

create policy reminders_owner_delete on public.reminders
  for delete using (user_id = auth.uid());

-- 4. Link notifications back to their source reminder -----------------------
--
-- Nullable: only `manual_reminder` rows carry a reminder_id; every existing
-- kind leaves it NULL. ON DELETE CASCADE means deleting a reminder removes
-- its materialized notification automatically.
alter table public.notifications
  add column if not exists reminder_id uuid
    references public.reminders(id) on delete cascade;

-- Dedupe: at most one notification per (user, reminder). Partial so the
-- millions of reminder_id-NULL rows from other kinds don't collide. The
-- scanner's `ON CONFLICT (user_id, reminder_id) WHERE reminder_id IS NOT NULL`
-- targets exactly this index.
create unique index notifications_reminder_dedupe_idx
  on public.notifications (user_id, reminder_id)
  where reminder_id is not null;
