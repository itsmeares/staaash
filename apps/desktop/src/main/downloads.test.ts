import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { IpcMainInvokeEvent, WebContents } from "electron";

import { BrowserDownloads } from "./downloads";

const mocks = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: IpcMainInvokeEvent, id?: unknown) => unknown
  >(),
  reveal: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      name: string,
      run: (event: IpcMainInvokeEvent, id?: unknown) => unknown,
    ) => mocks.handlers.set(name, run),
  },
  shell: { showItemInFolder: mocks.reveal },
}));
vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));

const rig = () => {
  const session = new EventEmitter();
  let destroyed = false;
  const view = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { url: "https://drive.test/files" },
    isDestroyed: () => destroyed,
    getURL: () => view.mainFrame.url,
    send: vi.fn(),
  });
  Object.defineProperty(view, "session", {
    get: () => {
      if (destroyed) throw new Error("Object has been destroyed");
      return session;
    },
  });
  view.on("destroyed", () => {
    destroyed = true;
  });
  const downloads = new BrowserDownloads();
  downloads.register();
  downloads.attach(view as unknown as WebContents, "https://drive.test");
  const event = {
    sender: view,
    senderFrame: view.mainFrame,
  } as unknown as IpcMainInvokeEvent;
  const invoke = <T = unknown>(name: string, id?: unknown) =>
    mocks.handlers.get(`downloads:${name}`)!(event, id) as T;
  const snapshot = () =>
    invoke<import("@staaash/config/desktop-downloads").BrowserDownload[]>(
      "state",
    );
  const item = (savePath = "/fake/renamed.txt") => {
    let received = 20;
    let total = 100;
    const transfer = Object.assign(new EventEmitter(), {
      getFilename: () => "original.txt",
      getMimeType: () => "text/plain",
      getSavePath: () => savePath,
      getReceivedBytes: () => received,
      getTotalBytes: () => total,
      canResume: vi.fn(() => false),
      cancel: vi.fn(() => transfer.emit("done", {}, "cancelled")),
      resume: vi.fn(),
      progress: (bytes: number, size: number, state = "progressing") => {
        received = bytes;
        total = size;
        transfer.emit("updated", {}, state);
      },
    });
    session.emit("will-download", {}, transfer, view);
    return transfer;
  };
  return { session, view, downloads, event, invoke, snapshot, item };
};

beforeEach(() => {
  vi.useRealTimers();
  mocks.handlers.clear();
  mocks.reveal.mockReset();
  mocks.stat.mockReset().mockResolvedValue({ isFile: () => true });
});

it("reports actual progress and the chosen filename, and reveals only a completed file", async () => {
  const r = rig();
  const item = r.item();
  const [{ id }] = r.snapshot();
  expect(await r.invoke("reveal", id)).toMatchObject({
    error: expect.any(String),
  });
  item.progress(40, 100);
  expect(r.snapshot()[0]).toMatchObject({
    name: "renamed.txt",
    receivedBytes: 40,
    totalBytes: 100,
    state: "downloading",
  });
  expect(r.snapshot()[0]).not.toHaveProperty("path");
  item.progress(100, 100);
  expect(r.snapshot()[0].state).toBe("downloading");
  item.emit("done", {}, "completed");
  expect(r.snapshot()[0].state).toBe("completed");
  expect(await r.invoke("reveal", id)).toEqual({ error: null });
  expect(mocks.reveal).toHaveBeenCalledWith("/fake/renamed.txt");
  expect(r.downloads.activeCount).toBe(0);
});

it("keeps unknown length indeterminate and completes an empty file", () => {
  const r = rig();
  const item = r.item();
  item.progress(20, 0);
  expect(r.snapshot()[0].totalBytes).toBeNull();
  item.progress(0, 0);
  item.emit("done", {}, "completed");
  expect(r.snapshot()[0]).toMatchObject({
    state: "completed",
    receivedBytes: 0,
  });
});

it("removes a cancelled save dialog without reporting a failure", () => {
  const r = rig();
  const item = r.item("");
  item.emit("done", {}, "cancelled");
  expect(r.snapshot()).toEqual([]);
});

it("retains interrupted progress and resumes only when the item allows it", async () => {
  const r = rig();
  const item = r.item();
  const [{ id }] = r.snapshot();
  item.canResume.mockReturnValue(true);
  item.progress(40, 100, "interrupted");
  expect(r.snapshot()[0]).toMatchObject({
    state: "interrupted",
    canResume: true,
  });
  expect(await r.invoke("resume", id)).toEqual({ error: null });
  expect(item.resume).toHaveBeenCalledOnce();
  item.emit("done", {}, "interrupted");
  expect(r.snapshot()[0]).toMatchObject({ state: "failed", canResume: false });
  expect(await r.invoke("resume", id)).toMatchObject({
    error: expect.any(String),
  });
});

it("keeps active downloads when clearing the list and cancels them on account reset", async () => {
  const r = rig();
  const done = r.item();
  done.emit("done", {}, "completed");
  const active = r.item();
  r.invoke("clear");
  expect(r.snapshot()).toHaveLength(1);
  expect(r.downloads.activeCount).toBe(1);
  expect(active.cancel).not.toHaveBeenCalled();
  const [{ id }] = r.snapshot();
  r.downloads.reset();
  expect(active.cancel).toHaveBeenCalledOnce();
  expect(r.snapshot()).toEqual([]);
  expect(await r.invoke("reveal", id)).toMatchObject({
    error: expect.any(String),
  });
});

it("rejects other windows, child frames and origins, including progress pushes", () => {
  const r = rig();
  const read = mocks.handlers.get("downloads:state")!;
  expect(() => read({ ...r.event, sender: {} } as IpcMainInvokeEvent)).toThrow(
    "denied",
  );
  expect(() =>
    read({
      ...r.event,
      senderFrame: { url: "https://drive.test/files" },
    } as IpcMainInvokeEvent),
  ).toThrow("denied");
  const item = r.item();
  r.view.mainFrame.url = "https://elsewhere.test/";
  expect(() => r.invoke("state")).toThrow("denied");
  r.view.send.mockClear();
  item.emit("done", {}, "completed");
  expect(r.view.send).not.toHaveBeenCalled();
});

it("ignores downloads from another window sharing the session", () => {
  const r = rig();
  r.session.emit("will-download", {}, {}, {});
  expect(r.snapshot()).toEqual([]);
});

it("never reveals a missing file or a record cleared while the file check was waiting", async () => {
  const r = rig();
  const item = r.item();
  item.emit("done", {}, "completed");
  const [{ id }] = r.snapshot();
  mocks.stat.mockRejectedValueOnce(new Error("missing"));
  expect(await r.invoke("reveal", id)).toMatchObject({
    error: "The downloaded file is no longer there.",
  });
  let resolve!: (value: { isFile: () => boolean }) => void;
  mocks.stat.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = r.invoke<Promise<unknown>>("reveal", id);
  r.downloads.reset();
  resolve({ isFile: () => true });
  expect(await pending).toMatchObject({ error: expect.any(String) });
  expect(mocks.reveal).not.toHaveBeenCalled();
});

it("limits finished history while preserving all active downloads", () => {
  const r = rig();
  for (let i = 0; i < 55; i += 1) r.item().emit("done", {}, "completed");
  for (let i = 0; i < 3; i += 1) r.item();
  expect(r.snapshot()).toHaveLength(53);
  expect(r.downloads.activeCount).toBe(3);
  r.downloads.reset();
});

it("removes the old session listener on close and reopens with finished history", () => {
  const r = rig();
  const item = r.item();
  item.emit("done", {}, "completed");
  r.view.emit("destroyed");
  expect(r.session.listenerCount("will-download")).toBe(0);
  expect(() => r.invoke("state")).toThrow("denied");
  const reopened = Object.assign(new EventEmitter(), {
    session: r.session,
    mainFrame: { url: "https://drive.test/files" },
    isDestroyed: () => false,
    getURL: () => "https://drive.test/files",
    send: vi.fn(),
  });
  r.downloads.attach(reopened as unknown as WebContents, "https://drive.test");
  const state = mocks.handlers.get("downloads:state")!({
    sender: reopened,
    senderFrame: reopened.mainFrame,
  } as unknown as IpcMainInvokeEvent);
  expect(state).toHaveLength(1);
  expect(r.session.listenerCount("will-download")).toBe(1);
  reopened.emit("did-navigate", {}, "https://drive.test/");
  expect(
    mocks.handlers.get("downloads:state")!({
      sender: reopened,
      senderFrame: reopened.mainFrame,
    } as unknown as IpcMainInvokeEvent),
  ).toEqual([]);
});
