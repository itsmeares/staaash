import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const updater = vi.hoisted(() => {
  let listeners: Record<string, (info: { version: string }) => void> = {};
  return {
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
    on: (event: string, listener: (info: { version: string }) => void) => {
      listeners[event] = listener;
    },
    emit: (event: string, info: { version: string }) =>
      listeners[event]?.(info),
    reset: () => {
      listeners = {};
    },
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "2.0.0-rc.8" },
  shell: { openExternal: vi.fn() },
}));
vi.mock("electron-updater", () => ({ default: { autoUpdater: updater } }));

const { startUpdates } = await import("./updates");

const platform = process.platform;
const setPlatform = (value: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value });

beforeEach(() => {
  vi.useFakeTimers();
  updater.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPlatform(platform);
});

it("leaving candidates drops a downloaded candidate so it never installs", () => {
  setPlatform("linux");
  const onChange = vi.fn();
  const updates = startUpdates(onChange, true);
  updater.emit("update-downloaded", { version: "2.0.0-rc.9" });
  expect(onChange).toHaveBeenLastCalledWith({
    version: "2.0.0-rc.9",
    ready: true,
    manual: false,
  });

  updates.setReleaseCandidates(false);
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(updater.autoInstallOnAppQuit).toBe(false);

  // A candidate download that started earlier and finishes now is ignored.
  updater.emit("update-downloaded", { version: "2.0.0-rc.9" });
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(updater.autoInstallOnAppQuit).toBe(false);

  updater.emit("update-downloaded", { version: "2.0.0" });
  expect(updater.autoInstallOnAppQuit).toBe(true);
});

it("leaving candidates keeps a stable update that is ready", () => {
  setPlatform("linux");
  const onChange = vi.fn();
  const updates = startUpdates(onChange, true);
  updater.emit("update-downloaded", { version: "2.0.0" });
  updates.setReleaseCandidates(false);
  expect(onChange).not.toHaveBeenCalledWith(null);
  expect(updater.autoInstallOnAppQuit).toBe(true);
});

it("on macOS, leaving candidates clears a candidate offer", async () => {
  setPlatform("darwin");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        { tag_name: "v2.0.0-rc.9", draft: false, prerelease: true },
        { tag_name: "v1.2.1", draft: false, prerelease: false },
      ]),
    ),
  );
  const onChange = vi.fn();
  const updates = startUpdates(onChange, true);
  await expect(updates.check()).resolves.toBe("found");
  expect(onChange).toHaveBeenLastCalledWith({
    version: "2.0.0-rc.9",
    ready: true,
    manual: true,
  });

  updates.setReleaseCandidates(false);
  expect(onChange).toHaveBeenLastCalledWith(null);
  await expect(updates.check()).resolves.toBe("current");
});
