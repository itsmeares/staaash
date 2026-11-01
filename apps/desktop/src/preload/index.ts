import { contextBridge, ipcRenderer } from "electron";

import type { AppState, DesktopApi } from "../shared/types";

/** Each call is one IPC message the main process answers. */
const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api: DesktopApi = {
  getState: call("get-state") as DesktopApi["getState"],
  onState: (listener) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.off("state", handler);
  },
  connect: call("connect") as DesktopApi["connect"],
  refreshProfile: call("refresh-profile") as DesktopApi["refreshProfile"],
  serverFolders: call("server-folders") as DesktopApi["serverFolders"],
  chooseFolder: call("choose-folder") as DesktopApi["chooseFolder"],
  folderWarning: call("folder-warning") as DesktopApi["folderWarning"],
  createServerFolder: call(
    "create-server-folder",
  ) as DesktopApi["createServerFolder"],
  savePairs: call("save-pairs") as DesktopApi["savePairs"],
  updateSettings: call("update-settings") as DesktopApi["updateSettings"],
  pause: call("pause") as DesktopApi["pause"],
  openStaaash: call("open-staaash") as DesktopApi["openStaaash"],
  openFolder: call("open-folder") as DesktopApi["openFolder"],
  openSyncLog: call("open-sync-log") as DesktopApi["openSyncLog"],
  resolveConflict: call("resolve-conflict") as DesktopApi["resolveConflict"],
  resolvePair: call("resolve-pair") as DesktopApi["resolvePair"],
  takeCommand: call("take-command") as DesktopApi["takeCommand"],
  onCommand: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("command", handler);
    return () => ipcRenderer.removeListener("command", handler);
  },
  installUpdate: call("install-update") as DesktopApi["installUpdate"],
  signOut: call("sign-out") as DesktopApi["signOut"],
  quit: call("quit") as DesktopApi["quit"],
};

contextBridge.exposeInMainWorld("staaash", api);
