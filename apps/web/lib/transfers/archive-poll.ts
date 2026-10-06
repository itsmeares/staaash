import { queuedFetch, readResponseError } from "./request-queue";

export type ArchivePollResult =
  | { status: "ready" }
  | { status: "failed"; message: string }
  | { status: "rejected"; message: string };

type PollArchiveStatusOptions = {
  archiveId: string;
  /** Cancelling resolves the poll with `null` and aborts requests in flight. */
  signal: AbortSignal;
  onProcessing: (fileCount: number) => void;
  intervalMs?: number;
  fetchStatus?: (archiveId: string, signal: AbortSignal) => Promise<Response>;
};

const fetchArchiveStatus = (archiveId: string, signal: AbortSignal) =>
  queuedFetch(
    "poll",
    `/api/files/archives/${archiveId}`,
    { headers: { Accept: "application/json" } },
    { retries: 5, backoffMs: 1000, signal },
  );

type PollOutcome =
  ArchivePollResult | { status: "processing"; fileCount?: number };

async function readOutcome(res: Response): Promise<PollOutcome> {
  if (!res.ok) {
    return {
      status: "rejected",
      message: await readResponseError(res, "Download status unavailable."),
    };
  }

  const data = (await res.json()) as {
    status: string;
    fileCount?: number;
    error?: string;
  };
  if (data.status === "ready") return { status: "ready" };
  if (data.status === "failed") {
    return { status: "failed", message: data.error ?? "Zip creation failed." };
  }
  return {
    status: "processing",
    fileCount: data.status === "processing" ? data.fileCount : undefined,
  };
}

/**
 * Polls until the archive reaches a terminal state. The first terminal
 * response wins: it stops the timer and aborts the other in-flight requests,
 * so an older response landing late cannot overwrite it. Any non-OK status
 * (403, 404, a 5xx that outlived its retries) is terminal.
 */
export function pollArchiveStatus({
  archiveId,
  signal,
  onProcessing,
  intervalMs = 2000,
  fetchStatus = fetchArchiveStatus,
}: PollArchiveStatusOptions): Promise<ArchivePollResult | null> {
  return new Promise((resolve) => {
    const run = new AbortController();
    let settled = false;

    const finish = (result: ArchivePollResult | null) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal.removeEventListener("abort", cancel);
      run.abort();
      resolve(result);
    };
    const cancel = () => finish(null);

    const tick = async () => {
      try {
        const res = await fetchStatus(archiveId, run.signal);
        if (settled) return;
        const outcome = await readOutcome(res);
        if (settled) return;
        if (outcome.status !== "processing") finish(outcome);
        else if (outcome.fileCount != null) onProcessing(outcome.fileCount);
      } catch {
        // Transient network errors are retried inside fetchStatus; anything
        // still surfacing here (aborts, bad JSON) just waits for the next tick.
      }
    };

    const timer = setInterval(() => void tick(), intervalMs);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}
