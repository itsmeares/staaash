import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DriveGlyph } from "@/components/drive-glyph";
import { SkipLink } from "@/components/skip-link";
import { cn } from "@staaash/ui/utils";

import { EntryBackground } from "./entry-background";
import styles from "./entry-experience.module.css";

/** Every screen before someone is let in: the halftone, the brand, the content. */
export function EntryShell({
  children,
  instanceName = "Staaash",
  showBrand = true,
}: {
  children: ReactNode;
  instanceName?: string;
  /** Off where the drive's name is already the page's heading. */
  showBrand?: boolean;
}) {
  return (
    <main
      id="main-content"
      className={cn(
        "dark relative isolate min-h-dvh w-full overflow-x-hidden overflow-y-auto bg-background text-foreground",
        styles.surface,
      )}
      tabIndex={-1}
    >
      <SkipLink />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 overflow-hidden"
      >
        <EntryBackground />
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          styles.scrim,
        )}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex min-h-7 items-center justify-between gap-4">
          {showBrand ? (
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-lg font-heading text-xl leading-tight font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <DriveGlyph className="w-7" />
              {instanceName}
            </Link>
          ) : null}
        </header>
        <div className="flex flex-1 items-center justify-center py-8 sm:py-10 lg:py-12">
          {children}
        </div>
      </div>
    </main>
  );
}
