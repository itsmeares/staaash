"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

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
      if (
        !document.startViewTransition ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setView(next);
        return;
      }
      // Each item morphs from its list row to its grid card. ponytail: every
      // item in the list is captured; virtualize the list first if huge
      // folders make the switch stutter.
      const root = document.documentElement;
      root.dataset.viewMorph = "";
      const transition = document.startViewTransition(() =>
        flushSync(() => setView(next)),
      );
      void transition.finished.finally(() => delete root.dataset.viewMorph);
    },
  ] as const;
}
