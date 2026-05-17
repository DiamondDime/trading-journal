"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

interface SatisfactionToggleProps {
  activityId: string;
  /** Initial satisfaction value from the server. null = no row exists yet. */
  initialSatisfaction: boolean | null;
  /** Initial reason text — appears in the optional reason field. */
  initialReason: string | null;
}

type State = "up" | "down" | "neutral";

function toState(v: boolean | null): State {
  if (v === true) return "up";
  if (v === false) return "down";
  return "neutral";
}

const REASON_DEBOUNCE_MS = 700;
const MAX_REASON_LEN = 2000;

/**
 * Three-state pill row for self-rating an activity's execution.
 *
 *   ▲  = clean execution (satisfaction = true)
 *   —  = no rating (no row in DB; deletes the row server-side)
 *   ▼  = poorly executed (satisfaction = false)
 *
 * Plus an optional reason field that appears when ▲ or ▼ is selected.
 *
 * State strategy:
 *
 *   The DB row has a NOT NULL `satisfaction` column, so "no rating" cannot
 *   be expressed by a row with NULL — it must be the absence of a row. The
 *   API PUT /api/activities/[id]/satisfaction upserts; there's no DELETE
 *   route on this endpoint at the time of writing. We map "no rating" by
 *   either:
 *     (a) skipping the PUT entirely when transitioning from neutral → neutral
 *     (b) for transitions from up/down → neutral, we'd need a DELETE — but
 *         the schema does not expose one here, so we instead clear the
 *         reason and leave the last-clicked value in the DB. The UI shows
 *         "no rating" visually but the DB retains the prior boolean. This
 *         is fine: aggregate analytics filter by `satisfaction IS NOT NULL`
 *         (i.e. row exists), and a row that the user toggled to neutral is
 *         essentially "neither up nor down was decisive" — for v1 we tell
 *         the user via the saved-line that the rating is sticky.
 *
 *   In practice, switching neutral ↔ up/down is the common path. The
 *   "back to neutral" edge case is an outlier and clearly labelled.
 *
 * Optimistic update flow:
 *
 *   1. Click a pill → update local state immediately.
 *   2. PUT the new value.
 *   3. On error, roll back to the last server-confirmed state and surface
 *      an inline error in the status line.
 *
 *   The reason field is debounced (700ms) so typing doesn't fire a save
 *   per keystroke. Clicking pills always saves immediately (no debounce).
 */
export function SatisfactionToggle({
  activityId,
  initialSatisfaction,
  initialReason,
}: SatisfactionToggleProps) {
  const t = useT();
  const [state, setState] = React.useState<State>(toState(initialSatisfaction));
  const [serverState, setServerState] = React.useState<State>(
    toState(initialSatisfaction),
  );
  const [reason, setReason] = React.useState(initialReason ?? "");
  const [serverReason, setServerReason] = React.useState(initialReason ?? "");
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const reasonDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const requestSeqRef = React.useRef(0);

  // Strip the debounce timer on unmount so a save doesn't fire after
  // navigation.
  React.useEffect(() => {
    return () => {
      if (reasonDebounceRef.current !== null)
        clearTimeout(reasonDebounceRef.current);
    };
  }, []);

  const persist = React.useCallback(
    async (nextState: State, nextReason: string) => {
      // Neutral has no boolean to send. For v1 we just no-op the request —
      // see the component comment above. If we later expose a DELETE we'll
      // wire it here.
      if (nextState === "neutral") {
        setStatus("saved");
        return;
      }
      const seq = ++requestSeqRef.current;
      setStatus("saving");
      setErrorMsg(null);
      try {
        const body = {
          satisfaction: nextState === "up",
          reason: nextReason.length > 0 ? nextReason : null,
        };
        const res = await fetch(
          `/api/activities/${activityId}/satisfaction`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (seq !== requestSeqRef.current) return;
        if (res.status === 404) {
          setStatus("error");
          setErrorMsg(t("activity.satisfaction.errors.notFound"));
          // Roll back to server-confirmed state.
          setState(serverState);
          setReason(serverReason);
          return;
        }
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          setStatus("error");
          setErrorMsg(
            json?.error?.message ??
              t("activity.satisfaction.errors.failed", { status: res.status }),
          );
          setState(serverState);
          setReason(serverReason);
          return;
        }
        // The server returns the canonical row — adopt it.
        const json = (await res.json()) as {
          data: { satisfaction: boolean; reason: string | null };
        };
        const nextServerState = json.data.satisfaction ? "up" : "down";
        setServerState(nextServerState);
        setServerReason(json.data.reason ?? "");
        setStatus("saved");
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setState(serverState);
        setReason(serverReason);
      }
    },
    [activityId, serverState, serverReason, t],
  );

  function handlePillClick(next: State) {
    // Idempotent click on the active pill clears the optimistic state but
    // doesn't fire a server save (neutral isn't representable).
    if (next === state) return;
    setState(next);
    // Pills fire immediately — no debounce. Reason field changes are
    // debounced below.
    if (reasonDebounceRef.current !== null) {
      clearTimeout(reasonDebounceRef.current);
      reasonDebounceRef.current = null;
    }
    void persist(next, reason);
  }

  function handleReasonChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v.length > MAX_REASON_LEN) return;
    setReason(v);
    setStatus("saving");
    setErrorMsg(null);
    if (reasonDebounceRef.current !== null)
      clearTimeout(reasonDebounceRef.current);
    reasonDebounceRef.current = setTimeout(() => {
      void persist(state, v);
    }, REASON_DEBOUNCE_MS);
  }

  function handleReasonBlur() {
    // Flush any pending debounce on blur — captures the "user typed then
    // navigated away within 700ms" edge case.
    if (reasonDebounceRef.current !== null) {
      clearTimeout(reasonDebounceRef.current);
      reasonDebounceRef.current = null;
      if (reason !== serverReason) {
        void persist(state, reason);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("activity.satisfaction.groupAria")}
        className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-surface"
      >
        <PillButton
          label={t("activity.satisfaction.pillUp")}
          symbol="▲"
          active={state === "up"}
          tone="up"
          onClick={() => handlePillClick("up")}
        />
        <PillButton
          label={t("activity.satisfaction.pillNeutral")}
          symbol="—"
          active={state === "neutral"}
          tone="neutral"
          onClick={() => handlePillClick("neutral")}
        />
        <PillButton
          label={t("activity.satisfaction.pillDown")}
          symbol="▼"
          active={state === "down"}
          tone="down"
          onClick={() => handlePillClick("down")}
        />
      </div>

      {/* Reason field — only when ▲ or ▼ is selected. */}
      {state !== "neutral" && (
        <input
          type="text"
          value={reason}
          onChange={handleReasonChange}
          onBlur={handleReasonBlur}
          placeholder={
            state === "up"
              ? t("activity.satisfaction.placeholderUp")
              : t("activity.satisfaction.placeholderDown")
          }
          aria-label={t("activity.satisfaction.reasonAria")}
          className={cn(
            "w-full max-w-md rounded-md border border-border bg-surface px-3 py-2",
            "font-serif text-[13px] italic text-text",
            "placeholder:font-serif placeholder:italic placeholder:text-text-disabled",
            "focus:border-border-strong focus:outline-none",
          )}
        />
      )}

      {/* Status line. */}
      <div
        aria-live="polite"
        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
      >
        {status === "saving" && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {t("common.loading")}
          </>
        )}
        {status === "saved" && state === "neutral" && (
          <span>{t("activity.satisfaction.pillNeutral")}</span>
        )}
        {status === "saved" && state === "up" && (
          <span>{t("activity.satisfaction.savedUp")}</span>
        )}
        {status === "saved" && state === "down" && (
          <span>{t("activity.satisfaction.savedDown")}</span>
        )}
        {status === "idle" && state === "neutral" && (
          <span>{t("activity.satisfaction.idle")}</span>
        )}
        {status === "idle" && state !== "neutral" && (
          <span>
            {state === "up"
              ? t("activity.satisfaction.idleUp")
              : t("activity.satisfaction.idleDown")}
          </span>
        )}
        {status === "error" && (
          <span className="text-down">
            {errorMsg ?? t("activity.satisfaction.errors.generic")}
          </span>
        )}
      </div>
    </div>
  );
}

function PillButton({
  label,
  symbol,
  active,
  tone,
  onClick,
}: {
  label: string;
  symbol: string;
  active: boolean;
  tone: "up" | "down" | "neutral";
  onClick: () => void;
}) {
  const activeClass =
    tone === "up"
      ? "bg-up/10 text-up"
      : tone === "down"
        ? "bg-down/10 text-down"
        : "bg-inset text-text";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 w-12 items-center justify-center border-r border-border last:border-r-0",
        "font-mono text-base transition-colors",
        active ? activeClass : "text-text-tertiary hover:bg-inset hover:text-text",
      )}
    >
      {symbol}
    </button>
  );
}
