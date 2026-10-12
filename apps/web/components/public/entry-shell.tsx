import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DriveGlyph } from "@/components/drive-glyph";
import { SkipLink } from "@/components/skip-link";
import { cn } from "@/lib/utils";

import styles from "./entry-experience.module.css";

type EntryShellProps = {
  children: ReactNode;
  instanceName?: string;
  background?: ReactNode;
  className?: string;
  contentClassName?: string;
  scrimVariant?: "gateway" | "setup";
  onBrandClick?: () => void;
  /** Off where the drive's name is already the page's heading. */
  showBrand?: boolean;
};

const brandClassName =
  "flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent p-0 font-heading text-xl leading-tight font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EntryShell({
  children,
  instanceName = "Staaash",
  background,
  className,
  contentClassName,
  scrimVariant = "gateway",
  onBrandClick,
  showBrand = true,
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
        <header className="flex min-h-7 items-center justify-between gap-4">
          {!showBrand ? null : onBrandClick ? (
            <button
              className={brandClassName}
              onClick={onBrandClick}
              aria-label="Back to start"
            >
              <DriveGlyph className="w-7" />
              {instanceName}
            </button>
          ) : (
            <Link href="/" className={brandClassName}>
              <DriveGlyph className="w-7" />
              {instanceName}
            </Link>
          )}
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
