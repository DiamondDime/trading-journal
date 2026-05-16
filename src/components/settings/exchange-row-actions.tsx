"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

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
            ? "A sync is already running for this connection."
            : `Sync failed (status ${res.status}).`);
        setSyncMessage({ tone: "err", text: msg });
      } else {
        setSyncMessage({ tone: "ok", text: "Sync queued." });
        router.refresh();
      }
    } catch (e) {
      setSyncMessage({
        tone: "err",
        text: e instanceof Error ? e.message : "Network error",
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
          body?.error?.message ?? `Delete failed (status ${res.status}).`,
        );
        setDeleting(false);
        return;
      }
      setDeleteOpen(false);
      setDeleting(false);
      router.refresh();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Network error");
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
        aria-label={`Sync ${exchangeName} now`}
      >
        {syncing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
        {syncing ? "Syncing…" : "Sync now"}
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
            aria-label={`Disconnect ${exchangeName}`}
            className="text-text-tertiary hover:text-down"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogEyebrow>Confirm disconnect</DialogEyebrow>
            <DialogTitle>Disconnect {exchangeName}?</DialogTitle>
            <DialogDescription>
              Your imported fills stay where they are. To restart imports,
              reconnect with a new key.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <ul className="space-y-1.5 font-serif text-[13px] text-text-secondary">
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                Encrypted credentials are removed from the database.
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                In-flight sync jobs will stop.
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 h-0.5 w-2 bg-text-tertiary" />
                Previously imported fills are kept for your records.
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
              Cancel
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
              {deleting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
