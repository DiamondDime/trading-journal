'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search as SearchIcon, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import type { SearchResultItem } from '@/lib/search/types';
import { searchHrefFor } from '@/lib/search/types';
import type { ActivityType } from '@/types/canonical';

/**
 * Global ⌘K command palette.
 *
 * Owns the open/close state for the palette + the live preview behind a
 * debounced fetch against /api/search. Keyboard handling: Esc closes; ↑/↓
 * navigates the preview list; Enter either opens the highlighted item or,
 * if the list is empty/idle, submits to the dedicated `/search` page.
 *
 * Focus is trapped while open by listening for outbound focusin events on
 * the document and re-targeting them back into the dialog. This matches the
 * wizard primitives in `src/components/wizard/` which use the same approach
 * (no `inert`, no third-party trap).
 *
 * The palette renders nothing when closed — there is no fixed-position chrome
 * occupying paint time on every route.
 */
export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const t = useT();

  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<SearchResultItem[]>([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [errored, setErrored] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // ── Reset state every time the palette opens. We never want the previous
  //    query persisting into a fresh session — that's a usability footgun
  //    when users blur out and pop the palette later for a different query.
  React.useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null;
    setQuery('');
    setItems([]);
    setActiveIdx(0);
    setErrored(false);
    // Defer focus until the input is in the DOM — opening + focusing in the
    // same tick fails because the dialog hasn't been painted yet.
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Restore focus to the element that opened the palette when we close —
  // standard dialog hygiene. We only run on the close transition (open → false).
  React.useEffect(() => {
    if (open) return;
    previouslyFocusedRef.current?.focus();
  }, [open]);

  // ── Debounced fetch ────────────────────────────────────────────────────
  // 250ms is the spec target — quick enough to feel live, slow enough to
  // avoid spamming the API for every keystroke. AbortController cancels the
  // previous in-flight request so stale results never overwrite fresh ones.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      setItems([]);
      setLoading(false);
      setErrored(false);
      setActiveIdx(0);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    setErrored(false);
    const timer = window.setTimeout(async () => {
      try {
        const url = `/api/search?q=${encodeURIComponent(q)}&limit=5`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const json: { data?: { items?: SearchResultItem[] }; error?: unknown } =
          await res.json();
        if (json.error || !json.data) throw new Error('payload');
        if (!ctrl.signal.aborted) {
          setItems(json.data.items ?? []);
          setActiveIdx(0);
          setLoading(false);
        }
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return;
        if (!ctrl.signal.aborted) {
          setItems([]);
          setLoading(false);
          setErrored(true);
        }
      }
    }, 250);

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  // ── Keyboard interactions ──────────────────────────────────────────────
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIdx((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = items[activeIdx];
      const trimmed = query.trim();
      if (hit) {
        router.push(searchHrefFor(hit.type, hit.id));
        onOpenChange(false);
      } else if (trimmed.length > 0) {
        // No live results yet (or none returned) — fall through to the full
        // results page so the user keeps making progress instead of staring
        // at a "no results" state.
        router.push(`/search?q=${encodeURIComponent(trimmed)}`);
        onOpenChange(false);
      }
    }
  };

  // ── Focus trap: any focusin that leaves the dialog gets pulled back in ──
  React.useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target || !dialog.contains(target)) {
        inputRef.current?.focus();
      }
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  if (!open) return null;

  return (
    <div
      // Lock-scrolling overlay. Clicking the backdrop closes — same affordance
      // as native macOS spotlight + every other ⌘K palette in the wild.
      className="fixed inset-0 z-50 flex items-start justify-center bg-app/80 backdrop-blur-sm pt-[12vh] px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('search.dialogAria')}
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
      >
        {/* Header / input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <SearchIcon className="h-4 w-4 text-text-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.inputAria')}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[14px] text-text placeholder:text-text-tertiary focus:outline-none"
          />
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />
          )}
          <kbd className="hidden font-mono text-[9px] text-text-tertiary border border-border rounded px-1 py-px sm:inline-block">
            {t('search.escKey')}
          </kbd>
        </div>

        {/* Results / hints / empty / error */}
        <ResultsList
          query={query}
          items={items}
          activeIdx={activeIdx}
          loading={loading}
          errored={errored}
          onHover={(i) => setActiveIdx(i)}
          onSelect={(item) => {
            router.push(searchHrefFor(item.type, item.id));
            onOpenChange(false);
          }}
        />

        {/* Footer / "view all" link */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-inset px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          <span className="flex items-center gap-3">
            <KbdHint label={t('search.kbd.navigate')} keys={['↑', '↓']} />
            <KbdHint label={t('search.kbd.select')} keys={['↵']} />
            <KbdHint label={t('search.kbd.close')} keys={['Esc']} />
          </span>
          {query.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                router.push(`/search?q=${encodeURIComponent(query.trim())}`);
                onOpenChange(false);
              }}
              className="flex items-center gap-1 hover:text-text"
            >
              {t('search.viewAll')}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── subcomponents ────────────────────────────────────────────────────────

function ResultsList({
  query,
  items,
  activeIdx,
  loading,
  errored,
  onHover,
  onSelect,
}: {
  query: string;
  items: SearchResultItem[];
  activeIdx: number;
  loading: boolean;
  errored: boolean;
  onHover: (i: number) => void;
  onSelect: (item: SearchResultItem) => void;
}) {
  const t = useT();
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="font-serif text-[13px] italic text-text-tertiary">
          {t('search.openCommandHint')}
        </p>
      </div>
    );
  }

  if (errored) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="font-serif text-[13px] italic text-down">
          {t('search.errorBody')}
        </p>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="font-serif text-[13px] italic text-text-tertiary">
          {t('search.searching')}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="font-serif text-[13px] italic text-text-tertiary">
          {t('search.noResults')}
        </p>
      </div>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label={t('search.listboxAria')}
      className="max-h-[55vh] overflow-y-auto py-1"
    >
      {items.map((item, i) => (
        <li
          key={item.id}
          role="option"
          aria-selected={i === activeIdx}
        >
          <button
            type="button"
            onMouseEnter={() => onHover(i)}
            onMouseMove={() => onHover(i)}
            onClick={() => onSelect(item)}
            className={cn(
              'flex w-full items-center justify-between gap-4 px-3 py-2 text-left transition-colors',
              i === activeIdx ? 'bg-subtle' : 'hover:bg-subtle/50',
            )}
          >
            <div className="flex flex-1 flex-col gap-0.5 min-w-0">
              <span className="font-serif text-[13px] font-medium text-text truncate">
                {item.title}
              </span>
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                <span>{TYPE_BADGE[item.type]}</span>
                {item.primarySymbol && (
                  <>
                    <span>·</span>
                    <span>{item.primarySymbol}</span>
                  </>
                )}
                {item.subtitle && (
                  <>
                    <span>·</span>
                    <span className="truncate normal-case tracking-normal text-text-tertiary">
                      {item.subtitle}
                    </span>
                  </>
                )}
              </span>
            </div>
            <ArrowRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-text-tertiary',
                i === activeIdx ? 'opacity-100' : 'opacity-0',
              )}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function KbdHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-0.5">
        {keys.map((k) => (
          <kbd
            key={k}
            className="font-mono text-[9px] text-text-secondary border border-border rounded px-1 py-px bg-surface"
          >
            {k}
          </kbd>
        ))}
      </span>
      <span>{label}</span>
    </span>
  );
}

const TYPE_BADGE: Record<ActivityType, string> = {
  spread:         'SPREAD',
  trade:          'TRADE',
  sale:           'SALE',
  airdrop:        'AIRDROP',
  yield_position: 'YIELD',
  option:         'OPTION',
};
