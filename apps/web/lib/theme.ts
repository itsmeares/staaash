"use client";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ViewTransition = {
  finished: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

const THEME_CLASS_NAMES = ["dark", "light"] as const;

function prefersDarkTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersDarkTheme() ? "dark" : "light";
  return theme;
}

function getCurrentResolvedTheme(): ResolvedTheme {
  const html = document.documentElement;
  if (html.classList.contains("dark")) return "dark";
  if (html.classList.contains("light")) return "light";
  return prefersDarkTheme() ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove(...THEME_CLASS_NAMES);
  if (theme !== "system") html.classList.add(theme);
}

function applyResolvedTheme(theme: ResolvedTheme) {
  const html = document.documentElement;
  html.classList.remove(...THEME_CLASS_NAMES);
  html.classList.add(theme);
}

export function applyThemeWithTransition(theme: Theme) {
  const currentTheme = getCurrentResolvedTheme();
  const nextTheme = getResolvedTheme(theme);
  const transitionDocument = document as ViewTransitionDocument;

  if (
    currentTheme === nextTheme ||
    prefersReducedMotion() ||
    !transitionDocument.startViewTransition
  ) {
    applyTheme(theme);
    return;
  }

  const transition = transitionDocument.startViewTransition(() => {
    applyResolvedTheme(nextTheme);
  });

  const cleanup = () => applyTheme(theme);
  void transition.finished.then(cleanup, cleanup);
}
