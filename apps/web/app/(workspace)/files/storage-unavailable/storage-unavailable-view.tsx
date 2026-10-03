"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/section-label";

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
    <section className="grid min-h-[min(58vh,520px)] place-items-center">
      <div className="grid w-[min(560px,100%)] justify-items-center gap-4.5 rounded-xl border border-hairline bg-card px-6 py-[clamp(28px,5vw,56px)] text-center">
        {!recoveryRequired && (
          <Loader2
            aria-hidden
            className="animate-spin text-primary motion-reduce:animate-none"
            size={34}
            strokeWidth={1.8}
          />
        )}

        <div className="grid justify-items-center gap-2" aria-live="polite">
          <SectionLabel className="text-xs">{copy.eyebrow}</SectionLabel>
          <h1 className="max-w-[28ch] font-heading text-3xl leading-tight font-semibold">
            {copy.heading}
          </h1>
          <p className="max-w-[44ch] text-sm leading-normal text-muted-foreground">
            {copy.message}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            disabled={isRefreshing}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw aria-hidden />
            Refresh
          </Button>
          <Button variant="secondary" render={<Link href="/files" />}>
            Back to Files
          </Button>
        </div>
      </div>
    </section>
  );
}
