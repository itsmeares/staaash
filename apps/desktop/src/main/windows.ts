import path from "node:path";
import {
  app,
  BrowserWindow,
  nativeTheme,
  shell,
  WebContentsView,
} from "electron";

import { hasCustomTitleBar } from "../shared/title-bar";
import type { WindowCommand } from "../shared/types";

const PRELOAD = path.join(__dirname, "../preload/index.cjs");
const PAGE = path.join(__dirname, "../renderer/index.html");

const background = () =>
  // The app's dark and light canvas, so a window never flashes white.
  nativeTheme.shouldUseDarkColors ? "#090807" : "#f6f4f2";

const ICON = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "../../resources/icon.png");

const TOP_ROW_HEIGHT = 44;
// Shorter than the row, so the buttons' hover colour stops short of the panel.
const BUTTONS_HEIGHT = 34;

const customTitleBar = hasCustomTitleBar(
  process.platform,
  process.env.XDG_CURRENT_DESKTOP,
);

const buttons = () => ({
  color: background(),
  symbolColor: nativeTheme.shouldUseDarkColors ? "#efeeec" : "#1d1a17",
  height: BUTTONS_HEIGHT,
});

const titleBar = (): Electron.BrowserWindowConstructorOptions => {
  if (!customTitleBar) return {};
  return process.platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 14, y: 15 },
      }
    : { titleBarStyle: "hidden", titleBarOverlay: buttons() };
};

nativeTheme.on("updated", () => {
  if (!customTitleBar || process.platform === "darwin") return;
  for (const window of BrowserWindow.getAllWindows()) {
    window.setTitleBarOverlay(buttons());
  }
});

const local = (options: Electron.BrowserWindowConstructorOptions) =>
  new BrowserWindow({
    show: false,
    icon: ICON,
    backgroundColor: background(),
    ...titleBar(),
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
const showWhenLoaded = (window: BrowserWindow, contents = window.webContents) =>
  contents.once("did-finish-load", () => {
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
  const window = local({
    width: 1280,
    height: 820,
    minWidth: 400,
    minHeight: 500,
    title: "Staaash",
    autoHideMenuBar: true,
  });
  appWindow = window;
  keepInside(window);
  // The window itself shows only the top row. The web app sits below it in a
  // view of its own, with no access to the app's preload script.
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const contents = view.webContents;
  window.contentView.addChildView(view);
  const fitView = () => {
    const { width, height } = window.getContentBounds();
    const top = customTitleBar ? TOP_ROW_HEIGHT : 0;
    view.setBounds({ x: 0, y: top, width, height: height - top });
  };
  fitView();
  window.on("resize", fitView);
  window.on("closed", () => {
    appWindow = null;
    contents.close();
  });
  if (customTitleBar) void window.loadFile(PAGE, { search: "top-row" });
  // Server pages may link anywhere; only web links leave the app.
  const sameOrigin = (url: string) => URL.parse(url)?.origin === origin;
  const openOutside = (url: string) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) void contents.loadURL(url);
    else openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  showWhenLoaded(window, contents);
  try {
    await contents.loadURL(await signedInUrl());
  } catch (error) {
    window.destroy();
    throw error;
  }
};

/** The window that shows the app's own pages, for state updates. */
export const localWindows = () =>
  mainWindow && !mainWindow.isDestroyed() ? [mainWindow] : [];
