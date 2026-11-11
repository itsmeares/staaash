import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  type FileHandle,
  open,
  rename,
  rm,
  statfs,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { UploadRateTracker } from "@/lib/transfers/upload-progress";

import type { Api } from "./api";
import { ApiError } from "./api";
import { mtimeMsOf } from "./local";
import { TEMP_PREFIX } from "./names";
import type { PendingUpload, Store } from "./store";

/** Spreads bytes over time so a limit in KB/s holds on average. */
export class Throttle {
  private nextFree = 0;

  constructor(public limitKBps: number | null) {}

  /** `received` bytes already used the network, so a cancel keeps their cost. */
  async take(bytes: number, signal: AbortSignal, received = false) {
    if (!this.limitKBps) return;
    const now = Date.now();
    const start = Math.max(now, this.nextFree);
    const cost = (bytes / (this.limitKBps * 1024)) * 1000;
    this.nextFree = start + cost;
    if (start === now) return;
    try {
      await sleep(start - now, undefined, { signal });
    } catch (error) {
      // Unsent bytes never use the network, so later transfers must not wait.
      if (!received) this.nextFree -= cost;
      throw error;
    }
  }
}

export class UploadMeter {
  private readonly active = new Set<{ remaining: number }>();
  private bytes = 0;
  private tracker = new UploadRateTracker();
  private timer: NodeJS.Timeout | null = null;
  speed: number | null = null;

  constructor(private readonly changed: () => void) {}

  get remaining() {
    return Array.from(this.active).reduce(
      (sum, upload) => sum + upload.remaining,
      0,
    );
  }

  start(size: number) {
    const upload = { remaining: size };
    this.active.add(upload);
    if (this.active.size === 1) {
      this.bytes = 0;
      this.tracker = new UploadRateTracker();
      this.speed = 0;
      this.timer = setInterval(() => {
        this.speed = this.tracker.record(this.bytes);
        this.changed();
      }, 1000);
      this.changed();
    }
    return {
      completed: (bytes: number) => {
        upload.remaining = Math.max(0, upload.remaining - bytes);
      },
      finish: () => {
        this.active.delete(upload);
        if (this.active.size === 0) {
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.speed = null;
        }
        this.changed();
      },
    };
  }

  add(bytes: number) {
    this.bytes += bytes;
  }
}

/** Up to one session chunk: one request, no session, nothing to resume. */
export const SMALL_UPLOAD_BYTES = 10 * 1024 * 1024;
// A big file sends a few chunks at once, so a handful of them fill the line.
// Small files hold no upload session, so many more can go at once.
export const LANES = { downloads: 4, bigUploads: 4, smallUploads: 16 };
const CHUNKS_AT_ONCE = 3;

/**
 * Runs `work` over the items of each lane, up to its size at a time, all
 * lanes together. The first error stops queued items and calls `onFatal`,
 * which ends the running ones. The pool settles only when no worker is still
 * writing, then rethrows that first error.
 */
export const pool = async <T>(
  lanes: { items: T[]; size: number }[],
  work: (item: T) => Promise<void>,
  onFatal: () => void,
) => {
  let failure: { error: unknown } | null = null;
  await Promise.all(
    lanes.flatMap(({ items, size }) => {
      let next = 0;
      return Array.from({ length: Math.min(size, items.length) }, async () => {
        try {
          while (!failure && next < items.length) await work(items[next++]);
        } catch (error) {
          if (failure) return;
          failure = { error };
          onFatal();
        }
      });
    }),
  );
  if (failure) throw (failure as { error: unknown }).error;
};

export const freeBytes = async (dir: string) => {
  const stats = await statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
};

/**
 * Downloads to a temporary file beside the target and checks it before the
 * caller moves it into place, so a cut-off download never replaces a file.
 * Returns the temporary path; the caller renames or removes it.
 */
export const downloadToTemp = async (input: {
  api: Api;
  fileId: string;
  target: string;
  checksum: string | null;
  size: number | null;
  modifiedAt: number | null;
  throttle: Throttle;
  onBytes: (bytes: number) => void;
  signal: AbortSignal;
}) => {
  const temp = path.join(
    path.dirname(input.target),
    `${TEMP_PREFIX}${randomUUID()}`,
  );
  const hash = createHash("sha256");
  let received = 0;
  let out: ReturnType<typeof createWriteStream> | null = null;
  try {
    const body = await input.api.download(input.fileId, input.signal);
    await pipeline(
      Readable.fromWeb(body as never),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          received += chunk.length;
          input.onBytes(chunk.length);
          input.throttle
            .take(chunk.length, input.signal, true)
            .then(() => done(null, chunk), done);
        },
      }),
      (out = createWriteStream(temp, { flush: true })),
      { signal: input.signal },
    );
    const digest = hash.digest("hex");
    if (input.checksum ? digest !== input.checksum : received !== input.size) {
      throw new ApiError(0, "The download did not match the server's copy.");
    }
    if (input.modifiedAt !== null) {
      const when = new Date(input.modifiedAt);
      await utimes(temp, when, when);
    }
    return { temp, checksum: digest };
  } catch (error) {
    // The stream opens its file in the background; an abort can land
    // before that, so wait for it to close or the file appears after rm.
    const stream = out as ReturnType<typeof createWriteStream> | null;
    if (stream && !stream.closed) {
      await new Promise<void>((resolve) => stream.once("close", resolve));
    }
    await rm(temp, { force: true });
    throw error;
  }
};

/** Replaces `target` with the checked temporary file in one rename. */
export const moveIntoPlace = async (temp: string, target: string) => {
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

/**
 * Sends a file through a resumable upload session. A session survives an app
 * restart: the store remembers it, and only the missing chunks are sent.
 * The file is read once, in order, and hashed on the way; the server checks
 * that checksum before it keeps the file. Returns the committed file.
 */
// Resume, restart and chunk send share one session.
// fallow-ignore-next-line complexity
const sendFile = async (
  input: {
    api: Api;
    store: Store;
    pairId: string;
    rel: string;
    file: string;
    folderId: string;
    name: string;
    size: number;
    mtimeMs: number;
    /** The server file this upload replaces, as the plan last saw it. */
    replace: { id: string; rev: number } | null;
    throttle: Throttle;
    meter: UploadMeter;
    onBytes: (bytes: number) => void;
    signal: AbortSignal;
  },
  completed: (bytes: number) => void,
) => {
  const { api, store } = input;
  // A session commits to the folder, name and replace choice it was started
  // with, so it is only reused for exactly that.
  const target = JSON.stringify([
    input.folderId,
    input.name,
    input.replace !== null,
  ]);
  let pending: PendingUpload | null = store.pendingUpload(
    input.pairId,
    input.rel,
  );
  if (
    pending &&
    (pending.size !== input.size ||
      pending.mtimeMs !== input.mtimeMs ||
      pending.target !== target)
  ) {
    // The file or the upload changed since: the staged bytes are useless.
    await api.cancelUpload(pending.sessionId).catch(() => {});
    store.deleteUpload(input.pairId, input.rel);
    pending = null;
  }
  let session: Awaited<ReturnType<Api["startUpload"]>> | null = null;
  if (pending) {
    try {
      session = await api.uploadStatus(pending.sessionId);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      store.deleteUpload(input.pairId, input.rel);
    }
  }
  if (!session) {
    session = await api.startUpload({
      folderId: input.folderId,
      name: input.name,
      size: input.size,
      modifiedAt: input.mtimeMs,
      replace: input.replace !== null,
    });
    store.putUpload({
      pairId: input.pairId,
      rel: input.rel,
      sessionId: session.id,
      size: input.size,
      mtimeMs: input.mtimeMs,
      target,
    });
  }
  const chunkSize = session.chunkSizeBytes ?? input.size;
  const done = new Set(session.completedChunks.map((chunk) => chunk.startByte));
  input.onBytes(session.receivedBytes);
  completed(session.receivedBytes);
  const hash = createHash("sha256");
  const handle = await open(input.file, "r");
  // A failed chunk stops the rest, even those waiting on the speed limit.
  // Sent chunks stay, so a retry sends only what is missing.
  const stop = new AbortController();
  const signal = AbortSignal.any([input.signal, stop.signal]);
  const sending = new Set<Promise<void>>();
  let failure: { error: unknown } | null = null;
  const fail = (error: unknown) => {
    failure ??= { error };
    stop.abort();
  };
  try {
    // One reader in file order, so a hard disk reads without seeking between
    // chunks. Chunks the server already has are read only for the checksum.
    for (let start = 0; start < input.size && !failure; start += chunkSize) {
      signal.throwIfAborted();
      const length = Math.min(chunkSize, input.size - start);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      if (bytesRead !== length) {
        throw new ApiError(0, "The file changed while it was uploading.");
      }
      hash.update(buffer);
      if (done.has(start)) continue;
      while (sending.size >= CHUNKS_AT_ONCE) await Promise.race(sending);
      if (failure) break;
      await input.throttle.take(length, signal);
      const send: Promise<void> = api
        .uploadChunk(
          session.id,
          start,
          buffer,
          input.size,
          progress(input, completed),
        )
        .then(() => input.onBytes(length), fail)
        .finally(() => sending.delete(send));
      sending.add(send);
    }
    if (!failure) await assertUnchanged(handle, input);
  } catch (error) {
    fail(error);
  } finally {
    // Nothing still sending outlives the call, so a retry never overlaps it.
    await Promise.all(sending);
    await handle.close();
  }
  if (failure) throw (failure as { error: unknown }).error;
  const checksum = hash.digest("hex");
  const file = (await api.completeUpload(
    session.id,
    checksum,
    input.replace,
  )) as unknown as UploadedFile;
  store.deleteUpload(input.pairId, input.rel);
  return { file, checksum };
};

type UploadInput = Parameters<typeof sendFile>[0];

/**
 * The checksum is taken from the bytes as they were read, so a file written
 * to meanwhile would reach the server torn. It goes again on the next pass.
 */
const assertUnchanged = async (handle: FileHandle, input: UploadInput) => {
  const stats = await handle.stat({ bigint: true });
  if (Number(stats.size) !== input.size || mtimeMsOf(stats) !== input.mtimeMs) {
    throw new ApiError(0, "The file changed while it was uploading.");
  }
};

/** Counts sent bytes once, even when a retry sends them again. */
const progress = (input: UploadInput, completed: (bytes: number) => void) => {
  let furthest = 0;
  return (bytes: number, offset: number) => {
    input.meter.add(bytes);
    completed(Math.max(0, offset - furthest));
    furthest = Math.max(furthest, offset);
  };
};

/** Sends a small file in one request. A cut-off one starts over. */
const sendSmall = async (
  input: UploadInput,
  completed: (bytes: number) => void,
) => {
  const { api, store } = input;
  // Left by an older app, or from before the file shrank.
  const pending = store.pendingUpload(input.pairId, input.rel);
  if (pending) {
    await api.cancelUpload(pending.sessionId).catch(() => {});
    store.deleteUpload(input.pairId, input.rel);
  }
  const handle = await open(input.file, "r");
  let body: Buffer;
  try {
    body = await handle.readFile();
    await assertUnchanged(handle, input);
  } finally {
    await handle.close();
  }
  const checksum = createHash("sha256").update(body).digest("hex");
  input.signal.throwIfAborted();
  await input.throttle.take(body.length, input.signal);
  const sent = progress(input, completed);
  // The request also carries form framing, so progress stops at the file size.
  let shown = 0;
  const show = (upTo: number) => {
    if (upTo > shown) input.onBytes(upTo - shown);
    shown = Math.max(shown, upTo);
  };
  const file = await api.uploadSmall(
    {
      folderId: input.folderId,
      name: input.name,
      checksum,
      modifiedAt: input.mtimeMs,
      replace: input.replace,
    },
    body,
    (bytes, offset) => {
      sent(bytes, Math.min(offset, body.length));
      show(Math.min(offset, body.length));
    },
  );
  show(body.length);
  return { file: file as unknown as UploadedFile, checksum };
};

/** Sends a file and answers the committed file with the checksum it was sent with. */
export const uploadFile = async (input: UploadInput) => {
  const upload = input.meter.start(input.size);
  try {
    return input.size <= SMALL_UPLOAD_BYTES
      ? await sendSmall(input, upload.completed)
      : await sendFile(input, upload.completed);
  } finally {
    upload.finish();
  }
};

type UploadedFile = {
  id: string;
  folderId: string | null;
  name: string;
  sizeBytes: number;
  storageRevision: number;
  clientModifiedAt: string | null;
};
