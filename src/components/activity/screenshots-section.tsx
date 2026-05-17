"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogEyebrow,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WizardField, WizardTextarea } from "@/components/wizard/wizard-field";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Mirror of the satellite.ts ScreenshotRow shape — but typed minimally to avoid
 * pulling server-only types into the client bundle. The server hands us a plain
 * JSON payload; we model just the fields the UI reads.
 */
export interface ScreenshotItem {
  id: string;
  side: "entry" | "exit" | "context";
  storageKey: string;
  originalWidth: number | null;
  originalHeight: number | null;
  caption: string | null;
  annotationState: unknown | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  activityId: string;
  initialScreenshots: readonly ScreenshotItem[];
}

const SIDES: ScreenshotItem["side"][] = ["entry", "exit", "context"];
const ACCEPTED_MIMES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CAPTION = 1000;

// ──────────────────────────────────────────────────────────────────────────────
// Section
// ──────────────────────────────────────────────────────────────────────────────

export function ScreenshotsSection({ activityId, initialScreenshots }: Props) {
  const t = useT();
  // Local copy of the server-rendered list — drives append after upload and
  // remove after delete without forcing a full route refresh on every edit.
  const [items, setItems] = React.useState<ScreenshotItem[]>(() => [
    ...initialScreenshots,
  ]);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [viewer, setViewer] = React.useState<ScreenshotItem | null>(null);

  // router.refresh() after mutations so any server-side cards reading from the
  // activity row (e.g. updated_at-derived "last edited" labels) reconcile.
  const router = useRouter();

  function handleUploaded(item: ScreenshotItem) {
    setItems((prev) => [...prev, item]);
    setUploadOpen(false);
    router.refresh();
  }

  function handleDeleted(id: string) {
    setItems((prev) => prev.filter((s) => s.id !== id));
    setViewer(null);
    router.refresh();
  }

  function handleAnnotated(id: string, annotationState: unknown) {
    setItems((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, annotationState, updatedAt: new Date().toISOString() } : s,
      ),
    );
    setViewer((current) =>
      current && current.id === id ? { ...current, annotationState } : current,
    );
  }

  const count = items.length;

  return (
    <>
      <div className="flex items-center justify-between">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
          aria-live="polite"
        >
          {t.plural("activity.screenshots.count", count)}
        </p>
        <UploadTrigger
          activityId={activityId}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={handleUploaded}
        />
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-border bg-inset px-4 py-8 text-center font-serif text-[14px] italic text-text-tertiary">
          {t("activity.screenshots.emptyBody")}
        </p>
      ) : (
        <ul
          className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3"
          aria-label={t("activity.screenshots.listAria")}
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setViewer(item)}
                className={cn(
                  "group flex w-full flex-col gap-2 rounded-md border border-border bg-surface p-2 text-left",
                  "transition-colors hover:border-border-strong",
                  "focus:outline-none focus:ring-1 focus:ring-text",
                )}
                aria-label={
                  item.caption
                    ? t("activity.screenshots.openAriaCaptioned", {
                        side: t(`activity.screenshots.sides.${item.side}.label`),
                        caption: item.caption,
                      })
                    : t("activity.screenshots.openAria", {
                        side: t(`activity.screenshots.sides.${item.side}.label`),
                      })
                }
              >
                <ThumbnailImage item={item} />
                {item.caption && (
                  <p className="line-clamp-2 font-serif text-[12px] italic leading-snug text-text-secondary">
                    {item.caption}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {viewer && (
        <ScreenshotViewer
          item={viewer}
          onClose={() => setViewer(null)}
          onDeleted={handleDeleted}
          onAnnotated={handleAnnotated}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Thumbnail
// ──────────────────────────────────────────────────────────────────────────────

function ThumbnailImage({ item }: { item: ScreenshotItem }) {
  const t = useT();
  const hasAnnotation = item.annotationState != null;
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-inset">
      {/* eslint-disable-next-line @next/next/no-img-element -- streamed from
          our own protected endpoint; next/image would force public optimisation. */}
      <img
        src={`/api/screenshots/${item.id}/file`}
        alt={
          item.caption ??
          t("activity.screenshots.altText", {
            side: t(`activity.screenshots.sides.${item.side}.label`),
          })
        }
        loading="lazy"
        className="h-full w-full object-cover"
        draggable={false}
      />
      <SideBadge side={item.side} className="absolute left-2 top-2" />
      {hasAnnotation && (
        <span
          aria-label={t("activity.screenshots.annotatedAria")}
          title={t("activity.screenshots.annotatedTitle")}
          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-surface text-text-secondary"
        >
          <Pencil className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

function SideBadge({
  side,
  className,
}: {
  side: ScreenshotItem["side"];
  className?: string;
}) {
  const t = useT();
  return (
    <span
      className={cn(
        "rounded-sm border border-border bg-surface/95 px-1.5 py-0.5",
        "font-mono text-[9px] uppercase tracking-[0.14em] text-text-secondary",
        "backdrop-blur-sm",
        className,
      )}
    >
      {t(`activity.screenshots.sides.${side}.label`)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Upload dialog
// ──────────────────────────────────────────────────────────────────────────────

interface UploadTriggerProps {
  activityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (item: ScreenshotItem) => void;
}

function UploadTrigger({
  activityId,
  open,
  onOpenChange,
  onUploaded,
}: UploadTriggerProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5",
            "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
            "transition-colors hover:border-border-strong hover:text-text",
            "focus:outline-none focus:ring-1 focus:ring-text",
          )}
          data-testid="add-screenshot-trigger"
        >
          <ImagePlus className="h-3 w-3" />
          {t("activity.screenshots.add")}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <UploadForm
          activityId={activityId}
          onUploaded={onUploaded}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface UploadFormProps {
  activityId: string;
  onUploaded: (item: ScreenshotItem) => void;
  onCancel: () => void;
}

function UploadForm({ activityId, onUploaded, onCancel }: UploadFormProps) {
  const t = useT();
  const fileInputId = React.useId();
  const captionId = React.useId();
  const errorId = React.useId();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [file, setFile] = React.useState<File | null>(null);
  const [side, setSide] = React.useState<ScreenshotItem["side"]>("context");
  const [caption, setCaption] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function pickFile(next: File | null) {
    setError(null);
    if (next === null) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_MIMES.includes(next.type)) {
      // The server still verifies via magic-byte sniff — the .type header is
      // advisory, but for the obvious case (.txt renamed to .png) the browser
      // typically reports the right MIME. Fall back to extension check.
      const ext = next.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "webp"].includes(ext)) {
        setError(t("activity.screenshots.errors.unsupported"));
        setFile(null);
        return;
      }
    }
    if (next.size > MAX_BYTES) {
      setError(
        t("activity.screenshots.errors.tooLarge", {
          size: (next.size / 1024 / 1024).toFixed(1),
        }),
      );
      setFile(null);
      return;
    }
    if (next.size <= 0) {
      setError(t("activity.screenshots.errors.empty"));
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("side", side);
    if (caption.trim()) form.set("caption", caption.trim().slice(0, MAX_CAPTION));

    try {
      const res = await fetch(`/api/activities/${activityId}/screenshots`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const fallback =
          res.status === 413 || res.status === 422
            ? t("activity.screenshots.errors.rejected")
            : res.status === 404
              ? t("activity.screenshots.errors.notFound")
              : t("activity.screenshots.errors.uploadFailed", { status: res.status });
        setError(json?.error?.message ?? fallback);
        setSubmitting(false);
        return;
      }
      const json = (await res.json()) as {
        data: {
          id: string;
          storage_key: string;
          original_width: number | null;
          original_height: number | null;
          side: ScreenshotItem["side"];
          caption: string | null;
        };
      };
      const data = json.data;
      onUploaded({
        id: data.id,
        side: data.side,
        storageKey: data.storage_key,
        originalWidth: data.original_width,
        originalHeight: data.original_height,
        caption: data.caption,
        annotationState: null,
        // The server didn't echo timestamps in 201; client-side seed is fine
        // (router.refresh() in the parent will reconcile from the server).
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const sizeLabel = file
    ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB`
    : null;
  const captionRemaining = MAX_CAPTION - caption.length;

  return (
    <form onSubmit={handleSubmit} aria-describedby={error ? errorId : undefined}>
      <DialogHeader>
        <DialogEyebrow>{t("activity.screenshots.attachEyebrow")}</DialogEyebrow>
        <DialogTitle>{t("activity.screenshots.add")}</DialogTitle>
        <DialogDescription>
          {t("activity.screenshots.uploadDesc")}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <WizardField
          label={t("activity.screenshots.fileLabel")}
          htmlFor={fileInputId}
          helper={sizeLabel ?? t("activity.screenshots.fileHelper")}
          required
        >
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const next = e.currentTarget.files?.[0] ?? null;
              pickFile(next);
            }}
            disabled={submitting}
            className={cn(
              "block w-full font-mono text-[12px] text-text",
              "file:mr-3 file:rounded-md file:border file:border-border file:bg-inset",
              "file:px-3 file:py-1.5 file:font-mono file:text-[10px] file:uppercase",
              "file:tracking-[0.16em] file:text-text-secondary",
              "file:transition-colors hover:file:border-border-strong hover:file:text-text",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          />
        </WizardField>

        <WizardField
          label={t("activity.screenshots.sideLabel")}
          htmlFor=""
          helper={t("activity.screenshots.sideHelper")}
          required
        >
          <div
            role="radiogroup"
            aria-label={t("activity.screenshots.sideAria")}
            className="grid grid-cols-3 gap-2"
          >
            {SIDES.map((s) => (
              <SideRadioCard
                key={s}
                value={s}
                selected={side === s}
                disabled={submitting}
                onSelect={() => setSide(s)}
              />
            ))}
          </div>
        </WizardField>

        <WizardField
          label={t("activity.screenshots.captionLabel")}
          htmlFor={captionId}
          helper={t("activity.screenshots.captionHelper", { count: captionRemaining })}
        >
          <WizardTextarea
            id={captionId}
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
            placeholder={t("activity.screenshots.captionPlaceholder")}
            rows={3}
            disabled={submitting}
            maxLength={MAX_CAPTION}
          />
        </WizardField>

        {submitting && (
          <p className="flex items-center gap-2 font-mono text-[11px] text-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("activity.screenshots.uploading")}
          </p>
        )}

        {error && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="rounded-md border border-down/30 bg-down/5 px-3 py-2 font-mono text-[11px] text-down"
          >
            {error}
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2",
            "font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary",
            "transition-colors hover:border-border-strong hover:text-text",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={!file || submitting}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-md border border-text bg-text px-4 py-2",
            "font-mono text-[11px] uppercase tracking-[0.16em] text-app",
            "transition-colors hover:bg-text/90",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
          {submitting
            ? t("activity.screenshots.uploading")
            : t("activity.screenshots.upload")}
        </button>
      </DialogFooter>
    </form>
  );
}

function SideRadioCard({
  value,
  selected,
  disabled,
  onSelect,
}: {
  value: ScreenshotItem["side"];
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors",
        "font-mono text-[10px] uppercase tracking-[0.16em]",
        "focus:outline-none focus:ring-1 focus:ring-text",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-text bg-subtle text-text"
          : "border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text",
      )}
    >
      <span>
        {value === "entry"
          ? t("activity.screenshots.sides.entry.label")
          : value === "exit"
            ? t("activity.screenshots.sides.exit.label")
            : t("activity.screenshots.sides.context.label")}
      </span>
      <span className="font-serif text-[10px] italic normal-case tracking-normal text-text-tertiary">
        {value === "entry"
          ? t("activity.screenshots.sides.entry.caption")
          : value === "exit"
            ? t("activity.screenshots.sides.exit.caption")
            : t("activity.screenshots.sides.context.caption")}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Viewer + annotation
// ──────────────────────────────────────────────────────────────────────────────

interface ViewerProps {
  item: ScreenshotItem;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onAnnotated: (id: string, annotationState: unknown) => void;
}

function ScreenshotViewer({
  item,
  onClose,
  onDeleted,
  onAnnotated,
}: ViewerProps) {
  const t = useT();
  // `mode` controls which child renders inside the viewer. View mode shows a
  // static <img>; annotate mode swaps it for a container where MarkerJS2 takes
  // over. The image element ref is shared across modes — MarkerJS2 needs a
  // real, loaded <img> in the DOM at the moment it's instantiated.
  const [mode, setMode] = React.useState<"view" | "annotate">("view");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deletePending, setDeletePending] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  function handleDialogChange(next: boolean) {
    if (!next) onClose();
  }

  async function handleDeleteConfirm() {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/screenshots/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setDeleteError(
          json?.error?.message ??
            t("activity.screenshots.errors.deleteFailed", { status: res.status }),
        );
        setDeletePending(false);
        return;
      }
      onDeleted(item.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeletePending(false);
    }
  }

  return (
    <Dialog open onOpenChange={handleDialogChange}>
      <DialogContent className="sm:max-w-4xl" hideCloseButton>
        <DialogHeader>
          <DialogEyebrow>
            {t("activity.screenshots.viewerEyebrow", {
              date: new Date(item.createdAt).toLocaleDateString(t.locale === "ru" ? "ru-RU" : "en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
            })}
          </DialogEyebrow>
          <DialogTitle>
            {item.caption ??
              t("activity.screenshots.viewerDefaultTitle", {
                // Use the localized side label rather than the raw English
                // token. With Russian locale, "Entry/Exit/Context" leaked
                // into the dialog title.
                side: t(`activity.screenshots.sides.${item.side}.label`),
              })}
          </DialogTitle>
          <DialogDescription>
            <span className="inline-flex items-center gap-2">
              <SideBadge side={item.side} />
              {item.originalWidth && item.originalHeight && (
                <span className="font-mono text-[10px] tracking-[0.14em] text-text-tertiary">
                  {item.originalWidth} × {item.originalHeight}
                </span>
              )}
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {mode === "view" ? (
            <ViewerImage
              src={`/api/screenshots/${item.id}/file`}
              alt={
                item.caption ??
                t("activity.screenshots.altText", {
                  side: t(`activity.screenshots.sides.${item.side}.label`),
                })
              }
            />
          ) : (
            <Annotator
              key={item.id}
              src={`/api/screenshots/${item.id}/file`}
              alt={
                item.caption ??
                t("activity.screenshots.altText", {
                  side: t(`activity.screenshots.sides.${item.side}.label`),
                })
              }
              initialState={item.annotationState}
              onSaved={async (state) => {
                // PATCH /api/screenshots/[id] with the new annotation_state.
                // We persist on every "OK" press (the render event); cancel
                // exits without saving.
                try {
                  const res = await fetch(`/api/screenshots/${item.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ annotation_state: state }),
                  });
                  if (res.ok) {
                    onAnnotated(item.id, state);
                  }
                } catch {
                  // Soft-fail — the user can re-annotate. We don't surface a
                  // toast here because the MarkerJS2 UI is already dismissing.
                }
                setMode("view");
              }}
              onCancelled={() => setMode("view")}
            />
          )}

          {item.caption && mode === "view" && (
            <p className="rounded-md border border-border bg-inset px-4 py-3 font-serif text-[14px] italic leading-relaxed text-text-secondary">
              {item.caption}
            </p>
          )}

          {confirmDelete && (
            <div className="rounded-md border border-down/30 bg-down/5 p-3">
              <p className="font-serif text-[13px] italic text-text-secondary">
                {t("activity.screenshots.viewerConfirmDelete")}
              </p>
              {deleteError && (
                <p
                  role="alert"
                  className="mt-2 font-mono text-[11px] text-down"
                >
                  {deleteError}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError(null);
                  }}
                  disabled={deletePending}
                  className={cn(
                    "inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5",
                    "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
                    "transition-colors hover:border-border-strong hover:text-text",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirm}
                  disabled={deletePending}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-md border border-down bg-down px-3 py-1.5",
                    "font-mono text-[10px] uppercase tracking-[0.16em] text-app",
                    "transition-colors hover:bg-down/90",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {deletePending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {deletePending
                    ? t("activity.screenshots.deleting")
                    : t("activity.screenshots.deleteCta")}
                </button>
              </div>
            </div>
          )}
        </DialogBody>

        {mode === "view" && (
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete((v) => !v)}
              disabled={mode !== "view"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5",
                "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
                "transition-colors hover:border-down hover:text-down focus:outline-none focus:ring-1 focus:ring-down",
              )}
            >
              <Trash2 className="h-3 w-3" />
              {t("common.delete")}
            </button>
            <button
              type="button"
              onClick={() => setMode("annotate")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5",
                "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
                "transition-colors hover:border-border-strong hover:text-text",
              )}
            >
              <Pencil className="h-3 w-3" />
              {item.annotationState
                ? t("activity.screenshots.editAnnotations")
                : t("activity.screenshots.annotate")}
            </button>
            <DialogClose asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center justify-center rounded-md border border-text bg-text px-4 py-1.5",
                  "font-mono text-[10px] uppercase tracking-[0.16em] text-app",
                  "transition-colors hover:bg-text/90",
                )}
              >
                {t("common.close")}
              </button>
            </DialogClose>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ViewerImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex max-h-[70vh] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-inset">
      {/* eslint-disable-next-line @next/next/no-img-element -- streamed bytes. */}
      <img
        src={src}
        alt={alt}
        className="max-h-[70vh] w-auto object-contain"
        draggable={false}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Annotator (MarkerJS2 wrapper)
//
// MarkerJS2 is a vanilla DOM library that mounts its own UI as a sibling of the
// target image. We render a single <img> with a stable ref, instantiate the
// MarkerArea once on mount, optionally restoreState if we have prior markers,
// then show() — which docks the toolbar / toolbox over the image.
//
// On 'render' (user clicks OK in the MarkerJS2 toolbar), we capture
// event.state (the JSON descriptor) and bubble it up via onSaved. We don't
// persist the rendered dataURL — the base image on disk stays canonical.
//
// On 'close' (user clicks cancel), we bubble onCancelled with no state.
//
// State restoration timing: per MarkerJS2 docs, restoreState() MUST be called
// AFTER show(). The `restorestate` event fires after the restore completes;
// we don't rely on it because show() is synchronous and restoreState() is
// safe to call immediately after.
// ──────────────────────────────────────────────────────────────────────────────

interface AnnotatorProps {
  src: string;
  alt: string;
  initialState: unknown | null;
  onSaved: (state: unknown) => Promise<void> | void;
  onCancelled: () => void;
}

function Annotator({
  src,
  alt,
  initialState,
  onSaved,
  onCancelled,
}: AnnotatorProps) {
  const t = useT();
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const markerAreaRef = React.useRef<unknown | null>(null);
  const [imgLoaded, setImgLoaded] = React.useState(false);
  const [moduleFailed, setModuleFailed] = React.useState(false);
  const [shown, setShown] = React.useState(false);

  // Cache callbacks to keep effect deps stable; otherwise prop-identity changes
  // would tear down + re-instantiate MarkerJS2 on every parent render.
  const onSavedRef = React.useRef(onSaved);
  const onCancelledRef = React.useRef(onCancelled);
  React.useEffect(() => {
    onSavedRef.current = onSaved;
    onCancelledRef.current = onCancelled;
  });

  React.useEffect(() => {
    if (!imgLoaded) return;
    const imgEl = imgRef.current;
    if (!imgEl) return;

    let cancelled = false;
    let area: { close: () => void } | null = null;

    (async () => {
      let mod: typeof import("markerjs2");
      try {
        mod = await import("markerjs2");
      } catch (e) {
        // Bundling or CDN failure — fall through to "Annotation unavailable".
        console.error("Failed to load markerjs2", e);
        if (!cancelled) setModuleFailed(true);
        return;
      }
      if (cancelled) return;

      const markerArea = new mod.MarkerArea(imgEl);
      markerAreaRef.current = markerArea;

      // Renders into the same containing element as our <img>, so MarkerJS2 UI
      // stays inside the dialog overlay instead of jumping to document.body.
      // This is essential — without it, the toolbox is positioned behind the
      // backdrop and the user can't interact.
      const root = imgEl.closest<HTMLElement>("[data-markerjs-root]");
      if (root) markerArea.targetRoot = root;

      // Render at the original (natural) image resolution so any markers stay
      // crisp regardless of the on-screen scale. We don't actually use the
      // rendered dataURL — we only need state — but this future-proofs export.
      markerArea.renderAtNaturalSize = true;

      markerArea.addEventListener("render", (event) => {
        // event.state is the canonical JSON descriptor we persist. The
        // event.dataUrl is the rendered raster; we discard it because the
        // base image on disk is the source of truth.
        void onSavedRef.current(event.state);
      });

      markerArea.addEventListener("close", () => {
        onCancelledRef.current();
      });

      markerArea.show();

      // restoreState MUST follow show() (docs line 1306 of the .d.ts).
      // Wrap in a guard so a malformed legacy state doesn't crash the editor.
      if (initialState != null) {
        try {
          markerArea.restoreState(initialState as Parameters<typeof markerArea.restoreState>[0]);
        } catch (e) {
          console.warn("Failed to restore annotation state", e);
        }
      }

      area = markerArea;
      if (!cancelled) setShown(true);
    })();

    return () => {
      cancelled = true;
      // Defensive close — if the user dismisses the dialog while annotating
      // the React tree unmounts but the MarkerJS2 DOM (mounted on
      // targetRoot) would otherwise linger.
      try {
        area?.close();
      } catch {
        // already closed
      }
      markerAreaRef.current = null;
    };
    // initialState is intentionally read once at mount — toggling annotate
    // mode reuses the latest from props through Annotator's `key={item.id}`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgLoaded]);

  if (moduleFailed) {
    return (
      <div
        data-markerjs-root
        className="flex flex-col items-center gap-3 rounded-md border border-border bg-inset px-4 py-6 text-center"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="max-h-[60vh] w-auto object-contain"
        />
        <p className="font-serif text-[12px] italic text-text-tertiary">
          {t("activity.screenshots.annotatorUnavailable")}
        </p>
        <button
          type="button"
          onClick={onCancelled}
          className={cn(
            "inline-flex items-center justify-center rounded-md border border-border bg-surface px-3 py-1.5",
            "font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary",
            "transition-colors hover:border-border-strong hover:text-text",
          )}
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <div
      data-markerjs-root
      className="relative flex max-h-[70vh] w-full items-center justify-center overflow-hidden rounded-md border border-border bg-inset"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- streamed bytes;
          MarkerJS2 needs a real <img> reference to attach. */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setImgLoaded(true)}
        className="max-h-[70vh] w-auto object-contain"
        draggable={false}
      />
      {!shown && !moduleFailed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface/40 backdrop-blur-[1px]">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("activity.screenshots.loadingAnnotator")}
          </span>
        </div>
      )}
    </div>
  );
}
