/**
 * src/types/electron.d.ts
 *
 * Renderer-side ambient types for the bridge exposed by `electron/preload.ts`.
 *
 * The webapp build still compiles against this file because the import is
 * type-only — `window.electronAPI` is `undefined` at runtime in the browser,
 * and consumers must gate on its presence:
 *
 *     if (typeof window !== "undefined" && window.electronAPI) {
 *       // desktop mode
 *     }
 */

export interface UpdateAvailablePayload {
  version: string;
  releaseNotes?: string;
}

export interface ElectronAPI {
  /** Bundled app version, sourced from package.json. */
  appVersion: string;

  /**
   * Subscribe to "update downloaded" events from the main process.
   * Returns an unsubscribe function.
   */
  onUpdateAvailable(
    handler: (payload: UpdateAvailablePayload) => void,
  ): () => void;

  /**
   * Request the main process to quit & install the pending update.
   * The app will relaunch automatically.
   */
  installUpdate(): Promise<void>;
}

declare global {
  interface Window {
    /** Present only when running inside the Electron shell. */
    electronAPI?: ElectronAPI;
  }
}
