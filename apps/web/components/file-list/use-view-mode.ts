import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import type { ViewMode } from "@/components/view-toggle";

const DefaultView = createContext<ViewMode>("list");

/** The person's "Lists open in" choice, used until a page remembers its own. */
export function DefaultViewProvider({
  value,
  children,
}: {
  value: string | null | undefined;
  children: ReactNode;
}) {
  return createElement(
    DefaultView,
    { value: value === "grid" ? "grid" : "list" },
    children,
  );
}

/** List or grid, remembered per page on this device. */
export function useViewMode(page: string, fallback?: ViewMode) {
  const key = `staaash:view:${page}`;
  const preferred = useContext(DefaultView);
  const [view, setView] = useState<ViewMode>(fallback ?? preferred);

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
