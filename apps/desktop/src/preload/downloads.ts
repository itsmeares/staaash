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

  // The window's top row and buttons follow the drive's own theme, which the
  // account picks, so they never split from the page below.
  window.addEventListener("DOMContentLoaded", () => {
    const root = document.documentElement;
    let reported: boolean | null = null;
    const report = () => {
      const dark = root.classList.contains("dark");
      if (dark === reported) return;
      reported = dark;
      ipcRenderer.send("drive-theme", dark);
    };
    new MutationObserver(report).observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
    report();
  });
}
