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

// fallow-ignore-next-line unused-export
export const getRefreshDelay = (elapsedMs: number) => {
  if (elapsedMs < NORMAL_WAIT_MS) return FAST_REFRESH_MS;
  if (elapsedMs < LONG_WAIT_MS) return SLOW_REFRESH_MS;
  return LONG_REFRESH_MS;
};

const getStorageUnavailableCopy = ({
  recoveryRequired,
  elapsedMs,
}: {
  recoveryRequired: boolean;
  elapsedMs: number;
}) => {
  if (recoveryRequired) {
    return {
      eyebrow: "Move incomplete",
      heading: "This operation could not finish.",
      message: "Use Refresh to check again or go back to Files.",
    };
  }
  if (elapsedMs >= LONG_WAIT_MS) {
    return {
      eyebrow: "Folder unavailable",
      heading: "This is taking longer than usual.",
      message: "We are keeping your files safe while this finishes.",
    };
  }
  if (elapsedMs >= NORMAL_WAIT_MS) {
    return {
      eyebrow: "Folder unavailable",
      heading: "Folder is still getting ready.",
      message: "The folder will open automatically when it is ready.",
    };
  }
  return {
    eyebrow: "Folder unavailable",
    heading: "Folder is getting ready.",
    message: "The folder will open automatically when it is ready.",
  };
};

export function StorageUnavailableView({
  recoveryRequired,
}: {
  recoveryRequired: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [elapsedMs, setElapsedMs] = useState(0);
  const copy = getStorageUnavailableCopy({ recoveryRequired, elapsedMs });

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

  return (
    <section className="storage-unavailable-page">
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
          <p className="storage-unavailable-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.heading}</h1>
          <p>{copy.message}</p>
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
