import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { open, rename, rm, statfs, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { Api } from "./api";
import { ApiError } from "./api";
import { TEMP_PREFIX } from "./names";
import type { PendingUpload, Store } from "./store";

/** Spreads bytes over time so a limit in KB/s holds on average. */
export class Throttle {
  private nextFree = 0;

  constructor(public limitKBps: number | null) {}

  async take(bytes: number) {
    if (!this.limitKBps) return;
    const now = Date.now();
    const start = Math.max(now, this.nextFree);
    this.nextFree = start + (bytes / (this.limitKBps * 1024)) * 1000;
    if (start > now) await sleep(start - now);
  }
}

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
  try {
    const body = await input.api.download(input.fileId, input.signal);
    await pipeline(
      Readable.fromWeb(body as never),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          received += chunk.length;
          input.onBytes(chunk.length);
          input.throttle.take(chunk.length).then(() => done(null, chunk), done);
        },
      }),
      createWriteStream(temp, { flush: true }),
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
 * Returns the committed file as the server describes it.
 */
// Resume, restart and chunk send share one session.
// fallow-ignore-next-line complexity
export const uploadFile = async (input: {
  api: Api;
  store: Store;
  pairId: string;
  rel: string;
  file: string;
  folderId: string;
  name: string;
  checksum: string;
  size: number;
  mtimeMs: number;
  replace: { rev: number } | null;
  throttle: Throttle;
  onBytes: (bytes: number) => void;
  signal: AbortSignal;
}) => {
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
    (pending.checksum !== input.checksum ||
      pending.size !== input.size ||
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
      checksum: input.checksum,
      modifiedAt: input.mtimeMs,
      replace: input.replace !== null,
    });
    store.putUpload({
      pairId: input.pairId,
      rel: input.rel,
      sessionId: session.id,
      checksum: input.checksum,
      size: input.size,
      mtimeMs: input.mtimeMs,
      target,
    });
  }
  const chunkSize = session.chunkSizeBytes ?? input.size;
  const done = new Set(session.completedChunks.map((chunk) => chunk.startByte));
  input.onBytes(session.receivedBytes);
  const handle = await open(input.file, "r");
  try {
    for (let start = 0; start < input.size; start += chunkSize) {
      if (done.has(start)) continue;
      input.signal.throwIfAborted();
      const length = Math.min(chunkSize, input.size - start);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      if (bytesRead !== length) {
        throw new ApiError(0, "The file changed while it was uploading.");
      }
      await input.throttle.take(length);
      await api.uploadChunk(session.id, start, buffer, input.size);
      input.onBytes(length);
    }
  } finally {
    await handle.close();
  }
  const file = (await api.completeUpload(
    session.id,
    input.checksum,
    input.replace?.rev ?? null,
  )) as unknown as UploadedFile;
  store.deleteUpload(input.pairId, input.rel);
  return file;
};

type UploadedFile = {
  id: string;
  folderId: string | null;
  name: string;
  sizeBytes: number;
  storageRevision: number;
  clientModifiedAt: string | null;
};
