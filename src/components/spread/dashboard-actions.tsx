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
import { useT, useLocale } from "@/lib/i18n/client";

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

const RANGE_KEYS: Record<
  DateRangePreset,
  | "dashboard.actions.rangePresets.7d"
  | "dashboard.actions.rangePresets.30d"
  | "dashboard.actions.rangePresets.90d"
  | "dashboard.actions.rangePresets.ytd"
  | "dashboard.actions.rangePresets.all"
  | "dashboard.actions.rangePresets.custom"
> = {
  "7d": "dashboard.actions.rangePresets.7d",
  "30d": "dashboard.actions.rangePresets.30d",
  "90d": "dashboard.actions.rangePresets.90d",
  ytd: "dashboard.actions.rangePresets.ytd",
  all: "dashboard.actions.rangePresets.all",
  custom: "dashboard.actions.rangePresets.custom",
};

const TYPE_KEYS: Record<
  ActivityType,
  | "dashboard.actions.activityTypes.spread"
  | "dashboard.actions.activityTypes.trade"
  | "dashboard.actions.activityTypes.sale"
  | "dashboard.actions.activityTypes.airdrop"
  | "dashboard.actions.activityTypes.yield_position"
  | "dashboard.actions.activityTypes.option"
> = {
  spread: "dashboard.actions.activityTypes.spread",
  trade: "dashboard.actions.activityTypes.trade",
  sale: "dashboard.actions.activityTypes.sale",
  airdrop: "dashboard.actions.activityTypes.airdrop",
  yield_position: "dashboard.actions.activityTypes.yield_position",
  option: "dashboard.actions.activityTypes.option",
};

export function DashboardActions({
  connectedExchangeCount,
  current,
}: DashboardActionsProps) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";
  // Live filter state for the dialog only. The page's URL state is the
  // source of truth; this is reset every time the dialog opens.
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DashboardSearchParams>(current);
  // Sync the dialog's draft state to URL state every time the dialog opens
  // (or the URL filter changes while open). The setState-in-effect rule
  // doesn't apply cleanly here: this is a deliberate sync of external state
  // (URL searchParams) into local dialog state on a discrete trigger.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        setSyncMsg(t("dashboard.actions.syncMessages.failed"));
      } else if (body?.data) {
        const { queued, total } = body.data;
        if (total === 0) {
          setSyncMsg(t("dashboard.actions.syncMessages.noExchanges"));
        } else if (queued === 0) {
          setSyncMsg(t("dashboard.actions.syncMessages.inProgress"));
        } else {
          setSyncMsg(
            t.plural("dashboard.actions.syncMessages.queuedFor", queued),
          );
        }
      } else {
        setSyncMsg(t("dashboard.actions.syncMessages.submitted"));
      }
    } catch {
      setSyncMsg(t("dashboard.actions.syncMessages.connectionFailed"));
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
        {t.plural(
          "dashboard.actions.exchangesConnected",
          connectedExchangeCount,
        )}
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
            aria-label={t("dashboard.actions.openFilterAria")}
          >
            <Filter className="h-3 w-3" />
            {t("dashboard.actions.filter")}
            {filterActive && (
              <span className="rounded-sm bg-text px-1 font-mono text-[8px] tracking-normal text-app">
                {t("dashboard.actions.filterOn")}
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("dashboard.actions.filterDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.actions.filterDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-6">
            {/* Date range */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {t("dashboard.actions.filterDialog.dateRange")}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {DATE_RANGE_PRESETS.map((preset) => (
                  <FilterChip
                    key={preset}
                    active={draft.range === preset}
                    onClick={() => setDraft((d) => ({ ...d, range: preset }))}
                    label={t(RANGE_KEYS[preset])}
                  />
                ))}
                <FilterChip
                  active={draft.range === "custom"}
                  onClick={() => setDraft((d) => ({ ...d, range: "custom" }))}
                  label={t(RANGE_KEYS.custom)}
                />
              </div>
              {draft.range === "custom" && (
                <div className="mt-1 flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
                      {t("dashboard.actions.filterDialog.fromLabel")}
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
                      {t("dashboard.actions.filterDialog.toLabel")}
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
                {t("dashboard.actions.filterDialog.activityTypes")}
              </legend>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                {t("dashboard.actions.filterDialog.activityTypesHint")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((at) => (
                  <FilterChip
                    key={at}
                    active={draft.types.includes(at)}
                    onClick={() => toggleType(at)}
                    label={t(TYPE_KEYS[at])}
                    icon={draft.types.includes(at) ? "check" : null}
                  />
                ))}
              </div>
            </fieldset>

            {/* Min capital */}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
                {t("dashboard.actions.filterDialog.minCapital")}
              </legend>
              <p className="font-serif text-[12px] italic text-text-tertiary">
                {t("dashboard.actions.filterDialog.minCapitalHint")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MIN_CAPITAL_PRESETS.map((c) => (
                  <FilterChip
                    key={c}
                    active={draft.minCapital === c}
                    onClick={() => setDraft((d) => ({ ...d, minCapital: c }))}
                    label={
                      c === 0
                        ? t("dashboard.actions.filterDialog.minCapitalZero")
                        : t("dashboard.actions.filterDialog.minCapitalAtLeast", {
                            value: c.toLocaleString(intlLocale),
                          })
                    }
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
              <X className="h-3 w-3" />
              {t("dashboard.actions.filterDialog.reset")}
            </button>
            <DialogClose asChild>
              <button className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle">
                {t("dashboard.actions.filterDialog.cancel")}
              </button>
            </DialogClose>
            <Button
              onClick={applyFilter}
              className="bg-text text-app hover:bg-text/90"
              size="sm"
            >
              <Check className="h-3 w-3" />
              {t("dashboard.actions.filterDialog.apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export — plain anchor so the browser handles the download natively */}
      <a
        href={exportHref}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:bg-subtle"
        download
      >
        <Download className="h-3 w-3" /> {t("dashboard.actions.export")}
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
          aria-label={t("dashboard.actions.syncAllAria")}
        >
          <RefreshCw
            className={cn("h-3 w-3", syncing && "animate-spin")}
          />
          {syncing
            ? t("dashboard.actions.syncing")
            : syncCooldown
              ? t("dashboard.actions.queued")
              : t("dashboard.actions.sync")}
        </button>
      ) : (
        <Link
          href="/settings/exchanges"
          className="flex items-center gap-1.5 rounded-md border border-text bg-text/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text hover:bg-text/10"
        >
          <RefreshCw className="h-3 w-3" />
          {t("dashboard.actions.connectExchange")}
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
