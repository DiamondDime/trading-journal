"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface NotesEditorProps {
  activityId: string;
  /** Initial body content (empty string if no note exists yet). */
  initialBody: string;
  /** Server's `updated_at` for the note — used as the version token. Pass
   *  null when no note exists yet (the first save creates it). */
  initialVersion: string | null;
}

type Status = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Editorial Markdown notes editor.
 *
 * - Textarea below the "Notes" section heading, full-width, serif body.
 * - Autosaves 1500ms after the user stops typing.
 * - Manual "Save" button calls the same POST path.
 * - Shows "Last saved at <relative time>" once a save has landed.
 * - Optimistic-concurrency: when the API returns 409 NOTE_VERSION_CONFLICT
 *   the editor pins an inline warning and refuses further autosaves until
 *   the user explicitly reloads — single-user v1 means this should never
 *   fire, but the surface is here so multi-device usage doesn't silently
 *   trample edits.
 *
 * The component is stateful but tiny: body, version (server's last
 * updated_at), and a status enum drive the entire render.
 */
export function NotesEditor({
  activityId,
  initialBody,
  initialVersion,
}: NotesEditorProps) {
  const [body, setBody] = React.useState(initialBody);
  const [version, setVersion] = React.useState<string | null>(initialVersion);
  const [status, setStatus] = React.useState<Status>("idle");
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(
    initialVersion ? new Date(initialVersion).getTime() : null,
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of the body at the last successful save — lets us short-circuit
  // saves when the user has typed and then reverted back to the saved value.
  const lastSavedBodyRef = React.useRef(initialBody);

  // Live-updating "Last saved at" relative timestamp.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (lastSavedAt === null) return;
    const interval = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  const save = React.useCallback(async () => {
    if (conflict) return;
    if (body === lastSavedBodyRef.current) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    setErrorMsg(null);
    try {
      // First save creates the row; subsequent saves go through the version-
      // checked PATCH-by-note-id path. We resolve the note's id lazily —
      // the simplest path is to always POST /api/notes (upsert). That
      // endpoint runs its own ownership + body checks.
      const res = await fetch(`/api/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activity_id: activityId, body }),
      });
      if (res.status === 409) {
        const json = await res.json().catch(() => null);
        setConflict(true);
        setStatus("error");
        setErrorMsg(
          json?.error?.message ??
            "This note was edited elsewhere. Reload to see the latest.",
        );
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setStatus("error");
        setErrorMsg(json?.error?.message ?? `Save failed (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        data: { updatedAt: string; body: string };
      };
      lastSavedBodyRef.current = json.data.body;
      setVersion(json.data.updatedAt);
      setLastSavedAt(new Date(json.data.updatedAt).getTime());
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }, [activityId, body, conflict]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(e.target.value);
    setStatus("dirty");
    setErrorMsg(null);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    if (!conflict) {
      debounceRef.current = setTimeout(() => {
        void save();
      }, 1500);
    }
  }

  function handleSaveClick() {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    void save();
  }

  // Save on blur too — captures the case where the user types, then clicks
  // somewhere else within the same render before the debounce fires.
  function handleBlur() {
    if (status === "dirty") {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      void save();
    }
  }

  React.useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  const versionLabel = renderRelativeTime(lastSavedAt, tick);

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={body}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Write what you'd want to read in a year. What worked, what didn't, what's worth doing differently next time…"
        aria-label="Activity notes"
        className={cn(
          "w-full resize-y rounded-md border border-border bg-surface p-4",
          "min-h-[180px] font-serif text-[15px] leading-[1.7] text-text",
          "placeholder:font-serif placeholder:italic placeholder:text-text-disabled",
          "focus:border-text focus:outline-none",
          conflict && "border-down/40 bg-down/5",
        )}
      />
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
        <span aria-live="polite">
          {status === "saving" && "Saving…"}
          {status === "dirty" && (lastSavedAt ? `Edited · last saved ${versionLabel}` : "Edited · unsaved")}
          {status === "saved" && (lastSavedAt ? `Saved ${versionLabel}` : "Saved")}
          {status === "idle" && lastSavedAt && `Last saved ${versionLabel}`}
          {status === "idle" && !lastSavedAt && "No note yet"}
          {status === "error" && (
            <span className="text-down">{errorMsg ?? "Error"}</span>
          )}
        </span>
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={status === "saving" || conflict}
          className={cn(
            "rounded-md border border-border bg-surface px-3 py-1.5 text-text-secondary",
            "transition-colors hover:border-border-strong hover:text-text",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {conflict && (
        <p
          className="rounded-md border border-down/30 bg-down/5 px-3 py-2 font-mono text-[11px] text-down"
          role="alert"
        >
          {errorMsg}
        </p>
      )}
      {/* Hidden: surface the current version so QA can introspect without
          digging into the DOM. */}
      {version && (
        <span data-testid="note-version" className="sr-only">
          version: {version}
        </span>
      )}
    </div>
  );
}

/**
 * "Just now", "2m ago", "1h ago", "Mar 14". Re-renders via the `tick`
 * dependency every 30s.
 */
function renderRelativeTime(ts: number | null, _tick: number): string {
  if (ts === null) return "—";
  void _tick;
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
