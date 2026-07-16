// Client-side transfer concurrency control + retry-with-backoff.
//
// Browsers cap HTTP/1.1 connections at 6 per origin. A chunked upload sending
// 10 MB PATCHes can saturate that pool and starve archive-status polling or
// short-lived downloads, surfacing as "NetworkError when attempting to fetch
// resource." This module gates upload requests through a Lane (concurrency:
// UPLOAD_CONCURRENCY) so a handful of slots stay free for everything else.

const UPLOAD_CONCURRENCY = 3;
const POLL_CONCURRENCY = 4;

class Lane {
  private running = 0;
  private pending: Array<() => void> = [];

  constructor(public concurrency: number) {}

  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const tryStart = () => {
        if (this.running < this.concurrency) {
          this.running++;
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            this.running--;
            const next = this.pending.shift();
            if (next) next();
          };
          resolve(release);
          return true;
        }
        return false;
      };

      if (tryStart()) return;

      const onAbort = () => {
        const idx = this.pending.indexOf(slot);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(abortError());
      };

      const slot = () => {
        if (signal?.aborted) {
          // Drained but already aborted — promote the next waiter.
          reject(abortError());
          const next = this.pending.shift();
          if (next) next();
          return;
        }
        signal?.removeEventListener("abort", onAbort);
        tryStart();
      };

      if (signal) {
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.push(slot);
    });
  }
}

const uploadLane = new Lane(UPLOAD_CONCURRENCY);
const pollLane = new Lane(POLL_CONCURRENCY);

export type TransferLane = "upload" | "poll";

function laneFor(lane: TransferLane): Lane {
  return lane === "upload" ? uploadLane : pollLane;
}

async function withTransferSlot<T>(
  lane: TransferLane,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await laneFor(lane).acquire(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Retry-with-backoff fetch
// ---------------------------------------------------------------------------

export type FetchRetryOptions = {
  retries?: number;
  backoffMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (res: Response) => boolean;
};

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const {
    retries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    signal,
    shouldRetry,
  } = opts;

  const mergedSignal = signal ?? init?.signal ?? undefined;

  let attempt = 0;
  for (;;) {
    throwIfAborted(mergedSignal);

    let res: Response;
    try {
      res = await fetch(input, { ...init, signal: mergedSignal });
    } catch (err) {
      if (mergedSignal?.aborted) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // `TypeError` is what fetch throws on network failure (DNS, conn reset,
      // offline, NetworkError when attempting to fetch resource, etc.).
      const isNetwork = err instanceof TypeError;
      if (!isNetwork || attempt >= retries) throw err;
      await delay(backoffFor(backoffMs, attempt), mergedSignal);
      attempt++;
      continue;
    }

    const retryable = shouldRetry
      ? shouldRetry(res)
      : res.status >= 500 && res.status < 600;
    if (retryable && attempt < retries) {
      await delay(backoffFor(backoffMs, attempt), mergedSignal);
      attempt++;
      continue;
    }
    return res;
  }
}

// ---------------------------------------------------------------------------
// Queued + retried fetch convenience
// ---------------------------------------------------------------------------

export function queuedFetch(
  lane: TransferLane,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  return withTransferSlot(
    lane,
    () => fetchWithRetry(input, init, opts),
    opts.signal,
  );
}

// ---------------------------------------------------------------------------
// XHR adapter — keeps progress events for single-file uploads while still
// participating in the upload concurrency budget.
// ---------------------------------------------------------------------------

export type XhrUploadOptions = {
  url: string;
  method?: string;
  body: XMLHttpRequestBodyInit | Document;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  headers?: Record<string, string>;
  retries?: number;
  backoffMs?: number;
};

export type XhrUploadResult = {
  status: number;
  responseText: string;
};

export function queuedXhrUpload(
  opts: XhrUploadOptions,
): Promise<XhrUploadResult> {
  return withTransferSlot(
    "upload",
    () => runXhrUploadWithRetry(opts),
    opts.signal,
  );
}

async function runXhrUploadWithRetry(
  opts: XhrUploadOptions,
  attempt = 0,
): Promise<XhrUploadResult> {
  throwIfAborted(opts.signal);
  const retries = opts.retries ?? 0;

  try {
    const result = await runXhrUpload(opts);
    if (!shouldRetryXhrStatus(result.status, attempt, retries)) return result;
  } catch (error) {
    if (!shouldRetryXhrError(error, opts.signal, attempt, retries)) throw error;
  }

  await delay(
    backoffFor(opts.backoffMs ?? DEFAULT_BACKOFF_MS, attempt),
    opts.signal,
  );
  return runXhrUploadWithRetry(opts, attempt + 1);
}

function shouldRetryXhrStatus(
  status: number,
  attempt: number,
  retries: number,
) {
  return status >= 500 && status < 600 && attempt < retries;
}

function shouldRetryXhrError(
  error: unknown,
  signal: AbortSignal | undefined,
  attempt: number,
  retries: number,
) {
  return !signal?.aborted && error instanceof TypeError && attempt < retries;
}

function runXhrUpload(opts: XhrUploadOptions): Promise<XhrUploadResult> {
  return new Promise<XhrUploadResult>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) {
        opts.onProgress(ev.loaded, ev.total);
      }
    };
    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ status: xhr.status, responseText: xhr.responseText });
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new TypeError("Network request failed"));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };

    xhr.open(opts.method ?? "POST", opts.url);
    xhr.setRequestHeader("Accept", "application/json");
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        xhr.setRequestHeader(k, v);
      }
    }
    xhr.send(opts.body);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

function backoffFor(baseMs: number, attempt: number): number {
  const exp = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return exp + Math.random() * 250;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
