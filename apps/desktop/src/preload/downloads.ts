import { contextBridge, ipcRenderer } from "electron";

import type {
  BrowserDownload,
  DesktopDownloads,
} from "@staaash/config/desktop-downloads";

if (process.isMainFrame) {
  const api: DesktopDownloads = {
    getState: () => ipcRenderer.invoke("downloads:state"),
    onState: (listener) => {
      const handler = (_event: unknown, downloads: BrowserDownload[]) =>
        listener(downloads);
      ipcRenderer.on("downloads:changed", handler);
      return () => ipcRenderer.off("downloads:changed", handler);
    },
    cancel: (id) => ipcRenderer.invoke("downloads:cancel", id),
    resume: (id) => ipcRenderer.invoke("downloads:resume", id),
    reveal: (id) => ipcRenderer.invoke("downloads:reveal", id),
    clearFinished: () => ipcRenderer.invoke("downloads:clear"),
  };
  contextBridge.exposeInMainWorld("staaashDownloads", api);
}
