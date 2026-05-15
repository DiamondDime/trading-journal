-- ============================================================================
-- Migration 006: Spread, SpreadLeg, SpreadCandidate
-- A Spread groups N positions as one strategy unit.
-- ============================================================================

create table public.spreads (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,

  spread_type              text not null references public.spread_type_catalog(code),
  status                   spread_status not null default 'candidate',
  origin                   spread_origin not null default 'manual',
  name                     text not null,
  primary_base             text not null,

  notes_summary            text,
  capital_deployed_usd     numeric(38,8),
  regime_tags              text[] not null default '{}',
  custom_tags              text[] not null default '{}',

  -- Cached aggregates (updated by worker on each sync)
  gross_pnl_quote          numeric(38,18) not null default 0,
  funding_pnl_quote        numeric(38,18) not null default 0,
  fees_pnl_quote           numeric(38,18) not null default 0,
  net_pnl_quote            numeric(38,18) not null default 0,
  apr                      numeric(20,8),
  exchanges                text[] not null default '{}',
  leg_count                integer not null default 0,
  match_confidence         numeric(5,4) check (match_confidence between 0 and 1),

  opened_at                timestamptz,
  closed_at                timestamptz,
  hold_duration_ms         bigint,

  source                   text not null default 'user' check (source in ('user', 'system')),
  system_proposal_metadata jsonb,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  constraint chk_spread_status_dates check (
    (status = 'candidate' and opened_at is null and closed_at is null) or
    (status = 'rejected') or
    (status = 'open'      and opened_at is not null and closed_at is null) or
    (status = 'closed'    and opened_at is not null and closed_at is not null)
  ),
  constraint chk_confidence_only_for_system check (
    match_confidence is null or source = 'system'
  )
);

comment on table public.spreads is
  'Multi-leg trading strategy. Aggregates N positions via spread_legs. Atomic unit of analysis.';
comment on column public.spreads.regime_tags is
  'System-assigned market regime tags. Examples: high_funding, low_funding, contango, backwardation.';
comment on column public.spreads.custom_tags is
  'User-defined freeform tags. For controlled tags use the Tag table.';

create index spreads_user_status_idx
  on public.spreads (user_id, status, opened_at desc nulls last)
  where deleted_at is null;

create index spreads_user_type_idx
  on public.spreads (user_id, spread_type, opened_at desc nulls last)
  where deleted_at is null;

create index spreads_user_apr_idx
  on public.spreads (user_id, apr desc nulls last)
  where deleted_at is null and status = 'closed';

create index spreads_user_opened_brin
  on public.spreads using brin (opened_at);

create index spreads_regime_tags_gin
  on public.spreads using gin (regime_tags);

create index spreads_custom_tags_gin
  on public.spreads using gin (custom_tags);

create index spreads_exchanges_gin
  on public.spreads using gin (exchanges);

create index spreads_name_trgm
  on public.spreads using gin (name gin_trgm_ops);

create trigger spreads_updated_at
  before update on public.spreads
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- SpreadLeg
-- ============================================================================

create table public.spread_legs (
  id            uuid primary key default gen_random_uuid(),
  spread_id     uuid not null references public.spreads(id) on delete cascade,
  position_id   uuid not null references public.positions(id) on delete restrict,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null,
  leg_index     integer not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint uq_spread_leg unique (spread_id, position_id),
  constraint uq_position_in_one_spread unique (position_id)
);

comment on table public.spread_legs is
  'Maps a Position into a Spread with a role label. A position participates in at most one spread.';
comment on column public.spread_legs.user_id is
  'Denormalized from parent spread for RLS efficiency.';

create index spread_legs_spread_idx   on public.spread_legs (spread_id, leg_index);
create index spread_legs_position_idx on public.spread_legs (position_id);
create index spread_legs_user_idx     on public.spread_legs (user_id);

create trigger spread_legs_updated_at
  before update on public.spread_legs
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- SpreadCandidate — output of leg matcher, pending user accept/reject
-- ============================================================================

create table public.spread_candidates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  suggested_type      text not null references public.spread_type_catalog(code),
  state               candidate_state not null default 'pending',
  match_confidence    numeric(5,4) not null check (match_confidence between 0 and 1),
  match_reasons       text[] not null default '{}',
  proposed_legs       jsonb not null,
  primary_base        text not null,
  earliest_fill_at    timestamptz not null,
  expires_at          timestamptz not null default (now() + interval '30 days'),
  decided_at          timestamptz,
  decided_by          uuid references auth.users(id),
  resulting_spread_id uuid references public.spreads(id) on delete set null,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.spread_candidates is
  'Matcher-proposed candidate spreads. User accept creates a spread; reject sets state to rejected.';
comment on column public.spread_candidates.proposed_legs is
  'Array of {connection_id, instrument, side, fill_ids[], qty_total, avg_entry_price, opened_at}. Schema in app code.';

create index spread_candidates_user_state_idx
  on public.spread_candidates (user_id, state, match_confidence desc)
  where state = 'pending';

create index spread_candidates_user_created_idx
  on public.spread_candidates (user_id, created_at desc);

create trigger spread_candidates_updated_at
  before update on public.spread_candidates
  for each row execute function public.tg_set_updated_at();
