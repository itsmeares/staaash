import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const updater = vi.hoisted(() => {
  let listeners: Record<string, (info: { version: string } | string) => void> =
    {};
  return {
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
    on: (
      event: string,
      listener: (info: { version: string } | string) => void,
    ) => {
      listeners[event] = listener;
    },
    emit: (event: string, info: { version: string } | string) =>
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

it("a candidate still downloading when candidates are left never installs", () => {
  setPlatform("linux");
  const onChange = vi.fn();
  const updates = startUpdates(onChange, true);
  // The check already picked rc.9 but has not reported it yet.
  updates.setReleaseCandidates(false);
  updater.emit("update-available", { version: "2.0.0-rc.9" });
  updater.emit("update-downloaded", { version: "2.0.0-rc.9" });
  expect(onChange).not.toHaveBeenCalled();
  expect(updater.autoInstallOnAppQuit).toBe(false);
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
  // Stable asks for the latest release, so candidates cannot hide it.
  expect(fetch).toHaveBeenLastCalledWith(
    "https://api.github.com/repos/itsmeares/staaash/releases/latest",
    expect.anything(),
  );
});

const releases = (...tags: string[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        tags.map((tag) => ({
          tag_name: tag,
          draft: false,
          prerelease: tag.includes("-"),
        })),
      ),
    ),
  );

it("a candidate install asks for the stable release once it is out", async () => {
  setPlatform("linux");
  releases("v2.0.0", "v2.0.0-rc.9", "v2.0.0-rc.8");
  const updates = startUpdates(vi.fn(), true);
  await updates.check();
  expect(updater.allowPrerelease).toBe(false);
  expect(updater.checkForUpdates).toHaveBeenCalled();
});

it("a candidate install keeps asking for candidates newer than any release", async () => {
  setPlatform("linux");
  releases("v2.0.0-rc.9", "v1.2.1");
  const updates = startUpdates(vi.fn(), true);
  await updates.check();
  expect(updater.allowPrerelease).toBe(true);
});

it("switching to Stable during a lookup keeps candidates off", async () => {
  setPlatform("linux");
  let answer = (_response: Response) => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ),
  );
  const updates = startUpdates(vi.fn(), true);
  const pending = updates.check();
  updates.setReleaseCandidates(false);
  answer(
    Response.json([
      { tag_name: "v2.1.0-rc.1", draft: false, prerelease: true },
    ]),
  );
  await pending;
  expect(updater.allowPrerelease).toBe(false);
});

it("a failed release lookup fails the check instead of guessing", async () => {
  setPlatform("linux");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  updater.checkForUpdates.mockClear();
  const updates = startUpdates(vi.fn(), true);
  await expect(updates.check()).resolves.toBe("failed");
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
});

it("reports where the AppImage went when an update saved it under a new name", () => {
  setPlatform("linux");
  const moved = vi.fn();
  startUpdates(vi.fn(), true, moved);

  updater.emit("appimage-filename-updated", "/apps/Staaash-2.0.0.AppImage");

  expect(moved).toHaveBeenCalledWith("/apps/Staaash-2.0.0.AppImage");
});
