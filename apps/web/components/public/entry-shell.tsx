import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EntryShellProps = {
  children: ReactNode;
  background?: ReactNode;
  topNote?: string;
  className?: string;
};

export function EntryShell({
  children,
  background,
  topNote,
  className,
}: EntryShellProps) {
  return (
    <main
      className={cn(
        "entry-surface",
        background ? "entry-surface--gateway" : "entry-surface--focused",
        className,
      )}
    >
      {background ? (
        <div aria-hidden="true" className="entry-surface__background">
          {background}
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className={cn(
          "entry-surface__scrim",
          background
            ? "entry-surface__scrim--gateway"
            : "entry-surface__scrim--focused",
        )}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="entry-brand">
            Staaash
          </Link>
          {topNote ? <p className="entry-top-note">{topNote}</p> : null}
        </header>

        <div className="flex flex-1 items-center py-8 sm:py-10 lg:py-12">
          {children}
        </div>
      </div>
    </main>
  );
}
