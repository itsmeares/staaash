import path from "node:path";
import {
  BrowserWindow,
  nativeTheme,
  screen,
  shell,
  type Rectangle,
} from "electron";

const PRELOAD = path.join(__dirname, "../preload/index.cjs");
const PAGE = path.join(__dirname, "../renderer/index.html");

const background = () =>
  // The app's dark and light canvas, so a window never flashes white.
  nativeTheme.shouldUseDarkColors ? "#151413" : "#f6f5f3";

const local = (options: Electron.BrowserWindowConstructorOptions) =>
  new BrowserWindow({
    show: false,
    backgroundColor: background(),
    ...options,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

/** Links in the app's own pages open in the browser. */
const keepInside = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
};

let settingsWindow: BrowserWindow | null = null;
let panel: BrowserWindow | null = null;
let appWindow: BrowserWindow | null = null;
let panelClosedAt = 0;

export const openSettingsWindow = () => {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  const window = local({
    width: 760,
    height: 600,
    minWidth: 560,
    minHeight: 480,
    title: "Staaash",
    autoHideMenuBar: true,
  });
  settingsWindow = window;
  keepInside(window);
  window.on("closed", () => (settingsWindow = null));
  window.once("ready-to-show", () => window.show());
  void window.loadFile(PAGE, { hash: "settings" });
};

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;

/** Next to the tray icon, inside the screen the icon is on. */
const panelPosition = (tray: Rectangle) => {
  const area = screen.getDisplayMatching(tray).workArea;
  const x = Math.round(
    Math.min(
      Math.max(tray.x + tray.width / 2 - PANEL_WIDTH / 2, area.x + 8),
      area.x + area.width - PANEL_WIDTH - 8,
    ),
  );
  const below = tray.y < area.y + area.height / 2;
  const y = below ? tray.y + tray.height + 6 : tray.y - PANEL_HEIGHT - 6;
  return {
    x,
    y: Math.min(
      Math.max(y, area.y + 8),
      area.y + area.height - PANEL_HEIGHT - 8,
    ),
  };
};

/**
 * The activity panel from the tray. It is destroyed when it loses focus, so
 * it costs no memory while closed.
 */
export const togglePanel = (trayBounds: Rectangle) => {
  if (panel) {
    panel.close();
    return;
  }
  // Clicking the tray icon blurs the open panel first; that click closes it.
  if (Date.now() - panelClosedAt < 300) return;
  const window = local({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    ...panelPosition(trayBounds),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });
  panel = window;
  keepInside(window);
  window.on("blur", () => window.close());
  window.on("closed", () => {
    panelClosedAt = Date.now();
    if (panel === window) panel = null;
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  void window.loadFile(PAGE, { hash: "panel" });
};

export const closePanel = () => panel?.close();

/**
 * The web app in its own window, signed in through a one-time link. Only the
 * server's own pages load here; everything else opens in the browser.
 */
export const openAppWindow = async (
  serverUrl: string,
  signedInUrl: () => Promise<string>,
) => {
  if (appWindow) {
    appWindow.show();
    appWindow.focus();
    return;
  }
  const origin = new URL(serverUrl).origin;
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 400,
    minHeight: 500,
    title: "Staaash",
    show: false,
    backgroundColor: background(),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  appWindow = window;
  window.on("closed", () => (appWindow = null));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== origin) void shell.openExternal(url);
    else void window.loadURL(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  window.once("ready-to-show", () => window.show());
  try {
    await window.loadURL(await signedInUrl());
  } catch (error) {
    window.destroy();
    throw error;
  }
};

/** Every window that shows the app's own pages, for state updates. */
export const localWindows = () =>
  [settingsWindow, panel].filter(
    (window): window is BrowserWindow =>
      window !== null && !window.isDestroyed(),
  );
