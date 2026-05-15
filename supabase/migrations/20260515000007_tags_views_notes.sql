-- ============================================================================
-- Migration 007: Tags, SavedViews, Notes, NoteAttachments
-- ============================================================================

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#888888',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_tag_per_user unique (user_id, name)
);

comment on table public.tags is
  'User-defined controlled-vocabulary tags. For freeform tags use spreads.custom_tags.';

create index tags_user_idx on public.tags (user_id);

create trigger tags_updated_at
  before update on public.tags
  for each row execute function public.tg_set_updated_at();

-- Tag-to-spread M:N
create table public.spread_tags (
  spread_id   uuid not null references public.spreads(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (spread_id, tag_id)
);

create index spread_tags_tag_idx  on public.spread_tags (tag_id);
create index spread_tags_user_idx on public.spread_tags (user_id);

-- ============================================================================
-- SavedViews
-- ============================================================================

create table public.saved_views (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  scope         text not null check (scope in ('spreads', 'positions', 'fills')),
  filters       jsonb not null default '{}'::jsonb,
  sort          jsonb not null default '{}'::jsonb,
  columns       text[] not null default '{}',
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint uq_view_per_user unique (user_id, scope, name)
);

comment on table public.saved_views is
  'Persisted filter+sort+column configurations per scope.';

create index saved_views_user_scope_idx on public.saved_views (user_id, scope);
create unique index saved_views_one_default_per_scope
  on public.saved_views (user_id, scope)
  where is_default = true;

create trigger saved_views_updated_at
  before update on public.saved_views
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- Notes
-- ============================================================================

create table public.notes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  spread_id           uuid not null references public.spreads(id) on delete cascade,
  body                text not null default '',
  entry_rationale     text,
  exit_conclusion     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint uq_one_note_per_spread unique (spread_id)
);

comment on table public.notes is
  'One markdown note per Spread (1:1). entry_rationale and exit_conclusion are structured highlighted fields.';

create index notes_spread_idx on public.notes (spread_id) where deleted_at is null;
create index notes_user_idx   on public.notes (user_id, created_at desc) where deleted_at is null;
create index notes_body_trgm  on public.notes using gin (body gin_trgm_ops);

create trigger notes_updated_at
  before update on public.notes
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- NoteAttachments
-- ============================================================================

create table public.note_attachments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  note_id       uuid not null references public.notes(id) on delete cascade,
  filename      text not null,
  storage_path  text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0 and size_bytes <= 10485760),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.note_attachments is
  'File attached to a note (max 10MB). Bytes in Supabase Storage; this is metadata.';

create index note_attachments_note_idx on public.note_attachments (note_id);
create index note_attachments_user_idx on public.note_attachments (user_id);

create trigger note_attachments_updated_at
  before update on public.note_attachments
  for each row execute function public.tg_set_updated_at();
