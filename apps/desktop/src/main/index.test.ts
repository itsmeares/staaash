import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { AppState, Settings } from "../shared/types";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  session: vi.fn(),
  createApi: vi.fn(),
  signIn: vi.fn(),
  saveSettings: vi.fn(),
  postMessage: vi.fn(),
  stop: vi.fn(),
  publish: vi.fn(),
  fork: vi.fn(),
  ready: Promise.resolve(),
}));

vi.mock("node:fs/promises", () => ({ rm: vi.fn() }));
vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: () => true,
    on: vi.fn(),
    whenReady: () => mocks.ready,
    getPath: () => "/unused-test-data",
    getVersion: () => "2.0.0",
    setAppUserModelId: vi.fn(),
    getLoginItemSettings: () => ({ wasOpenedAtLogin: false }),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
  },
  Notification: { isSupported: () => false },
  powerMonitor: { on: vi.fn() },
  utilityProcess: { fork: mocks.fork },
}));
vi.mock("../engine/api", () => ({
  createApi: mocks.createApi,
  fetchVersion: async () => ({ version: "2.0.0", minClientVersion: "2.0.0" }),
}));
vi.mock("../engine/transfer", () => ({ freeBytes: vi.fn() }));
vi.mock("./auth", () => ({
  signInWithBrowser: mocks.signIn,
  signOutDevice: vi.fn(),
  webSessionUrl: vi.fn(),
}));
vi.mock("./settings", () => ({
  loadSettings: (): Settings => ({
    serverUrl: "https://drive.example.test",
    email: "first@example.test",
    deviceName: "Test computer",
    pairs: [],
    ignore: [],
    minFreeBytes: 0,
    uploadLimitKBps: null,
    downloadLimitKBps: null,
    pausedUntil: null,
    startAtLogin: false,
    setupSkipped: true,
  }),
  loadToken: () => "first-token",
  saveSettings: mocks.saveSettings,
  saveToken: vi.fn(),
}));
vi.mock("./system", () => ({
  setStartAtLogin: vi.fn(),
  installLinuxMenuEntry: async () => {},
}));
vi.mock("./tray", () => ({
  createTray: () => ({ update: vi.fn(), rebuild: vi.fn() }),
}));
vi.mock("./updates", () => ({ startUpdates: vi.fn() }));
vi.mock("./windows", () => ({
  openMainWindow: vi.fn(),
  takeCommand: vi.fn(),
  localWindows: () => [{ webContents: { send: mocks.publish } }],
}));

const invoke = <T = void>(channel: string, ...args: unknown[]) =>
  mocks.handlers.get(channel)!(undefined, ...args) as T;
const state = () => invoke<AppState>("get-state");
const refresh = () => invoke<Promise<void>>("refresh-profile");
const deferredSession = () => {
  let resolve!: (value: { user: { avatarUrl: string | null } }) => void;
  const promise = new Promise<{ user: { avatarUrl: string | null } }>(
    (done) => {
      resolve = done;
    },
  );
  return { promise, resolve };
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.session
    .mockReset()
    .mockResolvedValue({ user: { avatarUrl: "photo-a" } });
  mocks.createApi.mockReturnValue({ session: mocks.session });
  mocks.stop.mockImplementation((finish: () => void) => finish());
  mocks.signIn.mockResolvedValue({
    token: "second-token",
    email: "second@example.test",
    avatarUrl: "photo-b",
  });
  const { utilityProcess } = await import("electron");
  mocks.fork.mockImplementation(() => {
    const child = new EventEmitter();
    return Object.assign(child, {
      postMessage: (command: { type: string }) => {
        mocks.postMessage(command);
        if (command.type === "stop") mocks.stop(() => child.emit("exit", 0));
      },
    }) as ReturnType<typeof utilityProcess.fork>;
  });
  await import("./index");
  await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
  mocks.saveSettings.mockClear();
  mocks.postMessage.mockClear();
});

it("loads an existing account's photo without saving settings or reconfiguring sync", async () => {
  expect(state().avatarUrl).toBeNull();
  await refresh();
  expect(state().avatarUrl).toBe("photo-a");
  expect(mocks.publish).toHaveBeenLastCalledWith(
    "state",
    expect.objectContaining({ avatarUrl: "photo-a" }),
  );
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  expect(mocks.postMessage).not.toHaveBeenCalled();
});

it("shares an outstanding refresh and can fetch a changed or removed photo", async () => {
  const pending = deferredSession();
  mocks.session.mockReturnValueOnce(pending.promise);
  const first = refresh();
  const second = refresh();
  expect(mocks.session).toHaveBeenCalledTimes(1);
  pending.resolve({ user: { avatarUrl: "photo-a" } });
  await Promise.all([first, second]);
  mocks.session.mockResolvedValueOnce({ user: { avatarUrl: "photo-b" } });
  await refresh();
  expect(state().avatarUrl).toBe("photo-b");
  mocks.session.mockResolvedValueOnce({ user: { avatarUrl: null } });
  await refresh();
  expect(state().avatarUrl).toBeNull();
});

it("keeps the last photo when offline and allows the next refresh", async () => {
  await refresh();
  mocks.session.mockRejectedValueOnce(new Error("Offline"));
  await refresh();
  expect(state().avatarUrl).toBe("photo-a");
  await refresh();
  expect(mocks.session).toHaveBeenCalledTimes(3);
  expect(mocks.postMessage).not.toHaveBeenCalled();
});

it("bounds the account request and keeps the photo on timeout", async () => {
  await refresh();
  const controller = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(controller.signal);
  mocks.createApi.mockImplementationOnce(
    (_url: string, _token: string, signal: AbortSignal) => ({
      session: () =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    }),
  );
  const pending = refresh();
  expect(timeout).toHaveBeenCalledWith(10_000);
  controller.abort(new Error("Timed out"));
  await pending;
  timeout.mockRestore();
  expect(state().avatarUrl).toBe("photo-a");
});

it("clears the photo at sign-out and ignores a late account reply", async () => {
  await refresh();
  const pending = deferredSession();
  mocks.session.mockReturnValueOnce(pending.promise);
  const request = refresh();
  await invoke<Promise<void>>("sign-out");
  expect(state()).toMatchObject({ signedIn: false, avatarUrl: null });
  pending.resolve({ user: { avatarUrl: "old-photo" } });
  await request;
  expect(state().avatarUrl).toBeNull();
  await refresh();
  expect(mocks.session).toHaveBeenCalledTimes(2);
});

it("keeps the new sign-in photo and its pending refresh when an old reply arrives", async () => {
  const old = deferredSession();
  mocks.session.mockReturnValueOnce(old.promise);
  const oldRequest = refresh();
  await invoke<Promise<unknown>>("connect", "https://other.example.test");
  expect(state().avatarUrl).toBe("photo-b");
  const current = deferredSession();
  mocks.session.mockReturnValueOnce(current.promise);
  const currentRequest = refresh();
  expect(mocks.session).toHaveBeenCalledTimes(2);
  old.resolve({ user: { avatarUrl: "old-photo" } });
  await oldRequest;
  expect(state().avatarUrl).toBe("photo-b");
  void refresh();
  expect(mocks.session).toHaveBeenCalledTimes(2);
  current.resolve({ user: { avatarUrl: "new-photo" } });
  await currentRequest;
  expect(state().avatarUrl).toBe("new-photo");
});

it("does not release a new account's pending refresh when a request began during reset", async () => {
  let finishStop: (() => void) | undefined;
  mocks.stop.mockImplementationOnce((finish: () => void) => {
    finishStop = finish;
  });
  const connecting = invoke<Promise<unknown>>(
    "connect",
    "https://other.example.test",
  );
  await vi.waitFor(() => expect(finishStop).toBeDefined());
  const old = deferredSession();
  mocks.session.mockReturnValueOnce(old.promise);
  const oldRequest = refresh();
  finishStop!();
  await connecting;
  const current = deferredSession();
  mocks.session.mockReturnValueOnce(current.promise);
  const currentRequest = refresh();
  expect(mocks.session).toHaveBeenCalledTimes(2);
  old.resolve({ user: { avatarUrl: "old-photo" } });
  await oldRequest;
  void refresh();
  expect(mocks.session).toHaveBeenCalledTimes(2);
  expect(state().avatarUrl).toBe("photo-b");
  current.resolve({ user: { avatarUrl: "new-photo" } });
  await currentRequest;
  expect(state().avatarUrl).toBe("new-photo");
});
