import path from "node:path";
import { app, Menu, nativeImage, nativeTheme, Tray } from "electron";

import { statusLine } from "../shared/status";
import type { AppState } from "../shared/types";

type TrayIcon = "idle" | "syncing" | "paused" | "attention" | "offline";

export type TrayActions = {
  openPanel: (bounds: Electron.Rectangle) => void;
  openStaaash: () => void;
  openFolder: (pairId: string) => void;
  pause: (minutes: number | null) => void;
  openSettings: () => void;
  installUpdate: () => void;
  quit: () => void;
};

const iconDir = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "tray")
    : path.join(__dirname, "../../resources/tray");

// One icon per state.
// fallow-ignore-next-line complexity
const iconFor = (state: AppState): TrayIcon => {
  const status = state.status;
  if (!state.signedIn || state.versionProblem) return "attention";
  if (status?.state === "paused") return "paused";
  if (status?.state === "offline") return "offline";
  if (status?.state === "syncing" || status?.state === "starting")
    return "syncing";
  if (status?.conflicts.length || status?.issues.length) return "attention";
  return "idle";
};

const image = (icon: TrayIcon) => {
  // macOS tints "Template" images for light and dark menu bars itself.
  const file =
    process.platform === "darwin"
      ? `${icon}Template.png`
      : `${icon}-${nativeTheme.shouldUseDarkColors ? "light" : "dark"}.png`;
  return nativeImage.createFromPath(path.join(iconDir(), file));
};

/**
 * Left-click opens the activity panel, right-click the menu. Linux trays
 * often ignore left-clicks, so there the menu opens on any click and has a
 * "Show activity" item instead.
 */
export const createTray = (actions: TrayActions) => {
  let state: AppState | null = null;
  const tray = new Tray(image("syncing"));
  tray.setToolTip("Staaash");

  // Menu items depend on sign-in, pause, pairs and updates.
  // fallow-ignore-next-line complexity
  const menu = () => {
    const current = state;
    const paused = current?.status?.state === "paused";
    const pairs = current?.settings.pairs ?? [];
    return Menu.buildFromTemplate([
      { label: current ? statusLine(current) : "Starting…", enabled: false },
      { type: "separator" },
      {
        label: "Open Staaash",
        enabled: Boolean(current?.signedIn),
        click: actions.openStaaash,
      },
      {
        label: "Open synced folder",
        enabled: pairs.length > 0,
        submenu: pairs.map((pair) => ({
          label: path.basename(pair.localPath) || pair.localPath,
          click: () => actions.openFolder(pair.id),
        })),
      },
      ...(process.platform === "linux"
        ? [
            {
              label: "Show activity",
              click: () => actions.openPanel(tray.getBounds()),
            },
          ]
        : []),
      paused
        ? { label: "Resume syncing", click: () => actions.pause(null) }
        : {
            label: "Pause syncing",
            enabled: Boolean(current?.signedIn),
            submenu: [
              { label: "For 30 minutes", click: () => actions.pause(30) },
              { label: "For 2 hours", click: () => actions.pause(120) },
              { label: "Until I resume", click: () => actions.pause(0) },
            ],
          },
      { type: "separator" },
      ...(current?.update?.ready
        ? [
            {
              label: current.update.manual
                ? `Download version ${current.update.version}`
                : `Restart to update to ${current.update.version}`,
              click: actions.installUpdate,
            },
          ]
        : []),
      { label: "Settings…", click: actions.openSettings },
      { label: "Quit Staaash", click: actions.quit },
    ]);
  };

  if (process.platform === "linux") {
    tray.setContextMenu(menu());
  } else {
    tray.on("click", () => actions.openPanel(tray.getBounds()));
    tray.on("right-click", () => tray.popUpContextMenu(menu()));
  }

  let shownIcon: TrayIcon | null = null;
  let shownLine = "";
  const refresh = (next: AppState | null = state) => {
    state = next;
    if (!state) return;
    const icon = iconFor(state);
    if (icon !== shownIcon) {
      tray.setImage(image(icon));
      shownIcon = icon;
    }
    const line = statusLine(state);
    if (line !== shownLine) {
      shownLine = line;
      tray.setToolTip(`Staaash · ${line}`);
      // A Linux menu is a snapshot; rebuild it when its contents change.
      if (process.platform === "linux") tray.setContextMenu(menu());
    }
  };
  nativeTheme.on("updated", () => {
    shownIcon = null;
    refresh();
  });
  return {
    update: (next: AppState) => refresh(next),
    /** Settings changes that alter the menu but not the status line. */
    rebuild: () => {
      if (process.platform === "linux") tray.setContextMenu(menu());
    },
  };
};
