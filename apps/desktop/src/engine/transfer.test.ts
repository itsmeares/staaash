import { describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pool, Throttle, UploadMeter, uploadFile } from "./transfer";

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
    await writeFile(file, "abcdefgh");
    const meter = new UploadMeter(() => {});
    const api = {
      uploadStatus: async () => ({
        id: "session",
        chunkSizeBytes: 4,
        completedChunks: [{ startByte: 0 }],
        receivedBytes: 4,
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
      completeUpload: async () => ({}),
    };
    const store = {
      pendingUpload: () => ({
        sessionId: "session",
        checksum: "hash",
        size: 8,
        mtimeMs: 1,
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
      checksum: "hash",
      size: 8,
      mtimeMs: 1,
      replace: null,
      throttle: new Throttle(null),
      meter,
      onBytes: () => {},
      signal: new AbortController().signal,
    });
    expect(meter.speed).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("pool", () => {
  it("reports the first error, stops queued items, and waits for running ones", async () => {
    const started: number[] = [];
    const abort = new AbortController();
    let cleanedUp = false;
    const running = pool(
      [1, 2, 3, 4, 5, 6],
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
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        seen.push(item);
      },
      () => {
        throw new Error("not fatal");
      },
    );
    expect(seen).toHaveLength(6);
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
