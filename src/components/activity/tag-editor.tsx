"use client";

import * as React from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface TagEditorProps {
  activityId: string;
  /** Server-rendered initial set of tags for the activity (sorted asc). */
  initialTags: readonly string[];
}

interface UserTagSuggestion {
  tag: string;
  count: number;
}

type Status = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 500;
const MAX_TAG_LEN = 60;
const MAX_TAGS = 40;

/**
 * Free-form tag editor with chip UI + autocomplete.
 *
 * State model:
 *   - `tags` is the source of truth — the chips currently rendered. Optimistic
 *     updates mutate this list immediately on add/remove, then a debounced
 *     PUT reconciles with the server.
 *   - `serverTags` mirrors the last successful PUT response. On error, we
 *     revert `tags` to `serverTags` and surface an inline error.
 *   - `pendingRef` holds a counter for in-flight PUTs so we can ignore the
 *     responses of superseded requests (the user typed faster than the
 *     debounce fired the second time).
 *
 * Save semantics:
 *   The route is PUT /api/activities/[id]/tags with set-replacement semantics
 *   (set-tagsForActivity). Every save sends the full chip list — no diffs.
 *   This avoids the "partial-success" failure mode where add and remove
 *   diverge, at the cost of slightly larger payloads (acceptable: chips are
 *   short strings, typical N < 10).
 *
 * Autocomplete:
 *   GET /api/tags returns every tag the user has used across all activities
 *   with usage counts. We filter client-side by prefix match (case-insensitive)
 *   and hide the chips already on this activity. Dropdown shows up to 8 hits.
 */
export function TagEditor({ activityId, initialTags }: TagEditorProps) {
  const t = useT();
  const [tags, setTags] = React.useState<readonly string[]>(initialTags);
  const [serverTags, setServerTags] =
    React.useState<readonly string[]>(initialTags);
  const [status, setStatus] = React.useState<Status>("idle");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Input state for the "Add tag" field.
  const [draft, setDraft] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<UserTagSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  // Debounce + race control.
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = React.useRef(0);

  // Load the user's tag vocabulary once on mount. Errors are non-fatal —
  // autocomplete just silently stays empty. We keep this dead-simple (no
  // re-fetch on each save) because the dataset is the user's own tags and
  // grows on the order of dozens per month.
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/tags", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data: { tags: UserTagSuggestion[] };
        };
        if (!cancelled) setSuggestions(json.data.tags);
      } catch {
        // Network errors aren't surfaced — autocomplete is best-effort UX.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside collapses the suggestion dropdown.
  React.useEffect(() => {
    if (!suggestionsOpen) return;
    function handler(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setSuggestionsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [suggestionsOpen]);

  // Strip the debounce timer on unmount.
  React.useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  /**
   * Persist `nextTags` to the server. Schedule a debounced PUT and roll back
   * to `serverTags` if the server rejects.
   *
   * Race control: every save increments `requestSeqRef`. When a response
   * lands, it only commits if its sequence equals the current sequence —
   * a slower request whose body was already superseded is ignored. This
   * matters because the user can click × on a chip and immediately add a
   * new one before the first PUT has come back.
   */
  const scheduleSave = React.useCallback(
    (nextTags: readonly string[]) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      setStatus("saving");
      setErrorMsg(null);

      debounceRef.current = setTimeout(async () => {
        const seq = ++requestSeqRef.current;
        try {
          const res = await fetch(`/api/activities/${activityId}/tags`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tags: nextTags }),
          });

          // Bail if a newer request superseded us in flight.
          if (seq !== requestSeqRef.current) return;

          if (res.status === 404) {
            setStatus("error");
            setErrorMsg(t("activity.tags.errors.notFound"));
            setTags(serverTags);
            return;
          }
          if (!res.ok) {
            const json = await res.json().catch(() => null);
            setStatus("error");
            setErrorMsg(
              json?.error?.message ??
                t("activity.tags.errors.failed", { status: res.status }),
            );
            setTags(serverTags);
            return;
          }

          const json = (await res.json()) as {
            data: { tags: string[] };
          };
          // The server canonicalises (trim, dedupe, sort). Replace the
          // optimistic list with the server's version so chips render in
          // the same order as a fresh page load.
          setServerTags(json.data.tags);
          setTags(json.data.tags);
          setStatus("saved");

          // Refresh autocomplete from the server so a brand-new tag this
          // activity just minted starts appearing in suggestions for other
          // activities. Fire-and-forget — failure is a non-event.
          fetch("/api/tags", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
              if (j?.data?.tags) setSuggestions(j.data.tags);
            })
            .catch(() => undefined);
        } catch (e) {
          if (seq !== requestSeqRef.current) return;
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setTags(serverTags);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [activityId, serverTags, t],
  );

  /**
   * Add a new chip. Trim, validate length, reject duplicates (case-insensitive,
   * preserve first-seen casing — matches the server's setTagsForActivity
   * normalisation). Schedules a save and clears the input.
   */
  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_TAG_LEN) {
      setErrorMsg(t("activity.tags.errors.tooLong", { max: MAX_TAG_LEN }));
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setErrorMsg(t("activity.tags.errors.tooMany", { max: MAX_TAGS }));
      return;
    }
    const lc = trimmed.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lc)) {
      // Silently treat duplicates as no-ops — the user adding "breakout" twice
      // shouldn't fire a save.
      setDraft("");
      return;
    }
    const next = [...tags, trimmed];
    setTags(next);
    setDraft("");
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    scheduleSave(next);
  }

  function removeTag(tag: string) {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    scheduleSave(next);
  }

  // Build the filtered + ranked suggestion list. Order: (a) prefix match first,
  // (b) substring match second, (c) higher-count above lower-count. Limit 8.
  const filteredSuggestions = React.useMemo(() => {
    const q = draft.trim().toLowerCase();
    const inUse = new Set(tags.map((t) => t.toLowerCase()));
    const candidates = suggestions.filter(
      (s) => !inUse.has(s.tag.toLowerCase()),
    );
    if (!q) {
      // No query → top 8 by count.
      return candidates.slice(0, 8);
    }
    const scored = candidates
      .map((s) => {
        const lc = s.tag.toLowerCase();
        let score = 0;
        if (lc.startsWith(q)) score = 2;
        else if (lc.includes(q)) score = 1;
        return { ...s, _score: score };
      })
      .filter((s) => s._score > 0);
    scored.sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return b.count - a.count;
    });
    return scored.slice(0, 8);
  }, [draft, suggestions, tags]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // If a suggestion is highlighted, pick it; otherwise commit the draft.
      if (activeIndex >= 0 && activeIndex < filteredSuggestions.length) {
        addTag(filteredSuggestions[activeIndex].tag);
      } else {
        addTag(draft);
      }
      return;
    }
    if (e.key === "Tab" && draft.trim() && filteredSuggestions[0]) {
      // Tab autocompletes to the top suggestion if the user has typed
      // anything.
      e.preventDefault();
      addTag(filteredSuggestions[0].tag);
      return;
    }
    if (e.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      if (filteredSuggestions.length === 0) return;
      e.preventDefault();
      setSuggestionsOpen(true);
      setActiveIndex((i) =>
        Math.min(filteredSuggestions.length - 1, i + 1),
      );
      return;
    }
    if (e.key === "ArrowUp") {
      if (filteredSuggestions.length === 0) return;
      e.preventDefault();
      setSuggestionsOpen(true);
      setActiveIndex((i) => Math.max(-1, i - 1));
      return;
    }
    if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      // Backspace on an empty input pops the last chip — common UX pattern.
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
      return;
    }
  }

  function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Commit the draft on blur, but only if the focus didn't move into the
    // suggestion dropdown (clicking a suggestion). Suggestion clicks are
    // handled by the suggestion item's onMouseDown so they fire before blur.
    if (wrapperRef.current?.contains(e.relatedTarget as Node)) return;
    if (draft.trim()) {
      addTag(draft);
    }
    setTimeout(() => {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
    }, 100);
  }

  function handleSuggestionClick(tag: string) {
    addTag(tag);
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-3">
      {/* Chip cluster + add input. Wraps when overflow. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2",
          "focus-within:border-border-strong",
        )}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-inset px-2.5 py-1",
              "font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary",
            )}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={t("activity.tags.ariaRemove", { tag })}
              className="text-text-tertiary transition-colors hover:text-down"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative flex flex-1 items-center">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSuggestionsOpen(true);
              setActiveIndex(-1);
              setErrorMsg(null);
            }}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            onFocus={() => setSuggestionsOpen(true)}
            placeholder={
              tags.length === 0
                ? t("activity.tags.placeholderEmpty")
                : t("activity.tags.placeholderAdd")
            }
            aria-label={t("activity.tags.ariaAdd")}
            className={cn(
              "flex-1 min-w-[120px] bg-transparent px-1.5 py-1 outline-none",
              "font-mono text-[12px] text-text placeholder:text-text-disabled",
            )}
          />
          {suggestionsOpen && filteredSuggestions.length > 0 && (
            <ul
              role="listbox"
              className={cn(
                "absolute left-0 top-full z-10 mt-1 w-56 max-w-full overflow-hidden",
                "rounded-md border border-border bg-surface shadow-lg",
              )}
            >
              {filteredSuggestions.map((s, i) => (
                <li
                  key={s.tag}
                  role="option"
                  aria-selected={i === activeIndex}
                  // onMouseDown fires before blur so the suggestion click
                  // doesn't get cancelled by the blur handler that would
                  // otherwise commit the partial draft.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSuggestionClick(s.tag);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5",
                    "font-mono text-[11px] text-text-secondary",
                    i === activeIndex && "bg-inset text-text",
                  )}
                >
                  <span>{s.tag}</span>
                  <span className="text-text-tertiary">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {tags.length === 0 && draft === "" && (
          <Plus
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
          />
        )}
      </div>

      {/* Status / error line. aria-live so screen readers announce saves. */}
      <div
        aria-live="polite"
        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
      >
        {status === "saving" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t("activity.tags.saving")}
          </>
        )}
        {status === "saved" && tags.length > 0 && (
          <span>{t.plural("activity.tags.savedWithCount", tags.length)}</span>
        )}
        {status === "saved" && tags.length === 0 && (
          <span>{t("activity.tags.savedEmpty")}</span>
        )}
        {status === "idle" && tags.length === 0 && (
          <span>{t("activity.tags.idleEmpty")}</span>
        )}
        {status === "idle" && tags.length > 0 && (
          <span>{t.plural("activity.tags.count", tags.length)}</span>
        )}
        {status === "error" && (
          <span className="text-down">{errorMsg ?? t("activity.tags.saveFailed")}</span>
        )}
      </div>
    </div>
  );
}
