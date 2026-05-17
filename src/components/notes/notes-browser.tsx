"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import type { AllNoteRow } from "@/lib/db/notes";

type ActivityType = "spread" | "trade" | "sale" | "airdrop";
type SortKey = "newest" | "oldest" | "longest" | "edited";

interface Filters {
  type: ActivityType[];
  tag: string;
  search: string;
  sort: SortKey;
}

interface NotesBrowserProps {
  initialNotes: AllNoteRow[];
  totalCount: number;
  tagVocab: { tag: string; count: number }[];
  pageSize: number;
  initialFilters: Filters;
}

const ACTIVITY_TYPE_ORDER: ActivityType[] = ["spread", "trade", "sale", "airdrop"];

const TYPE_LETTER: Record<ActivityType, string> = {
  spread: "",
  trade: "T",
  sale: "S",
  airdrop: "A",
};

function hrefFor(type: ActivityType, id: string): string {
  switch (type) {
    case "spread":
      return `/spreads/${id}`;
    case "trade":
      return `/trades/${id}`;
    case "sale":
      return `/sales/${id}`;
    case "airdrop":
      return `/airdrops/${id}`;
  }
}

function fmtSerial(type: ActivityType, id: string): string {
  const head = id.slice(0, 4).toUpperCase();
  return TYPE_LETTER[type] ? `${TYPE_LETTER[type]}#${head}` : `#${head}`;
}

/**
 * Friendly relative time string in the style of "2d", "3h", "47s", "5mo".
 * Past-only; we don't expect future-dated notes in this view.
 */
function fmtRelative(iso: string, locale: "en" | "ru"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === "ru" ? "ru-RU" : "en-US", { numeric: "auto" });
  if (sec < 60) return rtf.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  if (day < 30) return rtf.format(-day, "day");
  const mo = Math.floor(day / 30);
  if (mo < 12) return rtf.format(-mo, "month");
  const yr = Math.floor(mo / 12);
  return rtf.format(-yr, "year");
}

function fmtAbsolute(iso: string, locale: "en" | "ru"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function describeActivity(n: AllNoteRow, singularLabels: Record<ActivityType, string>): string {
  const parts = [singularLabels[n.activityType]];
  if (n.primarySymbol) parts.push(n.primarySymbol);
  return parts.join(" · ").toLowerCase();
}

// ──────────────────────────────────────────────────────────────────────────
// URL <-> state codec
// ──────────────────────────────────────────────────────────────────────────

function buildQuery(state: Filters): string {
  const params = new URLSearchParams();
  if (state.type.length > 0) params.set("type", state.type.join(","));
  if (state.tag) params.set("tag", state.tag);
  if (state.search) params.set("q", state.search);
  if (state.sort !== "newest") params.set("sort", state.sort);
  return params.toString();
}

function toggleType(types: ActivityType[], t: ActivityType): ActivityType[] {
  return types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export function NotesBrowser({
  initialNotes,
  totalCount: initialTotal,
  tagVocab,
  pageSize,
  initialFilters,
}: NotesBrowserProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const locale = useLocale();

  const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
    spread: t("notes.filter.spreads"),
    trade: t("notes.filter.trades"),
    sale: t("notes.filter.sales"),
    airdrop: t("notes.filter.airdrops"),
  };

  // Singular forms — used in per-card describe text + the small type chip.
  // Locale-correct (no `slice(-1)` heuristic which mangles RU "Сделки" → "Сделк").
  const ACTIVITY_TYPE_SINGULAR: Record<ActivityType, string> = {
    spread: t("activity.spread"),
    trade: t("activity.trade"),
    sale: t("activity.sale"),
    airdrop: t("activity.airdrop"),
  };

  const SORT_LABELS: Record<SortKey, string> = {
    newest: t("notes.sortLabels.newest"),
    oldest: t("notes.sortLabels.oldest"),
    longest: t("notes.sortLabels.longest"),
    edited: t("notes.sortLabels.edited"),
  };

  const [filters, setFilters] = React.useState<Filters>(initialFilters);
  const [notes, setNotes] = React.useState<AllNoteRow[]>(initialNotes);
  const [totalCount, setTotalCount] = React.useState(initialTotal);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Debounce search input so we don't fire on every keystroke.
  const [searchInput, setSearchInput] = React.useState(initialFilters.search);
  React.useEffect(() => {
    if (searchInput === filters.search) return;
    const handle = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }));
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Sync filter state → URL (replace, scroll preserved).
  React.useEffect(() => {
    const next = buildQuery(filters);
    if (next === searchParams.toString()) return;
    router.replace(next ? `?${next}` : "?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, router]);

  // Refetch on filter change. The initial render's data already covers the
  // initial filter state — only refire when a chip / sort / search changes.
  const initialKeyRef = React.useRef(buildQuery(initialFilters));
  React.useEffect(() => {
    const key = buildQuery(filters);
    if (key === initialKeyRef.current) return;
    let cancelled = false;
    setRefreshing(true);
    setErrorMessage(null);
    void fetchPage(filters, 0)
      .then((res) => {
        if (cancelled) return;
        setNotes(res.rows);
        setTotalCount(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : t("notes.fetchError"));
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const loadMore = async () => {
    setLoadingMore(true);
    setErrorMessage(null);
    try {
      const res = await fetchPage(filters, notes.length);
      setNotes((prev) => [...prev, ...res.rows]);
      // total stays the same — server reports it on each call.
      setTotalCount(res.total);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t("notes.fetchError"));
    } finally {
      setLoadingMore(false);
    }
  };

  const filtersActive =
    filters.type.length > 0 ||
    filters.tag.length > 0 ||
    filters.search.length > 0 ||
    filters.sort !== "newest";

  const clearAll = () => {
    setSearchInput("");
    setFilters({ type: [], tag: "", search: "", sort: "newest" });
  };

  const hasMore = notes.length < totalCount;

  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("notes.title")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {t("notes.subtitle")}
          </p>
        </div>
        <div className="text-right">
          <p
            aria-label={t.plural("plurals.notes", totalCount)}
            className="font-serif text-[44px] font-medium leading-none tracking-tight tabular-nums text-signature"
          >
            {totalCount.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
            {t.plural("notes.counterNoun", totalCount)}
            {filtersActive && ` · ${t("notes.filtered")}`}
          </p>
        </div>
      </header>

      {/* ── filter rail ─────────────────────────────────────────────────── */}
      <section
        className="border-b border-border bg-surface/60 px-8 py-4 lg:px-12"
        aria-label={t("notes.filterAria")}
      >
        <div className="flex flex-col gap-3">
          {/* Search + sort row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 focus-within:border-border-strong">
              <Search className="h-3.5 w-3.5 text-text-tertiary" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("notes.searchPlaceholder")}
                aria-label={t("notes.searchAria")}
                type="search"
                className="w-72 bg-transparent text-[12px] text-text placeholder:text-text-tertiary focus:outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label={t("notes.clearSearch")}
                  className="text-text-tertiary hover:text-text"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="notes-sort"
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
              >
                {t("notes.sort")}
              </label>
              <select
                id="notes-sort"
                value={filters.sort}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    sort: e.target.value as SortKey,
                  }))
                }
                className="rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text focus:border-border-strong focus:outline-none"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Activity type chips */}
          <div className="flex items-baseline gap-3">
            <span className="w-16 shrink-0 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
              {t("notes.typeLabel")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                label={t("notes.all")}
                active={filters.type.length === 0}
                onClick={() => setFilters((f) => ({ ...f, type: [] }))}
              />
              {ACTIVITY_TYPE_ORDER.map((type) => (
                <FilterChip
                  key={type}
                  label={ACTIVITY_TYPE_LABELS[type]}
                  active={filters.type.includes(type)}
                  onClick={() =>
                    setFilters((f) => ({ ...f, type: toggleType(f.type, type) }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Tag chips (only render if user has any) */}
          {tagVocab.length > 0 && (
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 font-serif text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                {t("notes.tagLabel")}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {tagVocab.slice(0, 18).map((tg) => (
                  <FilterChip
                    key={tg.tag}
                    label={`${tg.tag} · ${tg.count}`}
                    active={filters.tag === tg.tag}
                    onClick={() =>
                      setFilters((f) => ({
                        ...f,
                        tag: f.tag === tg.tag ? "" : tg.tag,
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {filtersActive && (
            <div className="pt-1">
              <button
                type="button"
                onClick={clearAll}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
              >
                {t("notes.clearFilters")}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── feed body ───────────────────────────────────────────────────── */}
      <div
        className="px-8 py-8 lg:px-12"
        aria-busy={refreshing}
        aria-live="polite"
      >
        {errorMessage && (
          <div className="mb-6 rounded-md border border-down/40 bg-down/10 px-4 py-3 font-mono text-[11px] text-down">
            {errorMessage}
          </div>
        )}

        {notes.length === 0 && !refreshing ? (
          <EmptyState filtersActive={filtersActive} onClear={clearAll} />
        ) : (
          <>
            <ul className="flex flex-col gap-4">
              {notes.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  singularLabels={ACTIVITY_TYPE_SINGULAR}
                  locale={locale}
                />
              ))}
            </ul>

            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-md border border-border bg-surface px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore
                    ? t("notes.loading")
                    : t("notes.loadMore", { count: Math.min(pageSize, totalCount - notes.length) })}
                </button>
              </div>
            )}

            {!hasMore && notes.length > pageSize && (
              <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
                {t("notes.endOfFeed", { n: notes.length, total: totalCount })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────────────────

async function fetchPage(
  filters: Filters,
  offset: number,
): Promise<{ rows: AllNoteRow[]; total: number }> {
  const params = new URLSearchParams();
  if (filters.type.length > 0) params.set("type", filters.type.join(","));
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.search) params.set("q", filters.search);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  params.set("offset", String(offset));
  const res = await fetch(`/api/notes/list?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load notes (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { data: { rows: AllNoteRow[]; total: number } };
  return { rows: json.data.rows, total: json.data.total };
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
        active
          ? "border-text bg-text/[0.08] text-text"
          : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
      )}
    >
      {label}
    </button>
  );
}

const COLLAPSED_LINES = 5;
const COLLAPSED_CHAR_LIMIT = 480;

function NoteCard({
  note,
  singularLabels,
  locale,
}: {
  note: AllNoteRow;
  singularLabels: Record<ActivityType, string>;
  locale: "en" | "ru";
}) {
  const t = useT();
  const longBody = note.body.length > COLLAPSED_CHAR_LIMIT;
  const [expanded, setExpanded] = React.useState(false);

  const visibleBody = expanded || !longBody
    ? note.body
    : note.body.slice(0, COLLAPSED_CHAR_LIMIT).trimEnd();

  return (
    <li className="rounded-md border border-border bg-surface transition-colors hover:border-border-strong">
      <article aria-labelledby={`note-${note.id}-title`}>
        {/* Top row: serial · type · activity name | relative time */}
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle px-5 py-3">
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {fmtSerial(note.activityType, note.activityId)}
            </span>
            <span className="font-mono text-[10px] text-text-tertiary">·</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-signature">
              {singularLabels[note.activityType]}
            </span>
            <span className="font-mono text-[10px] text-text-tertiary">·</span>
            <Link
              href={hrefFor(note.activityType, note.activityId)}
              id={`note-${note.id}-title`}
              className="font-serif text-[14px] font-medium text-text hover:underline"
            >
              {note.activityName}
            </Link>
            <span className="font-mono text-[10px] text-text-tertiary">
              · {describeActivity(note, singularLabels)}
            </span>
          </div>

          <span
            title={t("notes.editedTooltip", { date: fmtAbsolute(note.updatedAt, locale) })}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
          >
            {fmtRelative(note.updatedAt, locale)}
          </span>
        </header>

        {/* Body. CSS line-clamp handles the visual cutoff (and ellipsis). The
            char-limit slice avoids handing the layout engine 10kB of text
            when only 5 lines render — the slice is generous enough that the
            CSS clamp does the visible trimming. */}
        <div className="px-5 py-4">
          <p
            className={cn(
              "whitespace-pre-wrap break-words font-serif text-[14px] leading-relaxed text-text",
              !expanded && longBody && "line-clamp-5",
            )}
            style={
              !expanded && longBody
                ? { display: "-webkit-box", WebkitLineClamp: COLLAPSED_LINES, WebkitBoxOrient: "vertical", overflow: "hidden" }
                : undefined
            }
          >
            {visibleBody}
          </p>

          {longBody && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? t("notes.collapse") : t("notes.expandFull")}
            </button>
          )}
        </div>

        {/* Footer: tags + satisfaction */}
        {(note.tags.length > 0 || note.activitySatisfaction !== null) && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-5 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {note.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm border border-border bg-inset px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-text-secondary"
                >
                  {tag}
                </span>
              ))}
              {note.tags.length > 6 && (
                <span className="font-mono text-[9px] text-text-tertiary">
                  {t("notes.moreTags", { count: note.tags.length - 6 })}
                </span>
              )}
            </div>

            {note.activitySatisfaction !== null && (
              <span
                title={note.activitySatisfaction ? t("notes.satisfied") : t("notes.notSatisfied")}
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                  note.activitySatisfaction ? "text-up" : "text-down",
                )}
              >
                {note.activitySatisfaction ? (
                  <ThumbsUp className="h-3 w-3" />
                ) : (
                  <ThumbsDown className="h-3 w-3" />
                )}
                {note.activitySatisfaction ? t("notes.satisfied") : t("notes.notSatisfied")}
              </span>
            )}
          </footer>
        )}
      </article>
    </li>
  );
}

function EmptyState({
  filtersActive,
  onClear,
}: {
  filtersActive: boolean;
  onClear: () => void;
}) {
  const t = useT();
  if (filtersActive) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface py-16 text-center">
        <p className="font-serif text-[18px] italic text-text-secondary">
          {t("notes.emptyFiltered")}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
        >
          {t("notes.clearFilters")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface py-16 text-center">
      <p className="font-serif text-[20px] italic text-text-secondary">
        {t("notes.emptyQuiet")}
      </p>
      <p className="max-w-md font-serif text-sm italic text-text-tertiary">
        {t("notes.emptyQuietBody")}
      </p>
      <Link
        href="/spreads/archive"
        className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
      >
        {t("notes.browseRecent")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
