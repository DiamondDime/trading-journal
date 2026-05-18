import Link from 'next/link';
import { ArrowLeft, Search as SearchIcon } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { getT, getLocale } from '@/lib/i18n/server';
import { searchActivities, type SearchResultItem } from '@/lib/db/search';
import { SearchResultRow } from '@/components/search/search-result-row';
import type { ActivityType } from '@/types/canonical';

/**
 * Dedicated /search page — full-page activity search.
 *
 * Reads `?q=` from the request's searchParams (a Promise under Next 16), runs
 * the same `searchActivities` helper the `/api/search` route uses, and renders
 * results grouped by activity type. Empty `q` yields the empty state with
 * recently-used activity types as a hint.
 *
 * force-dynamic because the page derives its output entirely from a query
 * param and per-user DB state.
 */
export const dynamic = 'force-dynamic';

const MAX_RESULTS = 50;

// Order of the grouped sections — keeps the layout stable when a result set
// is missing some types.
const TYPE_ORDER: readonly ActivityType[] = [
  'spread',
  'trade',
  'sale',
  'airdrop',
  'yield_position',
  'option',
];

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { id: userId } = await requireUser();
  const t = await getT();
  const locale = await getLocale();
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';

  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = (raw ?? '').trim().slice(0, 200);

  const items = q.length > 0 ? await searchActivities(userId, q, MAX_RESULTS) : [];
  const grouped = groupByType(items);

  return (
    <div className="w-full">
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 lg:px-12">
        <Link
          href="/spreads"
          className="inline-flex items-center gap-1.5 self-start font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary hover:text-text"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('search.back')}
        </Link>

        <div>
          <h1 className="font-serif text-[32px] font-medium leading-none tracking-tight text-text">
            {q.length > 0
              ? t('search.title', { query: q })
              : t('search.titleEmpty')}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {q.length === 0
              ? t('search.hint')
              : items.length === 0
              ? t('search.noResults')
              : t('search.foundCount', {
                  count: items.length,
                  query: q,
                })}
          </p>
        </div>

        {/* On the page itself, repeat the search form so the user can refine
            without going back to the sidebar. Submits via plain GET so this
            stays a server-only experience. */}
        <form
          action="/search"
          method="get"
          className="flex items-center gap-2 rounded-md border border-border bg-inset px-3 py-2 max-w-xl transition-colors focus-within:border-border-strong"
        >
          <SearchIcon className="h-3.5 w-3.5 text-text-tertiary" />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={t('search.placeholder')}
            aria-label={t('search.inputAria')}
            autoFocus
            className="flex-1 bg-transparent text-[13px] text-text placeholder:text-text-tertiary focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-sm bg-text px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
          >
            {t('search.submit')}
          </button>
        </form>
      </header>

      <div className="px-8 py-8 lg:px-12">
        {q.length === 0 ? (
          <EmptyState messageKey="search.emptyHint" t={t} />
        ) : items.length === 0 ? (
          <EmptyState messageKey="search.noResultsHint" t={t} />
        ) : (
          <div className="flex flex-col gap-10">
            {TYPE_ORDER.map((type) => {
              const rows = grouped[type];
              if (!rows || rows.length === 0) return null;
              return (
                <section key={type}>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="font-serif text-[12px] font-semibold uppercase tracking-[0.16em] text-text">
                      {t(`search.byType.${type}`)}
                    </h2>
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {rows.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {rows.map((r) => (
                      <SearchResultRow
                        key={r.id}
                        item={r}
                        intlLocale={intlLocale}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  messageKey,
  t,
}: {
  messageKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: any, params?: Record<string, string | number>) => string;
  // `t` is the function returned by makeT — its exact generic signature is
  // strict via PathOf<MessageDict>, but the EmptyState helper is local and
  // can't know which subkey was chosen at the call site without exposing
  // the path type publicly. Keeping `any` here documents the boundary.
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface py-16 text-center">
      <p className="font-serif text-base italic text-text-secondary">
        {t(messageKey)}
      </p>
    </div>
  );
}

function groupByType(
  items: SearchResultItem[],
): Partial<Record<ActivityType, SearchResultItem[]>> {
  const out: Partial<Record<ActivityType, SearchResultItem[]>> = {};
  for (const item of items) {
    const bucket = out[item.type] ?? [];
    bucket.push(item);
    out[item.type] = bucket;
  }
  return out;
}
