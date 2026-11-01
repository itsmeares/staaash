import { existsSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  app,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";

import { createApi, fetchVersion } from "../engine/api";
import { SYNC_LOG_NAME } from "../engine/log";
import { freeBytes } from "../engine/transfer";
import type {
  AppState,
  EngineCommand,
  EngineEvent,
  EngineStatus,
  Settings,
  SyncPair,
} from "../shared/types";
import { FIRST_SYNC_SERVER, newer } from "../shared/version";
import { signInWithBrowser, signOutDevice, webSessionUrl } from "./auth";
import { loadSettings, loadToken, saveSettings, saveToken } from "./settings";
import {
  foldersOverlap,
  installLinuxMenuEntry,
  otherSyncAppWarning,
  setStartAtLogin,
} from "./system";
import { createTray } from "./tray";
import { startUpdates, type UpdateState } from "./updates";
import {
  localWindows,
  openAppWindow,
  openMainWindow,
  takeCommand,
} from "./windows";

if (!app.requestSingleInstanceLock()) app.exit(0);

let settings = loadSettings();
// Loaded once the app is ready; the keychain is not readable before.
let token: string | null = null;
let avatarUrl: string | null = null;
let accountRevision = 0;
let profileRequest: {
  token: string;
  serverUrl: string;
  promise: Promise<void>;
} | null = null;
let status: EngineStatus | null = null;
let versionProblem: AppState["versionProblem"] = null;
let update: UpdateState | null = null;
let engine: UtilityProcess | null = null;
let quitting = false;
let resumeTimer: NodeJS.Timeout | null = null;

const dataDir = () => path.join(app.getPath("userData"), "sync");

const state = (): AppState => ({
  appVersion: app.getVersion(),
  platform: process.platform,
  settings,
  signedIn: Boolean(token && settings.serverUrl),
  avatarUrl,
  status,
  versionProblem,
  update,
});

let tray: ReturnType<typeof createTray> | null = null;
const publish = () => {
  const current = state();
  tray?.update(current);
  for (const window of localWindows()) {
    window.webContents.send("state", current);
  }
};

const refreshProfile = () => {
  if (!token || !settings.serverUrl) return Promise.resolve();
  if (
    profileRequest?.token === token &&
    profileRequest.serverUrl === settings.serverUrl
  )
    return profileRequest.promise;
  const revision = accountRevision;
  const deviceToken = token;
  const serverUrl = settings.serverUrl;
  const request = createApi(serverUrl, deviceToken, AbortSignal.timeout(10_000))
    .session()
    .then((session) => {
      if (
        revision !== accountRevision ||
        deviceToken !== token ||
        serverUrl !== settings.serverUrl
      )
        return;
      avatarUrl = session.user.avatarUrl;
      publish();
    })
    // A cosmetic refresh must keep the last photo and leave sync alone offline.
    .catch(() => {})
    .finally(() => {
      if (profileRequest?.promise === request) profileRequest = null;
    });
  profileRequest = { token: deviceToken, serverUrl, promise: request };
  return request;
};

const notify = (title: string, body: string) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
};

const send = (command: EngineCommand) => engine?.postMessage(command);

const paused = () => {
  const until = settings.pausedUntil;
  return until === 0 || (until !== null && until > Date.now());
};

const configureEngine = () => {
  if (!token || !settings.serverUrl || versionProblem) return;
  send({
    type: "configure",
    config: {
      serverUrl: settings.serverUrl,
      token,
      deviceName: settings.deviceName,
      pairs: settings.pairs,
      ignore: settings.ignore,
      minFreeBytes: settings.minFreeBytes,
      uploadLimitKBps: settings.uploadLimitKBps,
      downloadLimitKBps: settings.downloadLimitKBps,
      paused: paused(),
    },
  });
};

// Longer delays fire at once, so a long pause wakes up and waits again.
const LONGEST_TIMER = 2 ** 31 - 1;
const armResumeTimer = () => {
  if (resumeTimer) clearTimeout(resumeTimer);
  const until = settings.pausedUntil;
  if (!until) return;
  const left = until - Date.now();
  resumeTimer = setTimeout(
    () => {
      if (left > LONGEST_TIMER) armResumeTimer();
      else void serial(() => updateSettings({ pausedUntil: null }));
    },
    Math.max(0, Math.min(left, LONGEST_TIMER)),
  );
};

const updateSettings = async (patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  await saveSettings(settings);
  armResumeTimer();
  configureEngine();
  publish();
  tray?.rebuild();
};

/** Starts the engine process, and starts it again if it ever crashes. */
const startEngine = () => {
  const child = utilityProcess.fork(
    path.join(__dirname, "../engine/index.cjs"),
    [dataDir()],
    {
      serviceName: "Staaash sync",
    },
  );
  engine = child;
  child.on("message", (event: EngineEvent) => {
    switch (event.type) {
      case "status":
        status = event.status;
        publish();
        return;
      case "notify":
        notify(event.title, event.body);
        return;
      case "trash":
        void shell
          .trashItem(event.path)
          .then(() => null)
          .catch((error: Error) => error.message)
          .then((error) =>
            send({ type: "trashed", requestId: event.requestId, error }),
          );
        return;
      case "signed-out":
        // A stale engine's sign-out must not end the account that replaced it.
        void serial(async () => {
          if (engine === child)
            await signedOut(
              "This device was signed out. Sign in again to keep syncing.",
            );
        });
        return;
    }
  });
  child.on("exit", () => {
    // Only a crash restarts it; stopEngine clears `engine` first.
    if (engine !== child) return;
    engine = null;
    if (!quitting)
      setTimeout(() => {
        if (engine || quitting) return;
        startEngine();
        configureEngine();
      }, 2000);
  });
};

/**
 * Asks the engine to finish the action in flight and close its database,
 * and kills it if that takes too long. What a kill interrupts, the next run
 * finds and repairs, so the wait only saves work.
 */
const stopEngine = async (cancelUploads = false) => {
  const child = engine;
  engine = null;
  if (!child) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.postMessage({ type: "stop", cancelUploads } satisfies EngineCommand);
  const timer = setTimeout(() => child.kill(), 10_000);
  await exited;
  clearTimeout(timer);
};

let queue: Promise<unknown> = Promise.resolve();
/**
 * Sign-in, sign-out and settings changes run one at a time, in the order
 * they came: each reads and replaces the account, the pairs and the engine.
 */
const serial = <T>(work: () => Promise<T>) => {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
};

/** Forgets the account and everything the engine knew about it. */
const resetAccount = async () => {
  accountRevision += 1;
  profileRequest = null;
  avatarUrl = null;
  await stopEngine();
  await rm(dataDir(), { recursive: true, force: true });
  token = null;
  status = null;
  versionProblem = null;
  await saveToken(null);
  startEngine();
};

const signedOut = async (message: string | null) => {
  await resetAccount();
  await updateSettings({ email: null, pairs: [], setupSkipped: false });
  if (message) notify("Signed out", message);
  openMainWindow();
};

/** Whether this app and the server can work together. Offline is not a problem. */
const checkVersions = async (serverUrl: string) => {
  try {
    const versions = await fetchVersion(serverUrl);
    // A development build carries the repository version, not a release one.
    versionProblem =
      app.isPackaged && newer(versions.minClientVersion, app.getVersion())
        ? {
            side: "app",
            serverVersion: versions.version,
            needed: versions.minClientVersion,
          }
        : null;
  } catch (error) {
    const status = (error as { status?: number }).status;
    // Servers from before sync have no /api/version.
    versionProblem =
      status === 404
        ? { side: "server", serverVersion: "older", needed: FIRST_SYNC_SERVER }
        : versionProblem;
  }
  publish();
  return versionProblem;
};

const normalizeServer = (input: string) => {
  const trimmed = input.trim().replace(/\/+$/, "");
  const url = new URL(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  return url.origin;
};

/** Every folder on the server, with the size of what is inside each. */
// Sizes add up every file into each ancestor folder.
// fallow-ignore-next-line complexity
const serverFolders = async () => {
  if (!token || !settings.serverUrl) return { error: "Not signed in." };
  const api = createApi(settings.serverUrl, token);
  const { folders } = await api.folders();
  const parents = new Map(
    folders.map((folder) => [folder.id, folder.parentId]),
  );
  const sizes = new Map<string, number>();
  let cursor: string | null = null;
  do {
    const page = await api.snapshot(null, cursor);
    for (const item of page.items) {
      if (item.type !== "file") continue;
      for (let id = item.parentId; id; id = parents.get(id) ?? null) {
        sizes.set(id, (sizes.get(id) ?? 0) + (item.sizeBytes ?? 0));
      }
    }
    cursor = page.next;
  } while (cursor);
  return {
    folders: folders.map((folder) => ({
      id: folder.id,
      parentId: folder.parentId,
      name: folder.name,
      pathLabel: folder.pathLabel,
      isFilesRoot: folder.isFilesRoot,
      size: sizes.get(folder.id) ?? 0,
    })),
    homeDir: os.homedir(),
    freeBytes: await freeBytes(os.homedir()),
  };
};

/** Pairs never overlap on either side, and never cover the app's own data. */
// Each rule names the pair it rejects.
// fallow-ignore-next-line complexity
const checkPairs = async (pairs: SyncPair[]) => {
  if (!token || !settings.serverUrl) return "Not signed in.";
  for (const [index, pair] of pairs.entries()) {
    if (!path.isAbsolute(pair.localPath)) {
      return `${pair.localPath} is not a full path. Pick another folder.`;
    }
    if (foldersOverlap(pair.localPath, app.getPath("userData"))) {
      return `${pair.localPath} holds Staaash's own data. Pick another folder.`;
    }
    for (const other of pairs.slice(index + 1)) {
      if (foldersOverlap(pair.localPath, other.localPath)) {
        return `${pair.localPath} and ${other.localPath} overlap. Each folder can only sync once.`;
      }
    }
  }
  const { folders } = await createApi(settings.serverUrl, token).folders();
  const parents = new Map(
    folders.map((folder) => [folder.id, folder.parentId]),
  );
  const ancestors = (id: string) => {
    const chain = new Set<string>();
    for (
      let current: string | null = id;
      current;
      current = parents.get(current) ?? null
    ) {
      chain.add(current);
    }
    return chain;
  };
  // A pair may sit inside another only in a folder the other leaves out.
  const inside = (inner: SyncPair, outer: SyncPair) => {
    const chain = ancestors(inner.remoteFolderId);
    return (
      chain.has(outer.remoteFolderId) &&
      !outer.skipFolders?.some((folder) => chain.has(folder.id))
    );
  };
  for (const [index, pair] of pairs.entries()) {
    for (const other of pairs.slice(index + 1)) {
      if (inside(pair, other) || inside(other, pair)) {
        return `${pair.remoteLabel} and ${other.remoteLabel} overlap on the server. Each folder can only sync once.`;
      }
    }
  }
  return null;
};

const handle = <T extends unknown[], R>(
  channel: string,
  run: (...args: T) => R | Promise<R>,
) => ipcMain.handle(channel, (_event, ...args) => run(...(args as T)));

const openStaaash = async () => {
  const serverUrl = settings.serverUrl;
  const deviceToken = token;
  if (!serverUrl || !deviceToken) return { error: "Sign in first." };
  try {
    await openAppWindow(serverUrl, () => webSessionUrl(serverUrl, deviceToken));
    return { error: null };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

const openFolder = async (pairId: string, rel?: string) => {
  const pair = settings.pairs.find((each) => each.id === pairId);
  if (!pair) return;
  if (rel) shell.showItemInFolder(path.join(pair.localPath, ...rel.split("/")));
  else await shell.openPath(pair.localPath);
};

const openSyncLog = async () => {
  await mkdir(dataDir(), { recursive: true });
  const file = path.join(dataDir(), SYNC_LOG_NAME);
  // Empty until something goes wrong; the button still has to open something.
  await appendFile(file, "");
  // Not every computer has an app for .log files.
  if (await shell.openPath(file)) shell.showItemInFolder(file);
};

// Ten years is far past any real pause, and keeps the date valid.
const LONGEST_PAUSE_MINUTES = 10 * 365 * 24 * 60;

const pause = (minutes: number | null) => {
  if (minutes !== null && !(minutes >= 0)) return Promise.resolve();
  return updateSettings({
    pausedUntil:
      minutes === null
        ? null
        : minutes === 0
          ? 0
          : Date.now() + Math.min(minutes, LONGEST_PAUSE_MINUTES) * 60_000,
  });
};

const savePairs = async (pairs: SyncPair[]) => {
  try {
    const problem = await checkPairs(pairs);
    if (problem) return { error: problem };
    for (const pair of pairs) {
      if (!existsSync(pair.localPath))
        await mkdir(pair.localPath, { recursive: true });
    }
    await updateSettings({ pairs });
    return { error: null };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

let updates: ReturnType<typeof startUpdates> | null = null;

const registerIpc = () => {
  handle("get-state", state);
  handle("refresh-profile", refreshProfile);
  handle("connect", async (input: string) => {
    let serverUrl;
    try {
      serverUrl = normalizeServer(input);
    } catch {
      return { error: "That doesn't look like a web address." };
    }
    try {
      await fetchVersion(serverUrl);
    } catch (error) {
      return {
        error:
          (error as { status?: number }).status === 404
            ? `This server needs Staaash ${FIRST_SYNC_SERVER} or newer to sync.`
            : "Couldn't reach a Staaash server there. Check the address.",
      };
    }
    try {
      const result = await signInWithBrowser(serverUrl, settings.deviceName);
      await serial(async () => {
        await resetAccount();
        token = result.token;
        avatarUrl = result.avatarUrl;
        await saveToken(token);
        // Before the settings, which start the engine unless versions clash.
        await checkVersions(serverUrl);
        await updateSettings({
          serverUrl,
          email: result.email,
          pairs: [],
          setupSkipped: false,
        });
      });
      return { error: null };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
  handle("server-folders", async () => {
    try {
      return await serverFolders();
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
  handle("choose-folder", async (defaultPath: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle("folder-warning", (localPath: string) =>
    otherSyncAppWarning(localPath),
  );
  handle("create-server-folder", async (parentId: string, name: string) => {
    if (!token || !settings.serverUrl) return { error: "Not signed in." };
    try {
      const { folder } = await createApi(
        settings.serverUrl,
        token,
      ).createFolder(parentId, name);
      return {
        folder: {
          id: folder.id,
          parentId,
          name: folder.name,
          pathLabel: folder.name,
          isFilesRoot: false,
          size: 0,
        },
      };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
  handle("save-pairs", (pairs: SyncPair[]) => serial(() => savePairs(pairs)));
  handle("update-settings", (patch: Partial<Settings>) =>
    serial(async () => {
      await updateSettings(patch);
      if (patch.startAtLogin !== undefined)
        await setStartAtLogin(patch.startAtLogin);
    }),
  );
  handle("pause", (minutes: number | null) => serial(() => pause(minutes)));
  handle("open-staaash", openStaaash);
  handle("open-folder", openFolder);
  handle("open-sync-log", openSyncLog);
  handle(
    "resolve-conflict",
    (id: number, choice: "keep-server" | "keep-mine") =>
      send({ type: "resolve-conflict", id, choice }),
  );
  handle("resolve-pair", (pairId: string, choice: "download-again" | "apply") =>
    send({ type: "resolve-pair", pairId, choice }),
  );
  handle("take-command", takeCommand);
  handle("install-update", () => updates?.install());
  handle("sign-out", () =>
    serial(async () => {
      // Cancels its unfinished uploads while the token still works.
      await stopEngine(true);
      if (token && settings.serverUrl)
        await signOutDevice(settings.serverUrl, token);
      await signedOut(null);
    }),
  );
  handle("quit", () => app.quit());
};

app.on("second-instance", () => openMainWindow());
// A tray app keeps running with every window closed.
app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  if (!engine) return;
  // Let the engine finish its action and close its database first.
  event.preventDefault();
  quitting = true;
  void serial(stopEngine).then(() => app.quit());
});

// Startup: each step depends on what is saved, so each is a branch.
// fallow-ignore-next-line complexity
void app.whenReady().then(async () => {
  app.setAppUserModelId("com.staaash.desktop");
  app.dock?.hide();
  token = loadToken();
  registerIpc();
  startEngine();
  tray = createTray({
    openWindow: () => openMainWindow(),
    customPause: () => openMainWindow("custom-pause"),
    openStaaash: () => void openStaaash(),
    openFolder: (pairId) => void openFolder(pairId),
    pause: (minutes) => void serial(() => pause(minutes)),
    openSettings: () => openMainWindow("settings"),
    installUpdate: () => void updates?.install(),
    quit: () => app.quit(),
  });
  updates = startUpdates((next) => {
    update = next;
    publish();
    tray?.rebuild();
  });
  powerMonitor.on("resume", () => send({ type: "sync-now" }));
  if (token && settings.serverUrl) await checkVersions(settings.serverUrl);
  await updateSettings({});
  await setStartAtLogin(settings.startAtLogin);
  await installLinuxMenuEntry().catch(() => {});
  const hidden =
    process.argv.includes("--hidden") ||
    app.getLoginItemSettings().wasOpenedAtLogin;
  const needsSetup = settings.pairs.length === 0 && !settings.setupSkipped;
  if (!token || needsSetup || versionProblem || !hidden) {
    openMainWindow();
  }
});
