"use client";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

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
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyResolvedTheme(theme: ResolvedTheme) {
  const html = document.documentElement;
  html.classList.remove(...THEME_CLASS_NAMES);
  html.classList.add(theme);
}

/**
 * Store the preference on <html> and always set a resolved theme class, so
 * `dark:` styles apply for the system preference too.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  applyResolvedTheme(getResolvedTheme(theme));
}

/** Follow OS changes while the preference is "system". */
export function watchSystemTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (document.documentElement.dataset.theme === "system") {
      applyResolvedTheme(media.matches ? "dark" : "light");
    }
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function applyThemeWithTransition(theme: Theme) {
  const currentTheme = getCurrentResolvedTheme();
  const nextTheme = getResolvedTheme(theme);

  if (
    currentTheme === nextTheme ||
    prefersReducedMotion() ||
    !document.startViewTransition
  ) {
    applyTheme(theme);
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeWipe = "";
  const transition = document.startViewTransition(() => {
    applyResolvedTheme(nextTheme);
  });

  const cleanup = () => {
    delete root.dataset.themeWipe;
    applyTheme(theme);
  };
  void transition.finished.then(cleanup, cleanup);
}
