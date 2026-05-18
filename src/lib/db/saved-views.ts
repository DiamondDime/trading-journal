/**
 * Typed DB helpers for the `saved_views` table.
 *
 * Schema (per migration 007):
 *   id          uuid pk
 *   user_id     uuid (RLS scoped)
 *   name        text (unique per (user_id, scope, name))
 *   scope       text in ('spreads', 'positions', 'fills')
 *   filters     jsonb
 *   sort        jsonb
 *   columns     text[]
 *   is_default  boolean
 *   created_at  timestamptz
 *   updated_at  timestamptz
 *
 * Wave 13C uses these as URL bookmarks rather than as fully-structured
 * filter/sort configurations. The URL the user wants to bookmark is stored
 * inside `filters.queryString`; an optional user-supplied note in
 * `filters.description`; and `filters.lastAppliedAt` tracks the last "Apply"
 * click. We commit to `scope = 'spreads'` for every Wave 13C bookmark — the
 * archive/calendar URLs all sit under that umbrella — which keeps the existing
 * (user_id, scope, name) uniqueness invariant useful: two distinct view names.
 *
 * Why this jsonb-as-URL shape and not a column rename:
 *   - The saved_views table is referenced by RLS policies + indexes already.
 *     Renaming `filters` would force a destructive migration.
 *   - jsonb keeps the door open to a richer structured-filter migration in
 *     v2 without breaking the row format used in v1.
 *
 * postgres.js's camelCase transform applies here too. JS-side keys are
 * camelCase; SQL writes use snake_case via tagged-template substitutions.
 */
import { sql } from '@/lib/db/client';
import type { SavedViewId, Iso8601 } from '@/types/canonical';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Display row passed to the views page. */
export interface SavedViewRow {
  id: SavedViewId;
  name: string;
  description: string;
  queryString: string;
  scope: 'spreads' | 'positions' | 'fills';
  lastAppliedAt: Iso8601 | null;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

/** Shape of the jsonb `filters` column for Wave 13C views. */
interface FiltersJson {
  queryString?: string;
  description?: string;
  lastAppliedAt?: string;
  /** Reserved for v2 — won't be read by Wave 13C UI but preserved on update. */
  [k: string]: unknown;
}

function dateToIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function rowToView(row: {
  id: string;
  name: string;
  scope: 'spreads' | 'positions' | 'fills';
  filters: FiltersJson | null;
  createdAt: unknown;
  updatedAt: unknown;
}): SavedViewRow {
  const f = row.filters ?? {};
  return {
    id: row.id as SavedViewId,
    name: row.name,
    description: typeof f.description === 'string' ? f.description : '',
    queryString: typeof f.queryString === 'string' ? f.queryString : '',
    scope: row.scope,
    lastAppliedAt:
      typeof f.lastAppliedAt === 'string' ? (f.lastAppliedAt as Iso8601) : null,
    createdAt: (dateToIso(row.createdAt) ?? '') as Iso8601,
    updatedAt: (dateToIso(row.updatedAt) ?? '') as Iso8601,
  };
}

/**
 * URL validation: the bookmarked URL MUST be a same-origin path under the
 * allowlisted journal routes. Absolute URLs to other hosts, javascript: URIs,
 * and path-traversal attempts are all rejected before the row is persisted.
 *
 * Allowed roots (Wave 13C v1):
 *   - /spreads/archive   (the archive browser — the primary use case)
 *   - /calendar          (Wave 13A)
 *   - /spreads           (the dashboard with dashboard filters)
 *
 * The valid path is normalised to its pathname + sorted search string so
 * cosmetic differences ("?b=2&a=1" vs "?a=1&b=2") don't produce duplicates.
 */
export class InvalidQueryStringError extends Error {
  constructor(message = 'Invalid query string') {
    super(message);
    this.name = 'InvalidQueryStringError';
  }
}

const ALLOWED_ROOTS = ['/spreads/archive', '/calendar', '/spreads'] as const;

export function validateAndNormaliseQueryString(input: string): string {
  if (typeof input !== 'string') {
    throw new InvalidQueryStringError('queryString must be a string');
  }
  // Reject absolute URLs early — same-origin only.
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith('//')) {
    throw new InvalidQueryStringError('Absolute URLs are not allowed');
  }
  // Must begin with '/' so we're certain it's a path, not a relative fragment.
  if (!input.startsWith('/')) {
    throw new InvalidQueryStringError('URL must start with /');
  }
  // Path-traversal check — '..' segments would let a bookmark sneak out of
  // the allowed roots.
  if (input.includes('..')) {
    throw new InvalidQueryStringError('Path traversal not allowed');
  }
  // Parse against a dummy base so we get a stable URL object without leaking
  // host into the stored value.
  let parsed: URL;
  try {
    parsed = new URL(input, 'https://invalid.local');
  } catch {
    throw new InvalidQueryStringError('Malformed URL');
  }
  const path = parsed.pathname;
  const rootOk = ALLOWED_ROOTS.some(
    (root) => path === root || path.startsWith(root + '/'),
  );
  if (!rootOk) {
    throw new InvalidQueryStringError(
      `URL must start with one of: ${ALLOWED_ROOTS.join(', ')}`,
    );
  }
  // Re-emit pathname + sorted search params so dedupe-by-string works.
  const search = parsed.searchParams;
  const sortedKeys = [...new Set([...search.keys()])].sort();
  const out = new URLSearchParams();
  for (const k of sortedKeys) {
    for (const v of search.getAll(k)) out.append(k, v);
  }
  const qs = out.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * List every saved view owned by the user. Wave 13C uses 'spreads' scope only
 * but we return all scopes here so a future surface can filter as it pleases.
 * Ordering: most-recently-updated first — keeps the user's working set on top.
 */
export async function listSavedViews(
  userId: string,
): Promise<SavedViewRow[]> {
  const rows = await sql<{
    id: string;
    name: string;
    scope: 'spreads' | 'positions' | 'fills';
    filters: FiltersJson | null;
    createdAt: unknown;
    updatedAt: unknown;
  }[]>`
    SELECT id, name, scope, filters, created_at, updated_at
    FROM public.saved_views
    WHERE user_id = ${userId}::uuid
    ORDER BY updated_at DESC, created_at DESC
  `;
  return rows.map(rowToView);
}

/**
 * Read one saved view by id (owner-scoped). Returns null on miss or non-owner.
 */
export async function getSavedView(
  userId: string,
  id: string,
): Promise<SavedViewRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await sql<{
    id: string;
    name: string;
    scope: 'spreads' | 'positions' | 'fills';
    filters: FiltersJson | null;
    createdAt: unknown;
    updatedAt: unknown;
  }[]>`
    SELECT id, name, scope, filters, created_at, updated_at
    FROM public.saved_views
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return rowToView(rows[0]);
}

export interface CreateSavedViewInput {
  name: string;
  description?: string;
  queryString: string;
}

/**
 * Create a new saved view. Validates the URL via
 * validateAndNormaliseQueryString — throws InvalidQueryStringError on failure.
 *
 * Unique constraint (user_id, scope, name) is enforced at the DB layer; on
 * collision the caller gets a PG error code 23505 which the API route maps to
 * a 409 Conflict.
 */
export async function createSavedView(
  userId: string,
  input: CreateSavedViewInput,
): Promise<SavedViewRow> {
  const queryString = validateAndNormaliseQueryString(input.queryString);
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvalidQueryStringError('Name is required');
  }
  if (name.length > 60) {
    throw new InvalidQueryStringError('Name must be 60 chars or fewer');
  }
  const description = (input.description ?? '').trim().slice(0, 200);

  const filters: FiltersJson = {
    queryString,
    description,
  };

  const [created] = await sql<{
    id: string;
    name: string;
    scope: 'spreads' | 'positions' | 'fills';
    filters: FiltersJson | null;
    createdAt: unknown;
    updatedAt: unknown;
  }[]>`
    INSERT INTO public.saved_views (user_id, name, scope, filters, sort, columns)
    VALUES (
      ${userId}::uuid,
      ${name},
      'spreads',
      ${sql.json(filters as Parameters<typeof sql.json>[0])},
      ${sql.json({})},
      ${[] as string[]}::text[]
    )
    RETURNING id, name, scope, filters, created_at, updated_at
  `;
  return rowToView(created);
}

export interface UpdateSavedViewPatch {
  name?: string;
  description?: string;
  queryString?: string;
  /** Touch lastAppliedAt — used when the user clicks Apply. */
  bumpLastApplied?: boolean;
}

/**
 * Patch a saved view in place. Empty patch is a no-op (returns the row).
 * Returns null if the row doesn't exist or isn't owned.
 *
 * filters jsonb is read-modify-written so we preserve any keys we don't know
 * about (forward-compatibility with v2 structured filters).
 */
export async function updateSavedView(
  userId: string,
  id: string,
  patch: UpdateSavedViewPatch,
): Promise<SavedViewRow | null> {
  if (!UUID_RE.test(id)) return null;

  // Fetch existing — both for ownership AND to read-modify-write filters.
  const existing = await sql<{
    id: string;
    name: string;
    filters: FiltersJson | null;
  }[]>`
    SELECT id, name, filters
    FROM public.saved_views
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `;
  if (!existing[0]) return null;

  const nextFilters: FiltersJson = { ...(existing[0].filters ?? {}) };
  if (patch.description !== undefined) {
    nextFilters.description = patch.description.trim().slice(0, 200);
  }
  if (patch.queryString !== undefined) {
    nextFilters.queryString = validateAndNormaliseQueryString(patch.queryString);
  }
  if (patch.bumpLastApplied) {
    nextFilters.lastAppliedAt = new Date().toISOString();
  }

  let nextName = existing[0].name;
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new InvalidQueryStringError('Name is required');
    }
    if (trimmed.length > 60) {
      throw new InvalidQueryStringError('Name must be 60 chars or fewer');
    }
    nextName = trimmed;
  }

  const [updated] = await sql<{
    id: string;
    name: string;
    scope: 'spreads' | 'positions' | 'fills';
    filters: FiltersJson | null;
    createdAt: unknown;
    updatedAt: unknown;
  }[]>`
    UPDATE public.saved_views
    SET name = ${nextName},
        filters = ${sql.json(nextFilters as Parameters<typeof sql.json>[0])}
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
    RETURNING id, name, scope, filters, created_at, updated_at
  `;
  if (!updated) return null;
  return rowToView(updated);
}

/**
 * Hard-delete the saved view. Returns true if a row was deleted.
 */
export async function deleteSavedView(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await sql`
    DELETE FROM public.saved_views
    WHERE id = ${id}::uuid
      AND user_id = ${userId}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

// ============================================================================
// Activities count — live-computed per saved view
// ============================================================================

/**
 * Count the activities a saved view's URL would match. Lazily computed on
 * render — never persisted. Capped at 200 to keep cost predictable for views
 * that match the entire archive ("All activity" etc).
 *
 * The query mirrors the same shape v_activity_feed exposes, since the archive
 * page itself filters client-side on the same view. We pull the cheap
 * subset of filter keys directly from the URL search params (activity, type,
 * outcome) and apply them server-side; richer client-only filters (asset,
 * status sets, free-text search) are ignored here — the count is an upper
 * bound, not a guarantee the in-page filter chips will agree exactly. The
 * trade-off keeps the count cheap and stable across UI changes.
 */
export interface CountSavedViewInput {
  queryString: string;
}

const ACTIVITIES_COUNT_CAP = 200;

type SavedViewActivityType =
  | 'spread'
  | 'trade'
  | 'sale'
  | 'airdrop'
  | 'yield_position'
  | 'option';

interface ParsedActivityFilters {
  types: SavedViewActivityType[];
  outcome: 'winners' | 'losers' | null;
  spreadTypes: string[];
}

/**
 * Parse the subset of archive URL parameters we can answer at the DB level.
 * Wave 13C accepts:
 *   - activity=spread,trade,sale,airdrop,yield_position,option
 *   - outcome=winners|losers
 *   - type=cash_carry,cross_exchange,funding,calendar,dex_cex (spread subtype)
 *
 * Unknown values are silently dropped — the cap protects us either way.
 */
function parseActivityFiltersFromQuery(qs: string): ParsedActivityFilters {
  let search = '';
  try {
    const u = new URL(qs, 'https://invalid.local');
    search = u.search.replace(/^\?/, '');
  } catch {
    search = '';
  }
  const params = new URLSearchParams(search);
  const VALID_TYPES = new Set<SavedViewActivityType>([
    'spread', 'trade', 'sale', 'airdrop', 'yield_position', 'option',
  ]);
  const VALID_SPREAD_TYPES = new Set([
    'cash_carry', 'cross_exchange', 'funding', 'calendar', 'dex_cex',
  ]);
  const SPREAD_UI_TO_DB: Record<string, string> = {
    cash_carry: 'cash_carry',
    cross_exchange: 'cross_exchange_perp_arb',
    funding: 'funding_capture',
    calendar: 'calendar',
    dex_cex: 'dex_cex_arb',
  };

  const activity = (params.get('activity') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SavedViewActivityType =>
      VALID_TYPES.has(s as SavedViewActivityType),
    );

  const outcomeRaw = params.get('outcome');
  const outcome =
    outcomeRaw === 'winners' || outcomeRaw === 'losers' ? outcomeRaw : null;

  const typeUi = (params.get('type') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_SPREAD_TYPES.has(s));
  const spreadTypes = typeUi
    .map((s) => SPREAD_UI_TO_DB[s])
    .filter((s): s is string => Boolean(s));

  return { types: activity, outcome, spreadTypes };
}

/**
 * Returns the live activities count for a saved view. Always <= 200; the
 * cap is communicated by a sentinel `.capped = true` on the result.
 */
export async function countActivitiesForView(
  userId: string,
  input: CountSavedViewInput,
): Promise<{ count: number; capped: boolean }> {
  const filters = parseActivityFiltersFromQuery(input.queryString);
  const joinSpread = filters.spreadTypes.length > 0;

  // We over-cap by 1 (LIMIT 201) so we can tell the difference between
  // exactly-200 and "≥200". Outcome filter applies as a HAVING-style WHERE on
  // net_pnl_usd since v_activity_feed exposes it pre-aggregated.
  const rows = await sql<{ id: string }[]>`
    SELECT f.id
    FROM public.v_activity_feed f
    ${joinSpread
      ? sql`LEFT JOIN public.activity_spread asp ON asp.activity_id = f.id`
      : sql``}
    WHERE f.user_id = ${userId}::uuid
      ${filters.types.length > 0
        ? sql`AND f.type::text = ANY(${filters.types}::text[])`
        : sql``}
      ${filters.outcome === 'winners'
        ? sql`AND f.net_pnl_usd > 0`
        : filters.outcome === 'losers'
        ? sql`AND f.net_pnl_usd < 0`
        : sql``}
      ${joinSpread
        ? sql`AND asp.spread_type = ANY(${filters.spreadTypes}::text[])`
        : sql``}
    LIMIT ${ACTIVITIES_COUNT_CAP + 1}
  `;
  return {
    count: Math.min(rows.length, ACTIVITIES_COUNT_CAP),
    capped: rows.length > ACTIVITIES_COUNT_CAP,
  };
}
