import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatVersionLabel } from "@staaash/config/version";

import { DriveGlyph } from "@/components/drive-glyph";
import { SkipLink } from "@/components/skip-link";
import { cn } from "@/lib/utils";

import styles from "./entry-experience.module.css";

type EntryShellProps = {
  children: ReactNode;
  instanceName?: string;
  /** Shown in the footer; the release name joins it when one is chosen. */
  appVersion?: string;
  background?: ReactNode;
  className?: string;
  contentClassName?: string;
  scrimVariant?: "gateway" | "setup";
  onBrandClick?: () => void;
};

const brandClassName =
  "flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent p-0 font-heading text-xl leading-tight font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EntryShell({
  children,
  instanceName = "Staaash",
  appVersion,
  background,
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
        {appVersion ? (
          <footer className="text-center text-label text-muted-foreground">
            Staaash {formatVersionLabel(appVersion)}
          </footer>
        ) : null}
      </div>
    </main>
  );
}
