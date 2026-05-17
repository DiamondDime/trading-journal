"use client";

import { useT } from "@/lib/i18n/client";

/**
 * Renders an inline error banner on a wizard review page when a submit
 * attempt was redirected back with `?error=...`. Sister component to
 * WizardPreviewBanner — same visual treatment, opposite signal:
 *   - WizardPreviewBanner: "Just saved" (success, on /trades/[id] etc.)
 *   - WizardErrorBanner:   "Couldn't save" (failure, on /add/<type>/review)
 *
 * The error is URL-encoded by the server action; we just trim and surface
 * it. Long Zod-style errors get word-wrapped naturally inside the box.
 *
 * `role="alert"` implies `aria-live="assertive"` so screen readers announce
 * the banner the moment the page hydrates after the redirect.
 */
export function WizardErrorBanner({ error }: { error?: string }) {
  const t = useT();
  if (!error) return null;
  const trimmed = error.length > 600 ? `${error.slice(0, 600)}…` : error;
  return (
    <aside
      className="mb-6 rounded-md border border-down/40 bg-down/5 px-4 py-3 text-[12px] text-down"
      role="alert"
    >
      <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
        {t("wizard.shell.errorBanner.label")}
      </span>
      {" — "}
      <span className="font-serif italic">{trimmed}</span>
    </aside>
  );
}
