"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  connectionId: string;
  exchangeName: string;
}

export function ExchangeRowActions({ connectionId, exchangeName }: Props) {
  const router = useRouter();
  const t = useT();

  const [syncing, setSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Auto-clear the per-row sync message after a few seconds so the row settles
  // back to its resting state.
  React.useEffect(() => {
    if (!syncMessage) return;
    const t = setTimeout(() => setSyncMessage(null), 5000);
    return () => clearTimeout(t);
  }, [syncMessage]);

  async function onSyncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/exchanges/${connectionId}/sync`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | { data?: { sync_job_id?: string } }
        | null;

      if (!res.ok) {
        const msg =
          (body && "error" in body && body.error?.message) ||
          (res.status === 409
            ? t("settings.exchanges.row.errors.syncRunning")
            : t("settings.exchanges.row.errors.syncFailed", { status: res.status }));
        setSyncMessage({ tone: "err", text: msg });
      } else {
        setSyncMessage({ tone: "ok", text: t("settings.exchanges.row.syncQueued") });
        router.refresh();
      }
    } catch (e) {
      setSyncMessage({
        tone: "err",
        text: e instanceof Error ? e.message : t("settings.exchanges.row.errors.network"),
      });
    } finally {
      setSyncing(false);
    }
  }

  async function onConfirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/exchanges/${connectionId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setDeleteError(
          body?.error?.message ??
            t("settings.exchanges.row.errors.deleteFailed", { status: res.status }),
        );
        setDeleting(false);
        return;
      }
      setDeleteOpen(false);
      setDeleting(false);
      router.refresh();
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : t("settings.exchanges.row.errors.network"),
      );
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {syncMessage && (
        <span
          role="status"
          aria-live="polite"
          className={
            "font-mono text-[10px] uppercase tracking-[0.14em] " +
            (syncMessage.tone === "ok" ? "text-up" : "text-down")
          }
        >
          {syncMessage.text}
        </span>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onSyncNow}
        disabled={syncing}
        className="font-mono text-[10px] uppercase tracking-[0.12em]"
        aria-label={t("settings.exchanges.row.syncAria", { name: exchangeName })}
      >
        {syncing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {syncing
          ? t("settings.exchanges.row.syncing")
          : t("settings.exchanges.row.syncNow")}
      </Button>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) {
            setDeleteError(null);
            setDeleting(false);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("settings.exchanges.row.disconnectAria", { name: exchangeName })}
            className="text-text-tertiary hover:text-down"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogEyebrow>
              {t("settings.exchanges.row.confirmEyebrow")}
            </DialogEyebrow>
            <DialogTitle>
              {t("settings.exchanges.row.confirmTitle", { name: exchangeName })}
            </DialogTitle>
            <DialogDescription>
              {t("settings.exchanges.row.confirmDesc")}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <ul className="space-y-1.5 font-serif text-[13px] text-text-secondary">
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                {t("settings.exchanges.row.confirmBullet1")}
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                {t("settings.exchanges.row.confirmBullet2")}
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                {t("settings.exchanges.row.confirmBullet3")}
              </li>
            </ul>

            {deleteError && (
              <p
                role="alert"
                aria-live="polite"
                className="mt-4 rounded-md border border-down bg-down-bg px-3 py-2 font-mono text-[12px] text-down"
              >
                {deleteError}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirmDelete}
              disabled={deleting}
              className="font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleting
                ? t("settings.exchanges.row.disconnecting")
                : t("settings.exchanges.row.disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
