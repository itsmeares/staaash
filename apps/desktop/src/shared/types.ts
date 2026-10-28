/** Types shared by the main process, the sync engine and the windows. */

/** two-way, server to computer only, or computer to server only. */
export type SyncMode = "two-way" | "download" | "upload";

/** One local folder linked to one server folder. Pairs never overlap. */
export type SyncPair = {
  id: string;
  localPath: string;
  remoteFolderId: string;
  /** The server path, for display only. */
  remoteLabel: string;
  mode: SyncMode;
};

export type Settings = {
  serverUrl: string | null;
  /** The signed-in account, for display. */
  email: string | null;
  deviceName: string;
  pairs: SyncPair[];
  /** Extra ignore patterns; `*` and `?` match within one name. */
  ignore: string[];
  minFreeBytes: number;
  uploadLimitKBps: number | null;
  downloadLimitKBps: number | null;
  /** Epoch ms; 0 pauses until resumed. */
  pausedUntil: number | null;
  startAtLogin: boolean;
};

export type EngineConfig = {
  serverUrl: string;
  token: string;
  deviceName: string;
  pairs: SyncPair[];
  ignore: string[];
  minFreeBytes: number;
  uploadLimitKBps: number | null;
  downloadLimitKBps: number | null;
  paused: boolean;
};

export type IssueKind =
  | "invalid-name"
  | "symlink"
  | "quota"
  | "disk-full"
  | "folder-missing"
  | "folder-emptied"
  | "server-folder-gone"
  | "error";

/** Something that stops one item or one pair from syncing. */
export type Issue = {
  pairId: string;
  rel: string;
  kind: IssueKind;
  message: string;
  remoteId?: string;
};

/** A file changed on both sides; the local version was kept as `copyRel`. */
export type Conflict = {
  id: number;
  pairId: string;
  rel: string;
  copyRel: string;
};

export type Activity = {
  pairId: string;
  rel: string;
  direction: "up" | "down";
  state: "active" | "done" | "failed";
  bytes: number;
  doneBytes: number;
  at: number;
};

export type EngineState =
  | "starting"
  | "idle"
  | "syncing"
  | "paused"
  | "offline"
  | "signed-out";

export type EngineStatus = {
  state: EngineState;
  pendingFiles: number;
  pendingBytes: number;
  fileCount: number;
  activity: Activity[];
  conflicts: Conflict[];
  issues: Issue[];
  lastSyncAt: number | null;
};

export type ConflictChoice = "keep-server" | "keep-mine";

/** From the main process to the engine. */
export type EngineCommand =
  | { type: "configure"; config: EngineConfig }
  | { type: "sync-now" }
  | { type: "resolve-conflict"; id: number; choice: ConflictChoice }
  | { type: "resolve-pair"; pairId: string; choice: "download-again" | "apply" }
  | { type: "forget-pair"; pairId: string }
  | { type: "trashed"; requestId: number; error: string | null };

/** From the engine to the main process. */
export type EngineEvent =
  | { type: "status"; status: EngineStatus }
  | { type: "notify"; title: string; body: string }
  | { type: "trash"; requestId: number; path: string }
  | { type: "signed-out" };

/** A server folder, for picking what to sync. */
export type ServerFolder = {
  id: string;
  parentId: string | null;
  name: string;
  pathLabel: string;
  isFilesRoot: boolean;
  /** Bytes of files inside, all levels down. */
  size: number;
};

/** Everything the windows show, pushed from the main process. */
export type AppState = {
  appVersion: string;
  platform: NodeJS.Platform;
  settings: Settings;
  signedIn: boolean;
  status: EngineStatus | null;
  /** The server and this app cannot work together until one is updated. */
  versionProblem: {
    side: "server" | "app";
    serverVersion: string;
    needed: string;
  } | null;
  update: { version: string; ready: boolean; manual: boolean } | null;
};

export type Result = { error: string | null };

/** What the preload script exposes to the windows as `window.staaash`. */
export type DesktopApi = {
  getState: () => Promise<AppState>;
  onState: (listener: (state: AppState) => void) => () => void;
  connect: (serverUrl: string) => Promise<Result>;
  serverFolders: () => Promise<
    | { folders: ServerFolder[]; homeDir: string; freeBytes: number }
    | { error: string }
  >;
  chooseFolder: (defaultPath: string) => Promise<string | null>;
  folderWarning: (localPath: string) => Promise<string | null>;
  savePairs: (pairs: SyncPair[]) => Promise<Result>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  pause: (minutes: number | null) => Promise<void>;
  openStaaash: () => Promise<Result>;
  openFolder: (pairId: string, rel?: string) => Promise<void>;
  resolveConflict: (id: number, choice: ConflictChoice) => Promise<void>;
  resolvePair: (
    pairId: string,
    choice: "download-again" | "apply",
  ) => Promise<void>;
  openSettings: () => Promise<void>;
  installUpdate: () => Promise<void>;
  signOut: () => Promise<void>;
  quit: () => Promise<void>;
};
