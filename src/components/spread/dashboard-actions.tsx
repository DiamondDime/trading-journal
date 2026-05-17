"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Filter, Download, RefreshCw, Check, X } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_TYPES,
  DATE_RANGE_PRESETS,
  MIN_CAPITAL_PRESETS,
  serializeDashboardSearchParams,
  type DashboardSearchParams,
  type DateRangePreset,
} from "@/lib/dashboard/filters";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/types/canonical";

/**
 * Dashboard action row — Filter / Export / Sync.
 *
 * All three buttons sit in the hero strip. They share a connected-exchange
 * count so the "Connect an exchange" CTA can replace the Sync button when
 * the user has none.
 *
 * State strategy:
 *  - Filter state lives in the URL (parent reads searchParams server-side).
 *    Submitting the dialog pushes a new URL; the page re-renders.
 *  - Export is a plain anchor — the browser does the download natively, no
 *    JS needed for the GET → file download path.
 *  - Sync POSTs to /api/exchanges/sync-all and surfaces a toast-style hint
 *    (a small inline status badge — we don't have a global toast yet).
 *    The button self-disables for 10s after click to prevent spam.
 */

interface DashboardActionsProps {
  connectedExchangeCount: number;
  current: DashboardSearchParams;
}

const RANGE_LABELS: Record<DateRangePreset, string> = {
  "7d": "Last 7d",
  "30d": "Last 30d",
  "90d": "Last 90d",
  ytd: "YTD",
  all: "All-time",
  custom: "Custom",
};

const TYPE_LABELS: Record<ActivityType, string> = {
  spread: "Spreads",
  trade: "Trades",
  sale: "Sales",
  airdrop: "Airdrops",
};

export function DashboardActions({
  connectedExchangeCount,
  current,
}: DashboardActionsProps) {
  // Live filter state for the dialog only. The page's URL state is the
  // source of truth; this is reset every time the dialog opens.
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DashboardSearchParams>(current);
  React.useEffect(() => {
    if (open) setDraft(current);
  }, [open, current]);

  const router = useRouter();

  // ── Filter submit ───────────────────────────────────────────────────────
  function applyFilter() {
    const sp = serializeDashboardSearchParams(draft);
    const qs = sp.toString();
    router.push(qs ? `/spreads?${qs}` : "/spreads");
    setOpen(false);
  }
  function clearFilter() {
    router.push("/spreads");
    setOpen(false);
  }
  function toggleType(t: ActivityType) {
    setDraft((d) => ({
      ...d,
      types: d.types.includes(t)
        ? d.types.filter((x) => x !== t)
        : [...d.types, t],
    }));
  }

  const filterActive =
    current.range !== "all" ||
    current.types.length > 0 ||
    current.minCapital > 0;

  // ── Export ──────────────────────────────────────────────────────────────
  // The dashboard's URL search params double as the export's. Forward them
  // verbatim so a filtered dashboard exports exactly its visible window.
  const exportHref = (() => {
    const sp = serializeDashboardSearchParams(current);
    sp.set("format", "json");
    return `/api/activities/export?${sp.toString()}`;
  })();

  // ── Sync ────────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = React.useState(false);
  const [syncCooldown, setSyncCooldown] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);

  async function triggerSync() {
    if (syncing || syncCooldown) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/exchanges/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { queued: number; skipped: number; total: number } }
        | null;
      if (!res.ok) {
        setSyncMsg("Sync request failed. Try again.");
      } else if (body?.data) {
        const { queued, total } = body.data;
        if (total === 0) {
          setSyncMsg("No exchanges to sync.");
        } else if (queued === 0) {
          setSyncMsg("Sync already in progress.");
        } else {
          setSyncMsg(
            `Sync queued for ${queued} ${queued === 1 ? "exchange" : "exchanges"}. Check back in a few minutes.`,
          );
        }
      } else {
        setSyncMsg("Sync request submitted.");
      }
    } catch {
      setSyncMsg("Sync request failed. Check your connection.");
    } finally {
      setSyncing(false);
      setSyncCooldown(true);
      // 10-second debounce window. Don't recompute server-side state in
      // between — the worker is the source of truth.
      window.setTimeout(() => setSyncCooldown(false), 10_000);
      window.setTimeout(() => setSyncMsg(null), 12_000);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
        <span className={connectedExchangeCount > 0 ? "text-up" : "text-text-tertiary"}>
          ●
        </span>{" "}
        {connectedExchangeCount} {connectedExchangeCount === 1 ? "exchange" : "exchanges"}{" "}
        connected
      </div>
      <div className="h-4 w-px bg-border" />

      {/* Filter */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
              filterActive
                ? "border-text bg-subtle text-text"
                : "border-border bg-surface text-text-secondary hover:bg-subtle",
            )}
            aria-label="Open filters dialog"
          >
            <Filter className="h-3 w-3" />
            Filter
            {filterActive && (
              <span className="rounded-sm bg-text px-1 font-mono text-[8px] tracking-normal text-app">
                ON
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Filter the dashboard</DialogTitle>
            <DialogDescription>
              Narrow the visible window. KPIs, charts, and the recent grid all
              re-render against the chosen slice.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-6">
            {/* Date range */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                Date range
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {DATE_RANGE_PRESETS.map((preset) => (
                  <FilterChip
                    key={preset}
                    active={draft.range === preset}
                    onClick={() => setDraft((d) => ({ ...d, range: preset }))}
                    label={RANGE_LABELS[preset]}
                  />
                ))}
                <FilterChip
                  active={draft.range === "custom"}
                  onClick={() => setDraft((d) => ({ ...d, range: "custom" }))}
                  label={RANGE_LABELS.custom}
                />
              </div>
              {draft.range === "custom" && (
                <div className="mt-1 flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                      From
                    </span>
                    <input
                      type="date"
                      value={draft.from ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, from: e.target.value || undefined }))
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[12px] text-text focus:border-text focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                      To
                    </span>
                    <input
                      type="date"
                      value={draft.to ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, to: e.target.value || undefined }))
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-[12px] text-text focus:border-text focus:outline-none"
                    />
                  </label>
                </div>
              )}
            </fieldset>

            {/* Activity types */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                Activity types
              </legend>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                Empty selection = all types. Pick one or more to narrow.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((t) => (
                  <FilterChip
                    key={t}
                    active={draft.types.includes(t)}
                    onClick={() => toggleType(t)}
                    label={TYPE_LABELS[t]}
                    icon={draft.types.includes(t) ? "check" : null}
                  />
                ))}
              </div>
            </fieldset>

            {/* Min capital */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                Minimum capital
              </legend>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                Hide activities below this capital floor. Useful when zero-cost
                airdrops are crowding the view.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MIN_CAPITAL_PRESETS.map((c) => (
                  <FilterChip
                    key={c}
                    active={draft.minCapital === c}
                    onClick={() => setDraft((d) => ({ ...d, minCapital: c }))}
                    label={c === 0 ? "$0" : `$${c.toLocaleString("en-US")}+`}
                  />
                ))}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <button
              onClick={clearFilter}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle"
            >
              <X className="h-3 w-3" /> Reset
            </button>
            <DialogClose asChild>
              <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
                Cancel
              </button>
            </DialogClose>
            <Button
              onClick={applyFilter}
              className="bg-text text-app hover:bg-text/90"
              size="sm"
            >
              <Check className="h-3 w-3" /> Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export — plain anchor so the browser handles the download natively */}
      <a
        href={exportHref}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle"
        // download attribute hints to the browser that the response is a
        // file — works alongside Content-Disposition on the server.
        download
      >
        <Download className="h-3 w-3" /> Export
      </a>

      {/* Sync */}
      {connectedExchangeCount > 0 ? (
        <button
          onClick={triggerSync}
          disabled={syncing || syncCooldown}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-subtle",
            (syncing || syncCooldown) && "cursor-not-allowed opacity-50",
          )}
          aria-label="Sync all connected exchanges"
        >
          <RefreshCw
            className={cn("h-3 w-3", syncing && "animate-spin")}
          />
          {syncing ? "Syncing…" : syncCooldown ? "Queued" : "Sync"}
        </button>
      ) : (
        <Link
          href="/settings/exchanges"
          className="flex items-center gap-1.5 rounded-md border border-text bg-text/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text hover:bg-text/10"
        >
          <RefreshCw className="h-3 w-3" /> Connect an exchange
        </Link>
      )}

      {/* Sync status (live region for screen readers). Renders below the row
          inline; we don't have a global toast in v1. */}
      {syncMsg && (
        <span
          aria-live="polite"
          className="font-mono text-[10px] text-text-tertiary"
        >
          {syncMsg}
        </span>
      )}
    </div>
  );
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: "check" | null;
}

function FilterChip({ active, onClick, label, icon }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
        active
          ? "border-text bg-text/5 text-text"
          : "border-border bg-surface text-text-secondary hover:bg-subtle",
      )}
    >
      {icon === "check" && <Check className="h-3 w-3" />}
      {label}
    </button>
  );
}
