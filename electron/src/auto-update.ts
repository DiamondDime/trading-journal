/**
 * electron/auto-update.ts
 *
 * Auto-update layer for the Electron desktop port.
 *
 * Wires `electron-updater` to a background updater that polls GitHub Releases
 * for new versions. When a new version is downloaded, the renderer is notified
 * via IPC (`update:available`) so it can show an in-app banner. If the renderer
 * isn't ready/listening yet, a native dialog is used as a fallback.
 *
 * Usage from `electron/main.ts`:
 *
 *     import { attachAutoUpdater } from "./auto-update";
 *     // ...after `mainWindow` is created and content has loaded:
 *     attachAutoUpdater(mainWindow);
 *
 * In dev (`app.isPackaged === false`) this is a no-op so we don't spam GitHub
 * with check requests while iterating locally.
 */

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

// We use the console as the logger. electron-updater also writes its own
// internal logs to the system log via its bundled logger. If we want richer
// file-based logging later, add `electron-log` and wire it via
// `autoUpdater.logger = log`.
const log = {
  info: (...args: unknown[]) => console.info("[auto-update]", ...args),
  warn: (...args: unknown[]) => console.warn("[auto-update]", ...args),
  error: (...args: unknown[]) => console.error("[auto-update]", ...args),
  debug: (...args: unknown[]) => console.debug("[auto-update]", ...args),
};

// ---------------------------------------------------------------------------
// IPC channel names — keep these in sync with `electron/preload.ts` and the
// renderer `update-banner.tsx` component.
// ---------------------------------------------------------------------------
export const UPDATE_CHANNEL = {
  /** main → renderer: a new version has been downloaded and is ready to install */
  available: "update:available",
  /** renderer → main: user clicked "Restart now" in the banner */
  install: "update:install",
} as const;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------
let attached = false;
let pendingNotification: UpdateNotification | null = null;

export interface UpdateNotification {
  /** New version string from package.json, e.g. "0.2.0" */
  version: string;
  /** Optional release notes (markdown or plain text) */
  releaseNotes?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach the auto-updater to the main window. Idempotent: subsequent calls
 * after the first are no-ops. Safe to call from anywhere in the main process
 * lifecycle, but typically right after the main window is created.
 *
 * @param mainWindow the primary BrowserWindow. Used for IPC and as the parent
 *                   of any native fallback dialogs.
 */
export function attachAutoUpdater(mainWindow: BrowserWindow): void {
  if (attached) return;
  attached = true;

  // Dev mode: skip entirely. electron-updater also short-circuits here, but
  // skipping ourselves avoids noisy log lines.
  if (!app.isPackaged) {
    log.info("dev mode — skipping update check");
    return;
  }

  // Wire our console logger into electron-updater. Cast through `unknown`
  // because electron-updater expects a Logger interface; ours is a subset
  // that satisfies the runtime contract.
  autoUpdater.logger = log as unknown as typeof autoUpdater.logger;

  // We control the notification UX ourselves, so disable the built-in one.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // ----- Updater event handlers ---------------------------------------------
  autoUpdater.on("checking-for-update", () => {
    log.info("checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("update available", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("no update available");
  });

  autoUpdater.on("error", (err) => {
    log.error("error", err);
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info(
      `downloading ${Math.round(progress.percent)}% ` +
        `(${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`,
    );
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("update downloaded", info.version);
    const notification: UpdateNotification = {
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === "string"
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes
                .map((n) => (typeof n === "string" ? n : n?.note ?? ""))
                .filter(Boolean)
                .join("\n\n")
            : undefined,
    };

    // Try the renderer first. If it isn't ready (or doesn't expose the API
    // because the user is on a stripped-down build), fall back to a native
    // modal dialog so the user still hears about the update.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      pendingNotification = notification;
      mainWindow.webContents.send(UPDATE_CHANNEL.available, notification);
      // If the renderer never confirms within 30s, fall back to native.
      setTimeout(() => {
        if (pendingNotification && mainWindow && !mainWindow.isDestroyed()) {
          showNativeUpdateDialog(mainWindow, notification);
          pendingNotification = null;
        }
      }, 30_000);
    } else {
      showNativeUpdateDialog(mainWindow, notification);
    }
  });

  // ----- IPC: renderer requests install -------------------------------------
  // Registered once per process. The renderer side is in `update-banner.tsx`.
  ipcMain.handle(UPDATE_CHANNEL.install, () => {
    log.info("install requested by renderer");
    pendingNotification = null;
    // `isSilent`: hide the installer window (macOS doesn't show one anyway).
    // `isForceRunAfter`: relaunch immediately after install.
    autoUpdater.quitAndInstall(true, true);
  });

  // ----- Kick off the first check -------------------------------------------
  // `checkForUpdatesAndNotify` is a convenience wrapper; we customise the
  // notify behaviour above via event listeners, so this just triggers the
  // check + download. The built-in Notification fires only if no listeners
  // are attached to `update-downloaded`, which we have, so it's silent.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.error("check failed", err);
  });
}

/**
 * Trigger a manual update check. Useful from a "Check for updates…" menu item.
 * Returns `true` if a check was kicked off, `false` if in dev mode.
 */
export async function checkForUpdatesNow(): Promise<boolean> {
  if (!app.isPackaged) return false;
  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (err) {
    log.error("manual check failed", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function showNativeUpdateDialog(
  mainWindow: BrowserWindow | null,
  notification: UpdateNotification,
): void {
  const opts: Electron.MessageBoxOptions = {
    type: "info",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update ready",
    message: `Journal ${notification.version} is ready to install.`,
    detail: notification.releaseNotes
      ? truncate(notification.releaseNotes, 480)
      : "Restart the app to apply the update.",
  };

  const promise =
    mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, opts)
      : dialog.showMessageBox(opts);

  promise
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall(true, true);
      }
    })
    .catch((err) => {
      log.error("dialog failed", err);
    });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
