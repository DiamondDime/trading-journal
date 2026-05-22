"use client";

import * as React from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface WizardTagInputProps {
  /**
   * Form field name for the serialised hidden input. The wizard's server
   * action reads `formData.get(name)` — a JSON array of strings — and the
   * `db.ts` create/update layer persists it via `setTagsForActivity`.
   */
  name?: string;
  /**
   * Initial chips. In edit mode the wizard pre-fills from the activity's
   * existing `activity_tag` rows; on a failed-submit round-trip the review
   * page re-hydrates from the `tags` query param.
   */
  defaultTags?: readonly string[];
}

interface UserTagSuggestion {
  tag: string;
  count: number;
}

const MAX_TAG_LEN = 60;
const MAX_TAGS = 40;

/**
 * Free-form tag input for the activity wizards — the data-entry-time twin of
 * {@link ./tag-editor.tsx TagEditor}.
 *
 * TagEditor edits the tags of an activity that already exists: it owns a
 * debounced PUT to `/api/activities/[id]/tags`. A wizard has no activity id
 * until submit, so this component is a *controlled, no-network* chip editor.
 * The chip set is mirrored into a hidden `<input>` as a JSON array; the
 * wizard's existing `<form>` carries it to the server action, which hands it
 * to `setTagsForActivity` after the INSERT. One vocabulary (`activity_tag`),
 * one autocomplete source (`GET /api/tags`) — shared with TagEditor so a tag
 * minted in a wizard immediately autocompletes everywhere else.
 */
export function WizardTagInput({
  name = "tags",
  defaultTags = [],
}: WizardTagInputProps) {
  const t = useT();

  // Canonicalise the initial set the same way the server does — trim,
  // case-insensitive dedupe (first-seen casing wins).
  const [tags, setTags] = React.useState<readonly string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of defaultTags) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lc = trimmed.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      out.push(trimmed);
    }
    return out;
  });

  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [suggestions, setSuggestions] = React.useState<UserTagSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  // Load the user's tag vocabulary once. Errors are non-fatal — autocomplete
  // just stays empty.
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
        // best-effort — silent.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Click-outside collapses the dropdown.
  React.useEffect(() => {
    if (!suggestionsOpen) return;
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [suggestionsOpen]);

  function addTag(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_TAG_LEN) {
      setError(t("activity.tags.errors.tooLong", { max: MAX_TAG_LEN }));
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setError(t("activity.tags.errors.tooMany", { max: MAX_TAGS }));
      return;
    }
    const lc = trimmed.toLowerCase();
    if (tags.some((x) => x.toLowerCase() === lc)) {
      // Duplicate — silent no-op, just clear the draft.
      setDraft("");
      return;
    }
    setTags([...tags, trimmed]);
    setDraft("");
    setError(null);
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }

  function removeTag(tag: string) {
    setTags(tags.filter((x) => x !== tag));
  }

  // Filter + rank: prefix match beats substring match, ties broken by count.
  const filteredSuggestions = React.useMemo(() => {
    const q = draft.trim().toLowerCase();
    const inUse = new Set(tags.map((x) => x.toLowerCase()));
    const candidates = suggestions.filter(
      (s) => !inUse.has(s.tag.toLowerCase()),
    );
    if (!q) return candidates.slice(0, 8);
    const scored = candidates
      .map((s) => {
        const lc = s.tag.toLowerCase();
        let score = 0;
        if (lc.startsWith(q)) score = 2;
        else if (lc.includes(q)) score = 1;
        return { ...s, _score: score };
      })
      .filter((s) => s._score > 0);
    scored.sort((a, b) =>
      b._score !== a._score ? b._score - a._score : b.count - a.count,
    );
    return scored.slice(0, 8);
  }, [draft, suggestions, tags]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Don't let Enter submit the wizard form — it commits the chip instead.
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filteredSuggestions.length) {
        addTag(filteredSuggestions[activeIndex].tag);
      } else {
        addTag(draft);
      }
      return;
    }
    if (e.key === "Tab" && draft.trim() && filteredSuggestions[0]) {
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
      setActiveIndex((i) => Math.min(filteredSuggestions.length - 1, i + 1));
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
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Commit the draft on blur unless focus moved into the dropdown.
    if (wrapperRef.current?.contains(e.relatedTarget as Node)) return;
    if (draft.trim()) addTag(draft);
    setTimeout(() => {
      setSuggestionsOpen(false);
      setActiveIndex(-1);
    }, 100);
  }

  return (
    <div ref={wrapperRef} className="flex flex-col gap-2">
      {/* The wizard <form> serialises this — a JSON array of strings. */}
      <input type="hidden" name={name} value={JSON.stringify(tags)} />

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
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
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
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(s.tag);
                    inputRef.current?.focus();
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

      {error && (
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-down">
          {error}
        </p>
      )}
    </div>
  );
}
