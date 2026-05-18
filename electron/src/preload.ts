/**
 * Preload script for Journal.
 *
 * Runs in the renderer process **with Node integration disabled** but before
 * any web content executes. The only thing we expose to `window` is a thin,
 * typed bridge over `ipcRenderer.invoke`. Keep this surface minimal — every
 * method here is a potential pivot for compromised renderer code, so we only
 * add things the UI actively needs.
 *
 * Whoever extends this file: ALL handlers must validate inputs main-side too
 * (see `ipcMain.handle('app:openExternal', ...)` in main.ts).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface JournalBridge {
  /** App version from package.json. Used in About / settings footer. */
  getAppVersion: () => Promise<string>;
  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url: string) => Promise<boolean>;
}

const bridge: JournalBridge = {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,
  openExternal: (url: string) =>
    ipcRenderer.invoke('app:openExternal', url) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('journal', bridge);

// ============================================================================
// Auto-update bridge (owned by auto-update agent)
// ----------------------------------------------------------------------------
// Channel names mirror `electron/src/auto-update.ts`. Kept inline because the
// preload is bundled separately from the main process and doesn't share TS
// imports outside of `electron` itself (asar + CJS limitations).
// ============================================================================
const UPDATE_AVAILABLE_CHANNEL = 'update:available';
const UPDATE_INSTALL_CHANNEL = 'update:install';

export interface UpdateAvailablePayload {
  version: string;
  releaseNotes?: string;
}

export interface ElectronAPI {
  /** Bundled app version (synchronous read of package.json env). */
  appVersion: string;
  /**
   * Subscribe to "update downloaded" events from the main process.
   * Returns an unsubscribe function — call it on component unmount.
   */
  onUpdateAvailable: (
    handler: (payload: UpdateAvailablePayload) => void,
  ) => () => void;
  /**
   * Ask main process to quit & install the pending update.
   * The app will relaunch automatically — the promise typically does not
   * resolve in the renderer because the renderer process is destroyed.
   */
  installUpdate: () => Promise<void>;
}

const electronAPI: ElectronAPI = {
  appVersion: process.env.npm_package_version ?? '0.0.0',
  onUpdateAvailable(handler) {
    const wrapped = (_e: IpcRendererEvent, payload: UpdateAvailablePayload) => {
      handler(payload);
    };
    ipcRenderer.on(UPDATE_AVAILABLE_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(UPDATE_AVAILABLE_CHANNEL, wrapped);
    };
  },
  installUpdate() {
    return ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
