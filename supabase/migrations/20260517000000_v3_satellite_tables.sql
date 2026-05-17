-- ============================================================================
-- Migration 013 — v3: Satellite tables for journaling per-activity context.
--
-- Design doc: docs/specs/2026-05-17-satellite-tables-design.md (forthcoming).
--
-- Adds four NEW satellite tables, each FK'd to public.activity(id) with
-- ON DELETE CASCADE so removing the parent activity wipes the entire
-- journaling context in one transaction.
--
--   1. activity_tag           — free-form string tags (one row per activity+tag)
--   2. activity_excursion     — MAE/MFE/stop_loss per activity (one row max)
--   3. activity_screenshot    — annotated chart screenshots (file path + state)
--   4. activity_satisfaction  — thumbs up/down on the trade execution
--
-- Naming note:
--   public.activity_tags (plural, M:N to public.tags) already exists from
--   migration 007/012 — it joins activities to the controlled-vocabulary
--   `tags` table. THIS migration adds `activity_tag` (singular) for free-form
--   string tags that are not part of any vocabulary. The two coexist.
--
-- Triggers:
--   - bump_activity_updated_at: already defined in migration 012. Reused for
--     the new satellite tables so editing a tag / excursion / screenshot /
--     satisfaction bumps the parent activity's updated_at column.
--
-- RLS: each table has its own owner-only policy. Satellite tables that have a
--   denormalized user_id column filter on it directly; activity_satisfaction
--   joins to activity for the check (no user_id column).
--
-- Reversibility: drop the four tables. No data migration required.
-- ============================================================================

-- 1. activity_tag — free-form setup tags ------------------------------------

create table public.activity_tag (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activity(id) on delete cascade,
  tag         text not null check (length(trim(tag)) > 0 and length(tag) <= 60),
  created_at  timestamptz not null default now(),

  constraint uq_activity_tag unique (activity_id, tag)
);

comment on table public.activity_tag is
  'Free-form setup/strategy tags per activity. One row per (activity, tag). '
  'Distinct from public.activity_tags (the M:N join to controlled-vocabulary tags).';

create index activity_tag_user_idx     on public.activity_tag (user_id, tag);
create index activity_tag_activity_idx on public.activity_tag (activity_id);

-- 2. activity_excursion — MAE / MFE / stop_loss -----------------------------

create table public.activity_excursion (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  activity_id     uuid not null references public.activity(id) on delete cascade,
  stop_loss_price numeric(38, 18),
  mae_price       numeric(38, 18),
  mfe_price       numeric(38, 18),
  mae_at          timestamptz,
  mfe_at          timestamptz,
  -- 'manual' = trader-entered, 'kline_backfill' = worker-computed from candles.
  source          text not null default 'manual'
                  check (source in ('manual', 'kline_backfill')),
  backfilled_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint uq_activity_excursion unique (activity_id)
);

comment on table public.activity_excursion is
  'Max adverse / favorable excursion and pre-trade stop-loss per activity. '
  'One row per activity (UNIQUE on activity_id). source flags trader-entered '
  'vs worker-backfilled from kline data.';

create index activity_excursion_activity_idx on public.activity_excursion (activity_id);
create index activity_excursion_user_idx     on public.activity_excursion (user_id);

create trigger activity_excursion_updated_at
  before update on public.activity_excursion
  for each row execute function public.tg_set_updated_at();

-- 3. activity_screenshot — annotated chart screenshots -----------------------
--
-- Bytes live on disk; this table is metadata. storage_key is a relative path
-- under SCREENSHOT_STORAGE_DIR. Format: "<userId>/<activityId>/<uuid>.<ext>".
-- annotation_state is the MarkerJS2 marker state for re-editing later.

create table public.activity_screenshot (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  activity_id      uuid not null references public.activity(id) on delete cascade,
  side             text not null check (side in ('entry', 'exit', 'context')),
  storage_key      text not null,
  original_width   int  check (original_width  is null or original_width  > 0),
  original_height  int  check (original_height is null or original_height > 0),
  annotation_state jsonb,
  caption          text check (caption is null or length(caption) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.activity_screenshot is
  'Annotated chart screenshot for an activity. Bytes on disk; this is metadata. '
  'storage_key is relative to SCREENSHOT_STORAGE_DIR — never an absolute path.';
comment on column public.activity_screenshot.annotation_state is
  'MarkerJS2 marker state (JSON) so the trader can re-edit existing annotations.';
comment on column public.activity_screenshot.side is
  'Which moment of the trade the screenshot captures: entry / exit / context.';

create index activity_screenshot_activity_idx on public.activity_screenshot (activity_id);
create index activity_screenshot_user_idx     on public.activity_screenshot (user_id);

create trigger activity_screenshot_updated_at
  before update on public.activity_screenshot
  for each row execute function public.tg_set_updated_at();

-- 4. activity_satisfaction — thumbs up/down ----------------------------------
--
-- Binary verdict on the execution. Composite PK is just activity_id since the
-- relation is 1:1 with activity. user_id deliberately omitted from the PK so
-- callers cannot create duplicate rows by varying user_id.

create table public.activity_satisfaction (
  activity_id  uuid not null references public.activity(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  satisfaction boolean not null,
  reason       text check (reason is null or length(reason) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (activity_id)
);

comment on table public.activity_satisfaction is
  'Trader self-rating of an activity execution: thumbs up (satisfaction=true) '
  'or thumbs down (false). One row per activity.';

create index activity_satisfaction_user_idx on public.activity_satisfaction (user_id);

create trigger activity_satisfaction_updated_at
  before update on public.activity_satisfaction
  for each row execute function public.tg_set_updated_at();

-- 5. Bump parent activity.updated_at on satellite writes ---------------------
--
-- We reuse public.bump_activity_updated_at() from migration 012 for insert/
-- update. That function reads NEW.activity_id, which is NULL on DELETE — so
-- delete-driven cache invalidation lives in the app layer (the setTagsFor-
-- Activity helper explicitly bumps activity.updated_at in the same trans-
-- action when it replaces tags wholesale).

create trigger activity_tag_bump_parent
  after insert or update on public.activity_tag
  for each row execute function public.bump_activity_updated_at();

create trigger activity_excursion_bump_parent
  after insert or update on public.activity_excursion
  for each row execute function public.bump_activity_updated_at();

create trigger activity_screenshot_bump_parent
  after insert or update on public.activity_screenshot
  for each row execute function public.bump_activity_updated_at();

create trigger activity_satisfaction_bump_parent
  after insert or update on public.activity_satisfaction
  for each row execute function public.bump_activity_updated_at();

-- 6. RLS policies ------------------------------------------------------------

alter table public.activity_tag enable row level security;
create policy activity_tag_owner_all on public.activity_tag
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.activity_excursion enable row level security;
create policy activity_excursion_owner_all on public.activity_excursion
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.activity_screenshot enable row level security;
create policy activity_screenshot_owner_all on public.activity_screenshot
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- activity_satisfaction has a user_id column too — direct check, no join.
alter table public.activity_satisfaction enable row level security;
create policy activity_satisfaction_owner_all on public.activity_satisfaction
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- bump_activity_updated_at trigger runs UPDATE on public.activity. Since the
-- function is SECURITY INVOKER (default), it runs as the calling role; the
-- existing activity RLS policy already gates that update by user_id = auth.uid(),
-- so the satellite write paths can't bump an activity they don't own.
