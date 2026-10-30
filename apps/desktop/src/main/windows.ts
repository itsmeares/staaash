import path from "node:path";
import { BrowserWindow, nativeTheme, shell } from "electron";

import type { WindowCommand } from "../shared/types";

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

// Hidden windows on Wayland often never get "ready-to-show", so wait for the
// load instead. The background colour already covers the empty page.
const showWhenLoaded = (window: BrowserWindow) =>
  window.webContents.once("did-finish-load", () => {
    window.show();
    window.focus();
  });

/** Links in the app's own pages open in the browser. */
const keepInside = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
};

let mainWindow: BrowserWindow | null = null;
let appWindow: BrowserWindow | null = null;
let command: WindowCommand | null = null;

/** Shows the one Staaash window, asking it to show `next` when given. */
export const openMainWindow = (next?: WindowCommand) => {
  if (next) command = next;
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    if (next) mainWindow.webContents.send("command");
    return;
  }
  const window = local({
    width: 860,
    height: 640,
    minWidth: 400,
    minHeight: 480,
    title: "Staaash",
    autoHideMenuBar: true,
  });
  mainWindow = window;
  keepInside(window);
  window.on("closed", () => (mainWindow = null));
  showWhenLoaded(window);
  void window.loadFile(PAGE);
};

export const takeCommand = () => {
  const taken = command;
  command = null;
  return taken;
};

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
  // Server pages may link anywhere; only web links leave the app.
  const sameOrigin = (url: string) => URL.parse(url)?.origin === origin;
  const openOutside = (url: string) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) void window.loadURL(url);
    else openOutside(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  showWhenLoaded(window);
  try {
    await window.loadURL(await signedInUrl());
  } catch (error) {
    window.destroy();
    throw error;
  }
};

/** The window that shows the app's own pages, for state updates. */
export const localWindows = () =>
  mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
