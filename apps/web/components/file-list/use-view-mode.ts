"use client";

import { useEffect, useState } from "react";

import type { ViewMode } from "@/components/view-toggle";

/** List or grid, remembered per page on this device. */
export function useViewMode(page: string, fallback: ViewMode = "list") {
  const key = `staaash:view:${page}`;
  const [view, setView] = useState<ViewMode>(fallback);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored === "list" || stored === "grid") setView(stored);
  }, [key]);

  return [
    view,
    (next: ViewMode) => {
      window.localStorage.setItem(key, next);
      setView(next);
    },
  ] as const;
}
