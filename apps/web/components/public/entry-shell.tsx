import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/skip-link";
import { cn } from "@/lib/utils";

import styles from "./entry-experience.module.css";

type EntryShellProps = {
  children: ReactNode;
  background?: ReactNode;
  topNote?: string;
  className?: string;
  contentClassName?: string;
  scrimVariant?: "gateway" | "setup";
  onBrandClick?: () => void;
};

const brandClassName =
  "cursor-pointer border-0 bg-transparent p-0 font-heading text-headline leading-none tracking-tighter text-balance text-inherit";

export function EntryShell({
  children,
  background,
  topNote,
  className,
  contentClassName,
  scrimVariant = "gateway",
  onBrandClick,
}: EntryShellProps) {
  return (
    <main
      id="main-content"
      className={cn(
        "dark relative isolate min-h-dvh w-full overflow-x-hidden overflow-y-auto bg-background text-foreground",
        background ? styles.surfaceGateway : styles.surfaceFocused,
        className,
      )}
      tabIndex={-1}
    >
      <SkipLink />
      {background ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
        >
          {background}
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          !background
            ? styles.scrimFocused
            : scrimVariant === "setup"
              ? styles.scrimSetup
              : styles.scrimGateway,
        )}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          {onBrandClick ? (
            <button
              className={brandClassName}
              onClick={onBrandClick}
              aria-label="Back to start"
            >
              Staaash
            </button>
          ) : (
            <Link href="/" className={brandClassName}>
              Staaash
            </Link>
          )}
          {topNote ? (
            <p className="text-xs font-medium tracking-widest whitespace-nowrap text-foreground/60 uppercase max-sm:hidden">
              {topNote}
            </p>
          ) : null}
        </header>

        <div
          className={cn(
            "flex flex-1 items-center py-8 sm:py-10 lg:py-12",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </main>
  );
}
