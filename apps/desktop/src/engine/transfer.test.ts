import { describe, expect, it, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { statLocal, UNKNOWN_INO } from "./local";
import {
  pool,
  SMALL_UPLOAD_BYTES,
  Throttle,
  UploadMeter,
  uploadFile,
} from "./transfer";

it("combines uploads, drops to zero when stalled, and clears after the last upload", () => {
  vi.useFakeTimers();
  try {
    const changed = vi.fn();
    const meter = new UploadMeter(changed);
    const first = meter.start(5000);
    const second = meter.start(3000);
    first.completed(1000);
    second.completed(500);
    expect(meter.remaining).toBe(6500);
    meter.add(2048);
    vi.advanceTimersByTime(1000);
    expect(meter.speed).toBe(2048);
    first.finish();
    expect(meter.remaining).toBe(2500);
    expect(meter.speed).not.toBeNull();
    vi.advanceTimersByTime(6000);
    expect(meter.speed).toBe(0);
    second.finish();
    expect(meter.remaining).toBe(0);
    expect(meter.speed).toBeNull();
    expect(changed).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("excludes resumed bytes and repeated retry bytes from remaining upload work", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "staaash-upload-meter-"));
  try {
    const file = path.join(dir, "demo");
    const size = SMALL_UPLOAD_BYTES + 4;
    await writeFile(file, Buffer.alloc(size));
    const { mtimeMs, ino } = (await statLocal(dir, "demo"))!;
    const meter = new UploadMeter(() => {});
    const api = {
      uploadStatus: async () => ({
        id: "session",
        chunkSizeBytes: SMALL_UPLOAD_BYTES,
        completedChunks: [{ startByte: 0 }],
        receivedBytes: SMALL_UPLOAD_BYTES,
      }),
      uploadChunk: async (
        _id: string,
        _start: number,
        _body: Buffer,
        _total: number,
        onBytes: (bytes: number, offset: number) => void,
      ) => {
        expect(meter.remaining).toBe(4);
        onBytes(2, 2);
        expect(meter.remaining).toBe(2);
        onBytes(2, 2);
        expect(meter.remaining).toBe(2);
        onBytes(2, 4);
        expect(meter.remaining).toBe(0);
      },
      completeUpload: vi.fn(async () => ({})),
    };
    const store = {
      pendingUpload: () => ({
        sessionId: "session",
        size,
        mtimeMs,
        target: JSON.stringify(["folder", "demo", false]),
      }),
      deleteUpload: () => {},
    };
    await uploadFile({
      api: api as never,
      store: store as never,
      pairId: "pair",
      rel: "demo",
      file,
      folderId: "folder",
      name: "demo",
      size,
      mtimeMs,
      ino,
      replace: null,
      throttle: new Throttle(null),
      meter,
      onBytes: () => {},
      signal: new AbortController().signal,
    });
    expect(meter.speed).toBeNull();
    // The resumed chunk is not sent again, but it is part of the checksum.
    expect(api.completeUpload).toHaveBeenCalledWith(
      "session",
      sha256(Buffer.alloc(size)),
      null,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

describe("pool", () => {
  it("reports the first error, stops queued items, and waits for running ones", async () => {
    const started: number[] = [];
    const abort = new AbortController();
    let cleanedUp = false;
    const running = pool(
      [{ items: [1, 2, 3, 4, 5, 6], size: 4 }],
      async (item) => {
        started.push(item);
        if (item === 2) throw new Error("network down");
        if (item > 4) return;
        // A long transfer: it only ends when aborted, then cleans up.
        await new Promise((_resolve, reject) => {
          abort.signal.addEventListener("abort", () =>
            setTimeout(() => {
              cleanedUp = true;
              reject(new Error("aborted"));
            }, 10),
          );
        });
      },
      () => abort.abort(),
    );
    await expect(running).rejects.toThrow("network down");
    expect(cleanedUp).toBe(true);
    expect(started).toEqual([1, 2, 3, 4]);
  });

  it("runs everything when nothing fails", async () => {
    const seen: number[] = [];
    await pool(
      [{ items: [1, 2, 3, 4, 5, 6], size: 4 }],
      async (item) => {
        seen.push(item);
      },
      () => {
        throw new Error("not fatal");
      },
    );
    expect(seen).toHaveLength(6);
  });

  it("runs lanes side by side, each up to its own size", async () => {
    const running = { a: 0, b: 0 };
    const most = { a: 0, b: 0 };
    const items = (lane: "a" | "b", count: number) =>
      Array.from({ length: count }, () => lane);
    await pool(
      [
        { items: items("a", 10), size: 2 },
        { items: items("b", 10), size: 5 },
      ],
      async (lane) => {
        running[lane] += 1;
        most[lane] = Math.max(most[lane], running[lane]);
        // Both lanes have work in flight at once.
        await new Promise((resolve) => setTimeout(resolve, 5));
        running[lane] -= 1;
      },
      () => {},
    );
    expect(most).toEqual({ a: 2, b: 5 });
  });
});

describe("uploadFile", () => {
  const base = async (size: number) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "staaash-upload-"));
    const file = path.join(dir, "notes.txt");
    await writeFile(file, Buffer.alloc(size, 7));
    const { mtimeMs, ino } = (await statLocal(dir, "notes.txt"))!;
    return {
      dir,
      input: {
        pairId: "pair",
        rel: "notes.txt",
        file,
        folderId: "folder",
        name: "notes.txt",
        size,
        mtimeMs,
        ino,
        throttle: new Throttle(null),
        meter: new UploadMeter(() => {}),
        onBytes: () => {},
        signal: new AbortController().signal,
      },
    };
  };

  it("sends a small file in one request and drops an old session", async () => {
    const { dir, input } = await base(5);
    try {
      const uploadSmall = vi.fn(
        async (
          _input: unknown,
          body: Buffer,
          onBytes: (bytes: number, offset: number) => void,
        ) => {
          // Form framing makes the request longer than the file.
          onBytes(3, 3);
          onBytes(body.length + 200, body.length + 203);
          return { id: "remote" };
        },
      );
      const shown = vi.fn<(bytes: number) => void>();
      const cancelUpload = vi.fn(async () => ({}));
      const deleteUpload = vi.fn();
      const result = await uploadFile({
        ...input,
        onBytes: shown,
        api: { uploadSmall, cancelUpload } as never,
        store: {
          pendingUpload: () => ({ sessionId: "old" }),
          deleteUpload,
        } as never,
        replace: { id: "file-1", rev: 3 },
      });
      const checksum = sha256(Buffer.alloc(5, 7));
      expect(result).toEqual({ file: { id: "remote" }, checksum });
      expect(uploadSmall).toHaveBeenCalledWith(
        {
          folderId: "folder",
          name: "notes.txt",
          checksum,
          modifiedAt: input.mtimeMs,
          replace: { id: "file-1", rev: 3 },
        },
        Buffer.alloc(5, 7),
        expect.any(Function),
      );
      expect(shown.mock.calls).toEqual([[3], [2]]);
      expect(cancelUpload).toHaveBeenCalledWith("old");
      expect(deleteUpload).toHaveBeenCalledWith("pair", "notes.txt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops waiting chunks as soon as one chunk fails", async () => {
    const chunk = 1024 * 1024;
    const { dir, input } = await base(SMALL_UPLOAD_BYTES + 8 * chunk);
    try {
      const sent: number[] = [];
      const api = {
        startUpload: async () => ({
          id: "session",
          chunkSizeBytes: chunk,
          completedChunks: [],
          receivedBytes: 0,
        }),
        uploadChunk: async (_id: string, start: number) => {
          sent.push(start);
          throw new Error("network down");
        },
      };
      const started = Date.now();
      await expect(
        uploadFile({
          ...input,
          // Slow enough that the other chunks would wait for minutes.
          throttle: new Throttle(1),
          api: api as never,
          store: {
            pendingUpload: () => null,
            putUpload: () => {},
          } as never,
          replace: null,
        }),
      ).rejects.toThrow("network down");
      expect(Date.now() - started).toBeLessThan(5000);
      expect(sent).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not finish an upload when the file changes while it is read", async () => {
    const chunk = 1024 * 1024;
    const { dir, input } = await base(SMALL_UPLOAD_BYTES + 8 * chunk);
    try {
      const completeUpload = vi.fn();
      const api = {
        startUpload: async () => ({
          id: "session",
          chunkSizeBytes: chunk,
          completedChunks: [],
          receivedBytes: 0,
        }),
        uploadChunk: async (_id: string, start: number) => {
          // Same size, one new byte: only the time shows the edit.
          if (start !== 0) return;
          const edit = await open(input.file, "r+");
          await edit.write(Buffer.from([9]), 0, 1, input.size - 1);
          await edit.close();
        },
        completeUpload,
      };
      await expect(
        uploadFile({
          ...input,
          api: api as never,
          store: { pendingUpload: () => null, putUpload: () => {} } as never,
          replace: null,
        }),
      ).rejects.toThrow("The file changed while it was uploading.");
      expect(completeUpload).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sends nothing from a file swapped in since the scan", async () => {
    const chunk = 1024 * 1024;
    const { dir, input } = await base(SMALL_UPLOAD_BYTES + 8 * chunk);
    try {
      // Another file with the same size and time takes its place.
      const when = new Date(1_700_000_000_000);
      await utimes(input.file, when, when);
      const scanned = (await statLocal(dir, "notes.txt"))!;
      const other = path.join(dir, "other");
      await writeFile(other, Buffer.alloc(input.size, 9));
      await utimes(other, when, when);
      await rename(other, input.file);
      const swapped = (await statLocal(dir, "notes.txt"))!;
      expect(swapped.mtimeMs).toBe(scanned.mtimeMs);
      expect(swapped.ino).not.toBe(scanned.ino);
      const uploadChunk = vi.fn();
      await expect(
        uploadFile({
          ...input,
          mtimeMs: scanned.mtimeMs,
          ino: scanned.ino,
          api: {
            startUpload: async () => ({
              id: "session",
              chunkSizeBytes: chunk,
              completedChunks: [],
              receivedBytes: 0,
            }),
            uploadChunk,
          } as never,
          store: { pendingUpload: () => null, putUpload: () => {} } as never,
          replace: null,
        }),
      ).rejects.toThrow("The file changed while it was uploading.");
      expect(uploadChunk).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Making links on Windows needs extra rights, and it has no flag to refuse them.
  it.skipIf(process.platform === "win32")(
    "sends nothing through a link swapped in on a disk with no file ids",
    async () => {
      for (const size of [5, SMALL_UPLOAD_BYTES + 1024]) {
        const { dir, input } = await base(size);
        try {
          const outside = path.join(dir, "outside");
          await writeFile(outside, Buffer.alloc(size, 9));
          await rm(input.file);
          await symlink(outside, input.file);
          const target = (await statLocal(dir, "outside"))!;
          const uploadSmall = vi.fn();
          const uploadChunk = vi.fn();
          await expect(
            uploadFile({
              ...input,
              // The link's target matches in everything a disk without ids can show.
              mtimeMs: target.mtimeMs,
              ino: UNKNOWN_INO,
              api: {
                uploadSmall,
                uploadChunk,
                startUpload: async () => ({
                  id: "session",
                  chunkSizeBytes: SMALL_UPLOAD_BYTES,
                  completedChunks: [],
                  receivedBytes: 0,
                }),
              } as never,
              store: {
                pendingUpload: () => null,
                putUpload: () => {},
              } as never,
              replace: null,
            }),
          ).rejects.toMatchObject({ code: "ELOOP" });
          expect(uploadSmall).not.toHaveBeenCalled();
          expect(uploadChunk).not.toHaveBeenCalled();
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    },
  );

  it("sends a big file's chunks a few at a time with the checksum of what it sent", async () => {
    const chunk = 1024 * 1024;
    const { dir, input } = await base(SMALL_UPLOAD_BYTES + 8 * chunk);
    try {
      let running = 0;
      let most = 0;
      const sent: number[] = [];
      const api = {
        startUpload: async () => ({
          id: "session",
          chunkSizeBytes: chunk,
          completedChunks: [],
          receivedBytes: 0,
        }),
        uploadChunk: async (_id: string, start: number) => {
          running += 1;
          most = Math.max(most, running);
          // Held until three are in flight, so a slow disk read in a busy
          // test run cannot hide the limit.
          const total = input.size / chunk;
          for (let tries = 0; tries < 400; tries += 1) {
            if (running >= 3 || sent.length + running >= total) break;
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          sent.push(start);
          running -= 1;
        },
        completeUpload: vi.fn(async () => ({ id: "remote" })),
      };
      const result = await uploadFile({
        ...input,
        api: api as never,
        store: {
          pendingUpload: () => null,
          putUpload: () => {},
          deleteUpload: () => {},
        } as never,
        replace: null,
      });
      expect(most).toBe(3);
      expect(sent).toHaveLength(input.size / chunk);
      const checksum = sha256(Buffer.alloc(input.size, 7));
      expect(api.completeUpload).toHaveBeenCalledWith(
        "session",
        checksum,
        null,
      );
      expect(result).toEqual({ file: { id: "remote" }, checksum });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("ends a throttle wait as soon as the signal aborts", async () => {
  const throttle = new Throttle(1);
  const abort = new AbortController();
  await throttle.take(10 * 1024 * 1024, abort.signal);
  const waiting = throttle.take(1024, abort.signal);
  abort.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
});

it("gives back the time reserved by a cancelled wait", async () => {
  const throttle = new Throttle(1024);
  const abort = new AbortController();
  await throttle.take(50 * 1024, abort.signal);
  const cancelled = throttle.take(100 * 1024 * 1024, abort.signal);
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const started = Date.now();
  await throttle.take(1024, new AbortController().signal);
  expect(Date.now() - started).toBeLessThan(5000);
});

it("keeps the cost of received bytes after a cancelled wait", async () => {
  const throttle = new Throttle(1024);
  const abort = new AbortController();
  await throttle.take(50 * 1024, abort.signal, true);
  const cancelled = throttle.take(100 * 1024 * 1024, abort.signal, true);
  abort.abort();
  await expect(cancelled).rejects.toThrow();
  const next = new AbortController();
  const waiting = throttle.take(1024, next.signal, true);
  await expect(
    Promise.race([
      waiting,
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 200)),
    ]),
  ).resolves.toBe("waiting");
  next.abort();
  await expect(waiting).rejects.toThrow();
});
