import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { Activity } from "../shared/types";
import { ApiError, createApi } from "./api";
import * as local from "./local";
import { type PairContext, syncPair } from "./pair-sync";
import { RemoteTree } from "./remote";
import { Store } from "./store";
import { Throttle, UploadMeter } from "./transfer";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const quota = () =>
  new ApiError(413, "Quota full", "USER_STORAGE_QUOTA_EXCEEDED");

const rig = async (names = ["a.txt", "b.txt"]) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staaash-pair-"));
  const directory = path.join(root, "files");
  await mkdir(directory);
  const store = new Store(path.join(root, "sync.db"));
  cleanups.push(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  for (const name of names) {
    await writeFile(path.join(directory, name), name);
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(directory, name), old, old);
  }
  const api = createApi("http://unused.invalid", "fake-token");
  const failures = new Map<string, ApiError[]>();
  const sessions = new Map<string, Parameters<typeof api.startUpload>[0]>();
  const start = vi
    .spyOn(api, "startUpload")
    .mockImplementation(async (input) => {
      const error = failures.get(input.name)?.shift();
      if (error) throw error;
      sessions.set(input.name, input);
      return {
        id: input.name,
        receivedBytes: 0,
        protocolVersion: 1,
        chunkSizeBytes: 1024,
        completedChunks: [],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
  vi.spyOn(api, "uploadChunk").mockResolvedValue();
  vi.spyOn(api, "completeUpload").mockImplementation(async (id) => {
    const input = sessions.get(id);
    if (!input) throw new Error("Missing fake session");
    return {
      id: `remote-${id}`,
      folderId: input.folderId,
      name: input.name,
      sizeBytes: input.size,
      storageRevision: 1,
      clientModifiedAt: new Date(input.modifiedAt).toISOString(),
    };
  });
  const activity: Activity[] = [];
  const tree = new RemoteTree(store, new Set(["root"]));
  const ctx = {
    api,
    store,
    tree,
    pair: {
      id: root,
      localPath: directory,
      remoteFolderId: "root",
      remoteLabel: "Fake folder",
      mode: "two-way",
    },
    deviceName: "Fake PC",
    ignore: () => false,
    minFreeBytes: 0,
    uploads: new Throttle(null),
    uploadMeter: new UploadMeter(() => {}),
    downloads: new Throttle(null),
    trash: async () => {
      throw new Error("Unexpected trash");
    },
    activity: (update) => activity.push({ ...update }),
    scanned: () => {},
    resolved: vi.fn<(rel: string) => void>(),
    notify: () => {},
    current: () => true,
    signal: new AbortController().signal,
    full: { size: Infinity, message: null as string | null },
  } satisfies PairContext;
  return { ctx, start, failures, store, tree, directory, activity };
};

it.each([
  quota(),
  new ApiError(507, "Staging full", "UPLOAD_STORAGE_CAPACITY_EXCEEDED"),
])("waits for the next pass while the server is full: $code", async (error) => {
  const names = Array.from({ length: 20 }, (_, i) => `f${i + 10}.txt`);
  const r = await rig(names);
  const fake = r.start.getMockImplementation();
  let full = true;
  r.start.mockImplementation(async (input) => {
    if (full) throw error;
    return fake!(input);
  });
  const first = await syncPair(r.ctx);
  expect(r.start.mock.calls.length).toBeGreaterThan(0);
  expect(r.start.mock.calls.length).toBeLessThanOrEqual(4);
  expect(first.retrySoon).toBe(false);
  expect(first.issues).toEqual([
    expect.objectContaining({ rel: "", source: "scan", kind: "quota" }),
  ]);
  expect(r.ctx.resolved).not.toHaveBeenCalled();

  full = false;
  r.ctx.full = { size: Infinity, message: null };
  const second = await syncPair(r.ctx);
  expect(second.issues).toEqual([]);
  expect(r.store.baseEntries(r.ctx.pair.id)).toHaveLength(names.length);
});

it("shows one server-full issue per folder when both limits refuse", async () => {
  const r = await rig(["a.txt", "b.txt"]);
  r.failures.set("a.txt", [quota()]);
  r.failures.set("b.txt", [
    new ApiError(507, "Staging full", "UPLOAD_STORAGE_CAPACITY_EXCEEDED"),
  ]);
  const result = await syncPair(r.ctx);
  expect(result.issues).toEqual([
    expect.objectContaining({ rel: "", kind: "quota" }),
  ]);
});

it("keeps uploading smaller files and downloading while the server is full", async () => {
  const r = await rig(["small.txt"]);
  const big = path.join(r.directory, "big.bin");
  await writeFile(big, Buffer.alloc(10_000));
  const old = new Date(Date.now() - 60_000);
  await utimes(big, old, old);
  const fake = r.start.getMockImplementation();
  r.start.mockImplementation(async (input) => {
    if (input.size > 100) throw quota();
    return fake!(input);
  });
  const bytes = Buffer.from("from the server");
  r.tree.set({
    id: "down",
    type: "file",
    parentId: "root",
    name: "down.txt",
    size: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    rev: 1,
    modifiedAt: null,
  });
  vi.spyOn(r.ctx.api, "download").mockImplementation(async () =>
    new Blob([bytes]).stream(),
  );
  const result = await syncPair(r.ctx);
  expect(
    r.start.mock.calls.filter(([input]) => input.name === "big.bin"),
  ).toHaveLength(1);
  expect(result.retrySoon).toBe(false);
  expect(result.issues).toEqual([
    expect.objectContaining({
      rel: "",
      kind: "quota",
      message:
        "Your storage on the server is full. Uploads wait until there is space.",
    }),
  ]);
  const synced = r.store.baseEntries(r.ctx.pair.id).map((entry) => entry.rel);
  expect(synced.sort()).toEqual(["down.txt", "small.txt"]);
  expect(await readFile(path.join(r.directory, "down.txt"))).toEqual(bytes);
});

it("stops an unchanged failed plan and retries it in the next pass", async () => {
  const r = await rig(["a.txt"]);
  r.failures.set("a.txt", [new ApiError(500, "Server error")]);
  const first = await syncPair(r.ctx);
  expect(first.retrySoon).toBe(true);
  expect(first.issues).toEqual([
    expect.objectContaining({
      rel: "a.txt",
      source: "operation",
      kind: "error",
    }),
  ]);
  expect(r.start).toHaveBeenCalledTimes(1);
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  expect((await syncPair(r.ctx)).issues).toEqual([]);
  expect(r.start).toHaveBeenCalledTimes(2);
  expect(r.ctx.resolved).toHaveBeenCalledWith("a.txt");
});

it("keeps another file's latest failure after one file recovers", async () => {
  const r = await rig(["a.txt", "b.txt", "c.txt"]);
  r.failures.set("a.txt", [new ApiError(500, "Server error")]);
  r.failures.set("b.txt", [
    new ApiError(500, "Server error"),
    new ApiError(500, "Still broken"),
    new ApiError(500, "Still broken"),
  ]);
  const result = await syncPair(r.ctx);
  expect(result.issues).toEqual([
    expect.objectContaining({
      rel: "b.txt",
      source: "operation",
      kind: "error",
      message: "Still broken",
    }),
  ]);
  expect(r.ctx.resolved).toHaveBeenCalledWith("a.txt");
  expect(r.ctx.resolved).not.toHaveBeenCalledWith("b.txt");
});

it("does not resolve an upload that is still being written", async () => {
  const r = await rig(["a.txt"]);
  await utimes(path.join(r.directory, "a.txt"), new Date(), new Date());
  expect((await syncPair(r.ctx)).retrySoon).toBe(true);
  expect(r.start).not.toHaveBeenCalled();
  expect(r.ctx.resolved).not.toHaveBeenCalled();
});

it("keeps an unreadable file's issue without resolving it", async () => {
  const r = await rig(["a.txt"]);
  vi.spyOn(local, "hashFile").mockRejectedValue(
    Object.assign(new Error("Locked"), { code: "EACCES", syscall: "open" }),
  );
  expect((await syncPair(r.ctx)).issues).toEqual([
    expect.objectContaining({ rel: "a.txt", kind: "error" }),
  ]);
  expect(r.ctx.resolved).not.toHaveBeenCalled();
});

it("does not resolve an upload when saving sync history fails", async () => {
  const r = await rig(["a.txt"]);
  vi.spyOn(r.store, "putBase").mockImplementation(() => {
    throw new Error("Database write failed");
  });
  await expect(syncPair(r.ctx)).rejects.toThrow("Database write failed");
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  expect(r.activity.at(-1)?.state).toBe("failed");
});

it("clears a download error only after writing and saving the checked copy", async () => {
  const r = await rig([]);
  const bytes = Buffer.from("fake download");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  for (const name of ["a.txt", "b.txt"])
    r.tree.set({
      id: name,
      type: "file",
      parentId: "root",
      name,
      size: bytes.length,
      checksum,
      rev: 1,
      modifiedAt: null,
    });
  const download = vi
    .spyOn(r.ctx.api, "download")
    .mockImplementation(async () => new Blob([bytes]).stream());
  download.mockImplementationOnce(async () => {
    throw new ApiError(507, "Disk full");
  });
  const result = await syncPair(r.ctx);
  expect(result.issues).toEqual([]);
  expect(r.ctx.resolved).toHaveBeenCalledWith("a.txt");
  expect(await readFile(path.join(r.directory, "a.txt"))).toEqual(bytes);
});

it("does not resolve an aborted transfer", async () => {
  const r = await rig(["a.txt"]);
  vi.spyOn(r.ctx.api, "uploadChunk").mockRejectedValue(
    new DOMException("Stopped", "AbortError"),
  );
  await expect(syncPair(r.ctx)).rejects.toMatchObject({ name: "AbortError" });
  expect(r.ctx.resolved).not.toHaveBeenCalled();
});

it("keeps downloads paused when the local free-space limit is reached", async () => {
  const r = await rig([]);
  r.tree.set({
    id: "a",
    type: "file",
    parentId: "root",
    name: "a.txt",
    size: 3,
    checksum: "unused",
    rev: 1,
    modifiedAt: null,
  });
  const result = await syncPair({
    ...r.ctx,
    minFreeBytes: Number.MAX_SAFE_INTEGER,
  });
  expect(result.issues).toEqual([
    expect.objectContaining({ rel: "a.txt", kind: "disk-full" }),
  ]);
  expect(result.retrySoon).toBe(true);
  expect(r.ctx.resolved).not.toHaveBeenCalled();
});

it("preserves a local edit made while a download was running", async () => {
  const r = await rig([]);
  const bytes = Buffer.from("remote copy");
  r.tree.set({
    id: "a",
    type: "file",
    parentId: "root",
    name: "a.txt",
    size: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    rev: 1,
    modifiedAt: null,
  });
  vi.spyOn(r.ctx.api, "download").mockImplementation(async () => {
    await writeFile(path.join(r.directory, "a.txt"), "local edit");
    return new Blob([bytes]).stream();
  });
  let running = true;
  await syncPair({
    ...r.ctx,
    current: () => running,
    activity: (update) => {
      if (update.state === "failed") running = false;
      r.activity.push({ ...update });
    },
  });
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  expect(await readFile(path.join(r.directory, "a.txt"), "utf8")).toBe(
    "local edit",
  );
});
