export type MediaPreviewStatus =
  "none" | "queued" | "processing" | "ready" | "failed" | "stale";
export type MediaPreviewState = { status: MediaPreviewStatus };

export const MEDIA_PREVIEW_LABELS: Record<MediaPreviewStatus, string> = {
  none: "Not generated",
  queued: "Queued…",
  processing: "Generating…",
  ready: "Ready",
  failed: "Failed",
  stale: "Stale",
};

const isActive = (status: string) =>
  status === "queued" || status === "processing";
const isAccessError = (error: unknown) =>
  error instanceof Error && [401, 403, 404].includes(Number(error.cause));
const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

async function readState(response: Response): Promise<MediaPreviewState> {
  if (!response.ok)
    throw new Error("Preview status unavailable.", { cause: response.status });
  const data = (await response.json()) as Partial<MediaPreviewState> | null;
  const status = data?.status;
  if (
    typeof status !== "string" ||
    !Object.hasOwn(MEDIA_PREVIEW_LABELS, status)
  ) {
    throw new Error("Invalid preview status.");
  }
  return { status: status as MediaPreviewStatus };
}

async function fetchState(fileId: string, controller: AbortController) {
  const timeout = window.setTimeout(
    () => controller.abort(new Error("Preview status check timed out.")),
    15_000,
  );
  try {
    return await readState(
      await fetch(`/api/files/files/${fileId}/derivative`, {
        cache: "no-store",
        signal: controller.signal,
      }),
    );
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function generateMediaPreview(
  fileId: string,
  signal: AbortSignal,
) {
  const response = await fetch(`/api/files/files/${fileId}/derivative`, {
    method: "POST",
    signal,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      typeof data?.error === "string" ? data.error : "Failed to queue preview.",
    );
  }
  return readState(response);
}

/** Tracks only this pane's selection. The returned cleanup stops reads, not the server job. */
export function watchMediaPreviewStatus(
  fileId: string,
  onState: (state: MediaPreviewState) => void,
  onError: (message: string | null) => void,
) {
  let stopped = false;
  let running = false;
  let checkAgain = false;
  let failures = 0;
  let timer: number | undefined;
  let request: AbortController | undefined;
  const canPoll = () => !stopped && !document.hidden;

  const publish = (data: MediaPreviewState, controller: AbortController) => {
    if (stopped || controller.signal.aborted) return;
    onState(data);
    onError(null);
    failures = 0;
    return isActive(data.status) ? 2_000 : undefined;
  };
  const failedCheck = (error: unknown) => {
    if (stopped || isAbortError(error)) return;
    const accessChanged = isAccessError(error);
    onError(
      accessChanged
        ? "Preview status unavailable. Access to this file may have changed."
        : "Couldn't check preview status. Checking again automatically.",
    );
    if (!accessChanged) return Math.min(2_000 * 2 ** failures++, 10_000);
  };
  const schedule = (delay: number | undefined) => {
    if (!canPoll()) return;
    if (checkAgain) {
      checkAgain = false;
      void poll();
    } else if (delay !== undefined) {
      timer = window.setTimeout(() => void poll(), delay);
    }
  };
  const poll = async () => {
    if (!canPoll()) return;
    if (running) {
      checkAgain = true;
      return;
    }
    window.clearTimeout(timer);
    running = true;
    const controller = new AbortController();
    request = controller;
    let delay: number | undefined;
    try {
      delay = publish(await fetchState(fileId, controller), controller);
    } catch (error) {
      delay = failedCheck(error);
    } finally {
      running = false;
      schedule(delay);
    }
  };
  const refresh = () => {
    window.clearTimeout(timer);
    if (document.hidden) request?.abort();
    else void poll();
  };
  void poll();
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    request?.abort();
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
  };
}
