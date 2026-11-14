import { createHash } from "node:crypto";
import {
  chmod,
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
import { type PairContext, syncPair, type Waiting } from "./pair-sync";
import { RemoteTree } from "./remote";
import { Store } from "./store";
import { LANES, SMALL_UPLOAD_BYTES, Throttle, UploadMeter } from "./transfer";

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
  const start = vi
    .spyOn(api, "uploadSmall")
    .mockImplementation(async (input, body) => {
      const error = failures.get(input.name)?.shift();
      if (error) throw error;
      return {
        id: `remote-${input.name}`,
        folderId: input.folderId,
        name: input.name,
        sizeBytes: body.length,
        storageRevision: 1,
        clientModifiedAt: new Date(input.modifiedAt).toISOString(),
      };
    });
  const activity: Activity[] = [];
  const waiting: Waiting[] = [];
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
    waiting: (each) => waiting.push(each),
    scanned: () => {},
    resolved: vi.fn<(rel: string) => void>(),
    notify: () => {},
    log: vi.fn<(stage: string, error: unknown) => void>(),
    current: () => true,
    signal: new AbortController().signal,
    full: { size: Infinity, message: null as string | null },
  } satisfies PairContext;
  return { ctx, start, failures, store, tree, directory, activity, waiting };
};

it.each([
  quota(),
  new ApiError(507, "Staging full", "UPLOAD_STORAGE_CAPACITY_EXCEEDED"),
])("waits for the next pass while the server is full: $code", async (error) => {
  const names = Array.from({ length: 20 }, (_, i) => `f${i + 10}.txt`);
  const r = await rig(names);
  const fake = r.start.getMockImplementation();
  let full = true;
  r.start.mockImplementation(async (...args) => {
    if (full) throw error;
    return fake!(...args);
  });
  const first = await syncPair(r.ctx);
  expect(r.start.mock.calls.length).toBeGreaterThan(0);
  expect(r.start.mock.calls.length).toBeLessThanOrEqual(LANES.smallUploads);
  expect(first.retrySoon).toBe(false);
  expect(first.issues).toEqual([
    expect.objectContaining({ rel: "", source: "scan", kind: "quota" }),
  ]);
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  // Tried again on its own: waiting, with the server's reason in the log.
  expect(r.activity.at(-1)?.state).toBe("waiting");
  expect(r.ctx.log).toHaveBeenCalledWith(
    expect.stringMatching(/^the server refused f\d+\.txt$/),
    error,
  );

  full = false;
  r.ctx.full = { size: Infinity, message: null };
  const second = await syncPair(r.ctx);
  expect(second.issues).toEqual([]);
  expect(r.store.baseEntries(r.ctx.pair.id)).toHaveLength(names.length);
});

it("reports every planned transfer until it starts, not just the running ones", async () => {
  const names = Array.from({ length: 20 }, (_, i) => `f${i + 10}.txt`);
  const r = await rig(names);
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
  await syncPair(r.ctx);
  const uploadBytes = names.join("").length;
  expect(r.waiting[0]).toEqual({
    files: 21,
    bytes: uploadBytes + bytes.length,
    uploadBytes,
  });
  expect(r.waiting.at(-1)).toEqual({ files: 0, bytes: 0, uploadBytes: 0 });
  const files = r.waiting.map((each) => each.files);
  // Only goes down as transfers start.
  expect(files.slice(1).every((count, i) => count <= files[i]!)).toBe(true);
});

it("leaves a skipped path alone on both sides and syncs the rest", async () => {
  const r = await rig(["a.txt"]);
  await mkdir(path.join(r.directory, "Raw"));
  await writeFile(path.join(r.directory, "Raw", "mine.txt"), "mine");
  r.tree.set({
    id: "raw",
    type: "folder",
    parentId: "root",
    name: "Raw",
    size: null,
    checksum: null,
    rev: 1,
    modifiedAt: null,
  });
  r.tree.set({
    id: "theirs",
    type: "file",
    parentId: "raw",
    name: "theirs.txt",
    size: 6,
    checksum: createHash("sha256").update("theirs").digest("hex"),
    rev: 1,
    modifiedAt: null,
  });
  const download = vi.spyOn(r.ctx.api, "download");
  const ctx = { ...r.ctx, pair: { ...r.ctx.pair, skipPaths: ["Raw"] } };
  const result = await syncPair(ctx);
  expect(result.issues).toEqual([]);
  expect(r.start.mock.calls.map(([input]) => input.name)).toEqual(["a.txt"]);
  expect(download).not.toHaveBeenCalled();
  expect(r.store.baseEntries(ctx.pair.id).map((entry) => entry.rel)).toEqual([
    "a.txt",
  ]);
  expect(
    await readFile(path.join(r.directory, "Raw", "mine.txt"), "utf8"),
  ).toBe("mine");
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
  r.start.mockImplementation(async (input, body, onBytes) => {
    if (body.length > 100) throw quota();
    return fake!(input, body, onBytes);
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

it("waits without an issue while the server has too many uploads open", async () => {
  const r = await rig(["a.txt"]);
  r.failures.set("a.txt", [
    new ApiError(429, "Too many", "RESUMABLE_USER_SESSION_LIMIT_EXCEEDED"),
  ]);
  const first = await syncPair(r.ctx);
  expect(first).toMatchObject({ retrySoon: true, issues: [] });
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  expect((await syncPair(r.ctx)).issues).toEqual([]);
  expect(r.ctx.resolved).toHaveBeenCalledWith("a.txt");
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

it("shows the server's upload limit in the file issue and clears it after retry", async () => {
  const r = await rig(["a.txt"]);
  const message = "This file exceeds the server's 10.0 GB upload limit.";
  r.failures.set("a.txt", [
    new ApiError(413, message, "UPLOAD_SIZE_LIMIT_EXCEEDED"),
  ]);
  const first = await syncPair(r.ctx);
  expect(first.issues).toEqual([
    expect.objectContaining({ rel: "a.txt", kind: "error", message }),
  ]);
  expect(r.ctx.resolved).not.toHaveBeenCalled();
  expect((await syncPair(r.ctx)).issues).toEqual([]);
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

// Root and Windows can read a file whose mode bits forbid it.
it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "keeps an unreadable file's issue without resolving it",
  async () => {
    const r = await rig(["a.txt"]);
    await chmod(path.join(r.directory, "a.txt"), 0o000);
    expect((await syncPair(r.ctx)).issues).toEqual([
      expect.objectContaining({ rel: "a.txt", kind: "error" }),
    ]);
    expect(r.start).not.toHaveBeenCalled();
    expect(r.ctx.resolved).not.toHaveBeenCalled();
  },
);

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
  r.start.mockRejectedValue(new DOMException("Stopped", "AbortError"));
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

it("stops promptly when paused with a large queue", async () => {
  const r = await rig([]);
  const count = 100_000;
  vi.spyOn(local, "scanLocal").mockResolvedValue({
    entries: Array.from({ length: count }, (_, i) => ({
      rel: `node_modules/f${i}.js`,
      type: "file" as const,
      size: 1,
      mtimeMs: Date.now() - 60_000,
      ino: String(i + 1),
    })),
    excluded: [],
  });
  // Paused as soon as the queue is planned.
  let paused = false;
  const started = performance.now();
  await syncPair({
    ...r.ctx,
    current: () => !paused,
    waiting: (each) => {
      r.waiting.push(each);
      paused = true;
    },
  });
  // Was minutes for a few hundred thousand files, with the engine frozen.
  expect(performance.now() - started).toBeLessThan(3000);
  expect(r.waiting[0]?.files).toBe(count);
  expect(r.waiting.at(-1)?.files).toBe(0);
  expect(r.start).not.toHaveBeenCalled();
});

it("says the server is checking only once the app has read the whole file", async () => {
  const r = await rig([]);
  const size = SMALL_UPLOAD_BYTES + 1;
  await writeFile(path.join(r.directory, "big.bin"), Buffer.alloc(size));
  const old = new Date(Date.now() - 60_000);
  await utimes(path.join(r.directory, "big.bin"), old, old);
  // A resumed session the server already has in full: progress is 100% at
  // once, but the app still reads the file for its checksum.
  vi.spyOn(r.ctx.api, "startUpload").mockResolvedValue({
    id: "session",
    chunkSizeBytes: size,
    completedChunks: [{ startByte: 0 }],
    receivedBytes: size,
  } as never);
  let atCheck: Activity | undefined;
  vi.spyOn(r.ctx.api, "completeUpload").mockImplementation(async () => {
    atCheck = r.activity.at(-1);
    return {
      id: "remote-big",
      folderId: "root",
      name: "big.bin",
      sizeBytes: size,
      storageRevision: 1,
      clientModifiedAt: old.toISOString(),
    } as never;
  });

  await syncPair(r.ctx);

  const full = r.activity.filter((each) => each.doneBytes === size);
  expect(full[0]?.checking).toBeUndefined();
  expect(atCheck).toMatchObject({ rel: "big.bin", checking: true });
});

it("shows an upload stopped by a pause as waiting, not failed", async () => {
  const r = await rig(["a.txt"]);
  const pause = new AbortController();
  r.start.mockImplementation(async () => {
    pause.abort();
    throw new DOMException("The operation was aborted.", "AbortError");
  });

  await syncPair({ ...r.ctx, signal: pause.signal }).catch(() => {});

  expect(r.activity.at(-1)).toMatchObject({ rel: "a.txt", state: "waiting" });
  expect(r.ctx.log).not.toHaveBeenCalled();
});
