import type { State } from "./state";

/**
 * The demo drive, saved in the visitor's browser. Uploaded bytes are stored one
 * record per file so a rename does not rewrite every upload.
 */
const IDLE_LIMIT = 7 * 24 * 60 * 60 * 1000;

type Saved = { version: string; seenAt: number; state: State };

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function open() {
  const request = indexedDB.open("staaash-demo", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("drive");
    request.result.createObjectStore("blobs");
  };
  return result(request);
}

async function readSaved(db: IDBDatabase) {
  const read = db.transaction(["drive", "blobs"]);
  const [saved, ids, blobs] = await Promise.all([
    result(read.objectStore("drive").get("current")) as Promise<
      Saved | undefined
    >,
    result(read.objectStore("blobs").getAllKeys()) as Promise<string[]>,
    result(read.objectStore("blobs").getAll()) as Promise<
      Uint8Array<ArrayBuffer>[]
    >,
  ]);
  return { saved, blobs: new Map(ids.map((id, i) => [id, blobs[i]!])) };
}

export async function openSavedDrive(version: string, seed: () => State) {
  const db = await open();
  const { saved, blobs } = await readSaved(db);
  // A new release or a week away starts a fresh drive, so old saved data
  // never meets code that does not expect it.
  const kept =
    saved?.version === version && Date.now() - saved.seenAt < IDLE_LIMIT;
  const state = kept ? saved.state : seed();
  state.blobs = kept ? blobs : new Map();
  state.uploads = new Map();
  let stored = new Set(blobs.keys());
  let queue = Promise.resolve();

  function write() {
    const ids = new Set(state.blobs.keys());
    const tx = db.transaction(["drive", "blobs"], "readwrite");
    // Unfinished uploads stay in memory; the browser resumes or retries them.
    tx.objectStore("drive").put(
      {
        version,
        seenAt: Date.now(),
        state: { ...state, blobs: new Map(), uploads: new Map() },
      } satisfies Saved,
      "current",
    );
    const blobStore = tx.objectStore("blobs");
    for (const id of stored) if (!ids.has(id)) blobStore.delete(id);
    for (const [id, bytes] of state.blobs)
      if (!stored.has(id)) blobStore.put(bytes, id);
    return done(tx).then(() => {
      stored = ids;
    });
  }
  /** Saves are queued so two quick changes never write out of order. */
  function save() {
    const next = queue.then(write);
    queue = next.catch(() => {});
    return next;
  }
  // Saving on wake-up also records the visit for the idle limit.
  await save();
  return { state, save };
}
