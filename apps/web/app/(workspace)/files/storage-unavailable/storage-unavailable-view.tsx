"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

const NORMAL_WAIT_MS = 30_000;
const LONG_WAIT_MS = 5 * 60_000;
const FAST_REFRESH_MS = 2_000;
const SLOW_REFRESH_MS = 10_000;
const LONG_REFRESH_MS = 30_000;

export const getRefreshDelay = (elapsedMs: number) => {
  if (elapsedMs < NORMAL_WAIT_MS) return FAST_REFRESH_MS;
  if (elapsedMs < LONG_WAIT_MS) return SLOW_REFRESH_MS;
  return LONG_REFRESH_MS;
};

export function StorageUnavailableView({
  recoveryRequired,
}: {
  recoveryRequired: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (recoveryRequired) return;

    const startedAt = Date.now();
    let timeoutId: number | undefined;

    const refresh = () => {
      if (!document.hidden) {
        startTransition(() => router.refresh());
      }
    };

    const check = () => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      refresh();
      timeoutId = window.setTimeout(check, getRefreshDelay(elapsed));
    };

    timeoutId = window.setTimeout(check, getRefreshDelay(0));
    document.addEventListener("visibilitychange", refresh);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [recoveryRequired, router, startTransition]);

  const longWait = elapsedMs >= LONG_WAIT_MS;

  return (
    <section aria-busy={!recoveryRequired} className="storage-unavailable-page">
      <div className="storage-unavailable-panel">
        {!recoveryRequired && (
          <Loader2
            aria-hidden
            className="storage-unavailable-spinner"
            size={34}
            strokeWidth={1.8}
          />
        )}

        <div className="storage-unavailable-copy" aria-live="polite">
          <p className="storage-unavailable-eyebrow">
            {recoveryRequired ? "Move incomplete" : "Folder unavailable"}
          </p>
          <h1>
            {recoveryRequired
              ? "This operation could not finish."
              : longWait
                ? "This is taking longer than usual."
                : elapsedMs >= NORMAL_WAIT_MS
                  ? "Folder is still getting ready."
                  : "Folder is getting ready."}
          </h1>
          <p>
            {recoveryRequired
              ? "Use Refresh to check again or go back to Files."
              : longWait
                ? "We are keeping your files safe while this finishes."
                : "The folder will open automatically when it is ready."}
          </p>
        </div>

        <div className="storage-unavailable-actions">
          <button
            className="button button-secondary"
            disabled={isRefreshing}
            onClick={() => startTransition(() => router.refresh())}
            type="button"
          >
            <RefreshCw aria-hidden size={14} />
            Refresh
          </button>
          <Link className="button button-secondary" href="/files">
            Back to Files
          </Link>
        </div>
      </div>
    </section>
  );
}
