import { spawn } from "node:child_process";
import path from "node:path";
import { app, Menu, nativeImage, nativeTheme, Tray } from "electron";

import { PAUSE_CHOICES } from "../shared/pause";
import { statusLine } from "../shared/status";
import type { AppState } from "../shared/types";

type TrayIcon = "idle" | "syncing" | "paused" | "attention" | "offline";

export type TrayActions = {
  openWindow: () => void;
  customPause: () => void;
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
  if (!state.signedIn || state.versionProblem || status?.state === "problem")
    return "attention";
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
 * Electron looks for a tray bar once, when the icon is created, and never again
 * if none is running yet. Startup order is not fixed on Wayland desktops, so
 * wait for the bar to appear. Once registered, the icon survives bar restarts.
 */
const whenTrayBarStarts = (then: () => void) => {
  const watch = spawn(
    "gdbus",
    ["monitor", "--session", "--dest", "org.kde.StatusNotifierWatcher"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  // Without gdbus the icon only misses a bar that starts after the app.
  watch.on("error", () => {});
  let missing = false;
  watch.stdout.setEncoding("utf8").on("data", (lines: string) => {
    if (lines.includes("does not have an owner")) missing = true;
    if (!missing && lines.includes("is owned by")) watch.kill();
    // The name appears before the bar can take icons; this signal comes after.
    if (missing && lines.includes("StatusNotifierHostRegistered")) {
      watch.kill();
      then();
    }
  });
  app.once("will-quit", () => watch.kill());
};

/**
 * Left-click opens the window, right-click the menu. Some Linux trays only
 * ever show the menu, so it has "Open Staaash" too.
 */
export const createTray = (actions: TrayActions) => {
  let state: AppState | null = null;
  let tray = new Tray(image("syncing"));
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
      { label: "Open Staaash", click: actions.openWindow },
      {
        label: "Open drive",
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
      paused
        ? { label: "Resume syncing", click: () => actions.pause(null) }
        : {
            label: "Pause syncing",
            enabled: Boolean(current?.signedIn),
            submenu: [
              ...PAUSE_CHOICES.map(({ label, minutes }) => ({
                label,
                click: () => actions.pause(minutes),
              })),
              { label: "Custom…", click: actions.customPause },
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

  tray.on("click", actions.openWindow);
  if (process.platform === "linux") {
    tray.setContextMenu(menu());
    whenTrayBarStarts(() => {
      tray.destroy();
      tray = new Tray(image(shownIcon ?? "syncing"));
      tray.setToolTip(shownLine ? `Staaash · ${shownLine}` : "Staaash");
      tray.setContextMenu(menu());
      tray.on("click", actions.openWindow);
    });
  } else {
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
