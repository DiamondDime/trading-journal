"use client";

/**
 * src/components/desktop/update-banner.tsx
 *
 * Sticky banner that appears when the Electron auto-updater has downloaded
 * a new version. Tapping "Restart now" triggers `electronAPI.installUpdate()`,
 * which calls `autoUpdater.quitAndInstall()` in the main process — the app
 * quits and relaunches on the new version.
 *
 * In webapp mode (`window.electronAPI === undefined`) this is a no-op: the
 * effect bails out before subscribing and the component returns `null`. Safe
 * to mount unconditionally from the root layout.
 */

import { useEffect, useState } from "react";
import type { UpdateAvailablePayload } from "@/types/electron";
import { useT } from "@/lib/i18n/client";

export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<UpdateAvailablePayload | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Gate on `window.electronAPI` — undefined in webapp mode.
    if (typeof window === "undefined") return;
    const api = window.electronAPI;
    if (!api) return;

    const unsubscribe = api.onUpdateAvailable((payload) => {
      setUpdate(payload);
    });
    return unsubscribe;
  }, []);

  if (!update) return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      // Returns after main process initiates quit. The window will be
      // destroyed before this promise resolves in practice.
      await window.electronAPI?.installUpdate();
    } catch {
      // If install somehow fails, allow retry.
      setInstalling(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 border-b border-signature/40 bg-signature-bg text-text"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5">
        <div className="flex items-center gap-3 text-sm">
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full bg-signature"
          />
          <span className="font-serif italic">
            {t("desktop.updateBanner.ready")}
          </span>
          <span className="text-text-tertiary">·</span>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-secondary">
            v{update.version}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUpdate(null)}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-text-tertiary transition-colors hover:bg-subtle hover:text-text"
          >
            {t("desktop.updateBanner.later")}
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="rounded-md bg-signature px-3 py-1 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {installing ? t("desktop.updateBanner.restarting") : t("desktop.updateBanner.restartNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
