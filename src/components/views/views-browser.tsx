"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/resolve";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogEyebrow,
  DialogBody,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { WizardField, WizardInput } from "@/components/wizard/wizard-field";
import type { ViewWithCount } from "@/app/views/page";

interface ViewsBrowserProps {
  initialViews: ViewWithCount[];
  prefillFrom?: string;
}

/**
 * Pretty-print a saved view's URL for the description column. Strips the
 * leading "/spreads/archive" so the eye lands on the differentiating part of
 * the URL (the filter params). Empty string → localized "all activity".
 */
function prettyPath(qs: string, t: TFunction): string {
  if (!qs) return "—";
  try {
    const u = new URL(qs, "https://invalid.local");
    const search = u.searchParams;
    const parts: string[] = [];
    const activity = search.get("activity");
    const type = search.get("type");
    const asset = search.get("asset");
    const status = search.get("status");
    const outcome = search.get("outcome");
    const q = search.get("q");
    if (activity) parts.push(activity.replace(/,/g, "+"));
    if (type) parts.push(type.replace(/,/g, "+"));
    if (asset) parts.push(asset.replace(/,/g, "+"));
    if (status) parts.push(status.replace(/,/g, "+"));
    if (outcome) parts.push(outcome);
    if (q) parts.push(`"${q}"`);
    if (parts.length === 0) return t("views.allActivity");
    return parts.join(" · ");
  } catch {
    return qs;
  }
}

function fmtRelative(iso: string | null, locale: "en" | "ru", t: TFunction): string {
  if (!iso) return t("views.never");
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return t("views.never");
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
  return rtf.format(-Math.floor(mo / 12), "year");
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

type DialogState =
  | { mode: "closed" }
  | { mode: "create"; queryString: string }
  | { mode: "edit"; view: ViewWithCount }
  | { mode: "delete"; view: ViewWithCount };

export function ViewsBrowser({ initialViews, prefillFrom }: ViewsBrowserProps) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [views, setViews] = React.useState<ViewWithCount[]>(initialViews);
  const [dialog, setDialog] = React.useState<DialogState>(() =>
    prefillFrom ? { mode: "create", queryString: prefillFrom } : { mode: "closed" },
  );
  const [flashError, setFlashError] = React.useState<string | null>(null);

  // Strip prefillFrom from the URL once we've consumed it so a page refresh
  // doesn't keep popping the dialog.
  React.useEffect(() => {
    if (!prefillFrom) return;
    router.replace("/views", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    try {
      const res = await fetch("/api/saved-views", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(t("views.errors.refreshFailed"));
      const json = (await res.json()) as { data: ViewWithCount[] };
      // Server doesn't recompute counts here — they update on next full
      // page load. Splice in any rows we don't already know about.
      setViews((prev) => {
        const byId = new Map(prev.map((v) => [v.id, v]));
        return json.data.map((v) => ({
          ...byId.get(v.id),
          ...v,
          activitiesCount: byId.get(v.id)?.activitiesCount ?? 0,
          activitiesCountCapped: byId.get(v.id)?.activitiesCountCapped ?? false,
        })) as ViewWithCount[];
      });
    } catch (err) {
      setFlashError(err instanceof Error ? err.message : t("views.errors.refreshFailed"));
    }
  };

  const handleApply = async (view: ViewWithCount) => {
    if (!view.queryString) {
      setFlashError(t("views.errors.noUrl", { name: view.name }));
      return;
    }
    // Bump lastAppliedAt fire-and-forget — non-blocking. Failure is silent
    // (the apply nav still happens).
    void fetch(`/api/saved-views/${view.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applied: true }),
    });
    // Navigate. If the stored URL is malformed we stay on /views and surface
    // the error so the user can open Edit and fix it. Navigating away to the
    // archive root would hide the error from view.
    try {
      const url = new URL(view.queryString, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Bad origin");
      router.push(url.pathname + url.search);
    } catch {
      setFlashError(t("views.malformed", { name: view.name }));
    }
  };

  return (
    <div className="w-full">
      {/* ── hero strip ──────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 border-b border-border px-8 py-7 md:flex-row md:items-end md:justify-between lg:px-12">
        <div>
          <h1 className="font-serif text-[40px] font-medium leading-none tracking-tight text-text">
            {t("views.title")}
          </h1>
          <p className="mt-2 font-serif text-sm italic text-text-tertiary">
            {t("views.subtitle")}
          </p>
        </div>
        <div className="flex items-end gap-6">
          <div className="text-right">
            <p
              aria-label={t.plural("plurals.views", views.length)}
              className="font-serif text-[44px] font-medium leading-none tracking-tight tabular-nums text-signature"
            >
              {views.length.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
              {t.plural("views.counterNoun", views.length)}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setDialog({ mode: "create", queryString: "/spreads/archive" })
            }
            className="flex items-center gap-1.5 rounded-md border border-text bg-text px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("views.newView")}
          </button>
        </div>
      </header>

      <div className="px-8 py-8 lg:px-12">
        {flashError && (
          <div className="mb-6 flex items-start justify-between gap-3 rounded-md border border-down/40 bg-down/10 px-4 py-3 font-mono text-[11px] text-down">
            <span>{flashError}</span>
            <button
              type="button"
              onClick={() => setFlashError(null)}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-down/80 hover:text-down"
              aria-label={t("views.dismissAria")}
            >
              {t("views.dismiss")}
            </button>
          </div>
        )}

        {views.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="overflow-hidden rounded-md border border-border bg-surface">
            {/* Table header */}
            <li className="grid grid-cols-[1fr_2fr_auto_auto_auto] items-baseline gap-4 border-b border-border px-5 py-3 font-mono text-[9px] uppercase tracking-[0.18em] text-text-tertiary">
              <span>{t("views.cols.name")}</span>
              <span>{t("views.cols.filters")}</span>
              <span className="text-right">{t("views.cols.activities")}</span>
              <span className="text-right">{t("views.cols.lastApplied")}</span>
              <span className="text-right">{t("views.cols.actions")}</span>
            </li>

            {views.map((view) => (
              <li
                key={view.id}
                className="grid grid-cols-[1fr_2fr_auto_auto_auto] items-center gap-4 border-b border-border-subtle px-5 py-4 transition-colors last:border-b-0 hover:bg-subtle/60"
              >
                <button
                  type="button"
                  onClick={() => handleApply(view)}
                  className="flex flex-col items-start gap-0.5 text-left"
                >
                  <span className="font-serif text-[15px] font-medium text-text underline-offset-4 hover:underline">
                    {view.name}
                  </span>
                  {view.description && (
                    <span className="font-serif text-[12px] italic text-text-tertiary line-clamp-1">
                      {view.description}
                    </span>
                  )}
                </button>

                <code
                  title={view.queryString || "—"}
                  className="font-serif text-[12px] italic text-text-secondary line-clamp-1"
                >
                  {prettyPath(view.queryString, t)}
                </code>

                <span
                  className="text-right font-mono text-[12px] tabular-nums text-text"
                  title={view.activitiesCountCapped ? t("views.countCappedTitle") : undefined}
                  aria-label={
                    view.activitiesCountCapped
                      ? t("views.countCappedAria", { count: view.activitiesCount })
                      : undefined
                  }
                >
                  {view.activitiesCount.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}
                  {view.activitiesCountCapped && (
                    <span aria-hidden="true" className="text-text-tertiary">+</span>
                  )}
                </span>

                <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  {fmtRelative(view.lastAppliedAt, locale, t)}
                </span>

                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => handleApply(view)}
                    aria-label={t("views.applyAria", { name: view.name })}
                    className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors hover:bg-surface hover:text-text"
                  >
                    {t("views.actionApply")} <ArrowRight className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "edit", view })}
                    aria-label={t("views.editAria", { name: view.name })}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface hover:text-text"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "delete", view })}
                    aria-label={t("views.deleteAria", { name: view.name })}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-down/10 hover:text-down"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── dialogs ─────────────────────────────────────────────────────── */}
      {dialog.mode === "create" && (
        <ViewFormDialog
          mode="create"
          initialQueryString={dialog.queryString}
          onClose={() => setDialog({ mode: "closed" })}
          onSuccess={async () => {
            await refresh();
            // Reload the page to recompute the activities counts from the
            // server. Anything fancier (per-view incremental fetch) is
            // unnecessary for the typical O(10) saved-view count.
            router.refresh();
            setDialog({ mode: "closed" });
          }}
        />
      )}

      {dialog.mode === "edit" && (
        <ViewFormDialog
          mode="edit"
          view={dialog.view}
          onClose={() => setDialog({ mode: "closed" })}
          onSuccess={async () => {
            router.refresh();
            setDialog({ mode: "closed" });
          }}
        />
      )}

      {dialog.mode === "delete" && (
        <DeleteConfirmDialog
          view={dialog.view}
          onClose={() => setDialog({ mode: "closed" })}
          onSuccess={async () => {
            setViews((prev) =>
              prev.filter((v) => v.id !== (dialog as { view: ViewWithCount }).view.id),
            );
            router.refresh();
            setDialog({ mode: "closed" });
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dialog: create / edit
// ──────────────────────────────────────────────────────────────────────────

interface ViewFormDialogProps {
  mode: "create" | "edit";
  view?: ViewWithCount;
  initialQueryString?: string;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

function ViewFormDialog({
  mode,
  view,
  initialQueryString,
  onClose,
  onSuccess,
}: ViewFormDialogProps) {
  const t = useT();
  const [name, setName] = React.useState(view?.name ?? "");
  const [description, setDescription] = React.useState(view?.description ?? "");
  const [queryString, setQueryString] = React.useState(
    view?.queryString ?? initialQueryString ?? "/spreads/archive",
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/saved-views", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description, queryString }),
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          throw new Error(
            errJson?.error?.message ??
              t("views.errors.createFailed", { status: res.status }),
          );
        }
      } else if (mode === "edit" && view) {
        const res = await fetch(`/api/saved-views/${view.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description, queryString }),
        });
        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          throw new Error(
            errJson?.error?.message ??
              t("views.errors.updateFailed", { status: res.status }),
          );
        }
      }
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("views.errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogEyebrow>
            {mode === "create" ? t("views.create.eyebrow") : t("views.edit.eyebrow")}
          </DialogEyebrow>
          <DialogTitle>
            {mode === "create" ? t("views.create.title") : t("views.edit.title")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("views.create.description") : t("views.edit.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody>
            <div className="flex flex-col gap-5">
              <WizardField label={t("views.fields.name")} htmlFor="view-name" required>
                <WizardInput
                  id="view-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("views.fields.namePlaceholder")}
                  maxLength={60}
                  autoFocus
                  required
                />
              </WizardField>

              <WizardField
                label={t("views.fields.description")}
                htmlFor="view-description"
                helper={t("views.fields.descriptionHint")}
              >
                <WizardInput
                  id="view-description"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("views.fields.descriptionPlaceholder")}
                  maxLength={200}
                />
              </WizardField>

              <WizardField
                label={t("views.fields.queryString")}
                htmlFor="view-url"
                required
                helper={t("views.fields.queryStringHint")}
              >
                <WizardInput
                  id="view-url"
                  type="text"
                  value={queryString}
                  onChange={(e) => setQueryString(e.target.value)}
                  placeholder={t("views.fields.queryStringPlaceholder")}
                  required
                />
              </WizardField>

              {error && (
                <p className="font-mono text-[11px] text-down">{error}</p>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary hover:bg-subtle hover:text-text"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || name.trim().length === 0}
              className={cn(
                "rounded-md border border-text bg-text px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {submitting ? t("views.saving") : t("common.save")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dialog: delete confirmation
// ──────────────────────────────────────────────────────────────────────────

function DeleteConfirmDialog({
  view,
  onClose,
  onSuccess,
}: {
  view: ViewWithCount;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const t = useT();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/saved-views/${view.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const errJson = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          errJson?.error?.message ?? t("views.errors.deleteFailed", { status: res.status }),
        );
      }
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("views.errors.generic"));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogEyebrow>{t("views.deleteDialog.eyebrow")}</DialogEyebrow>
          <DialogTitle>{t("views.deleteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("views.deleteDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <p className="font-mono text-[11px] text-down">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary hover:bg-subtle hover:text-text"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="rounded-md border border-down bg-down px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-app transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t("views.deleting") : t("views.deleteDialog.confirm")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────────────────────────────────

function EmptyState() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-surface py-16 text-center">
      <p className="font-serif text-[20px] italic text-text-secondary">
        {t("views.emptyHeading")}
      </p>
      <p className="max-w-md font-serif text-sm italic text-text-tertiary">
        {t("views.emptyBody")}
      </p>
      <Link
        href="/spreads/archive"
        className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary underline-offset-4 hover:text-text hover:underline"
      >
        {t("views.openArchive")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
