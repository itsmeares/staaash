"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

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
      heading: "A move could not finish",
      message:
        "Every file is kept safe. Refresh to check again, or go back to Files.",
    };
  }
  if (elapsedMs >= LONG_WAIT_MS) {
    return {
      heading: "This is taking longer than usual",
      message: "Your files stay safe while it finishes.",
    };
  }
  if (elapsedMs >= NORMAL_WAIT_MS) {
    return {
      heading: "This folder is still getting ready",
      message: "It opens by itself when it's ready.",
    };
  }
  return {
    heading: "This folder is getting ready",
    message: "It opens by itself when it's ready.",
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
    <section className="grid min-h-[min(58vh,520px)] place-items-center">
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        {!recoveryRequired && (
          <Loader2
            aria-hidden
            className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
            data-storage-unavailable-spinner
          />
        )}

        <div className="grid justify-items-center gap-1.5" aria-live="polite">
          <h1 className="m-0 font-heading text-headline font-semibold">
            {copy.heading}
          </h1>
          <p className="m-0 text-body text-muted-foreground">{copy.message}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            disabled={isRefreshing}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw aria-hidden />
            Refresh
          </Button>
          <Button variant="ghost" render={<Link href="/files" />}>
            Back to Files
          </Button>
        </div>
      </div>
    </section>
  );
}
