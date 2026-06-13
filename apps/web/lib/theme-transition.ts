"use client";

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ViewTransition = {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

const THEME_CLASS_NAMES = ["dark", "light"] as const;
const THEME_TRANSITION_DURATION = "1500ms";
const THEME_TRANSITION_EASING = "ease-in-out";

function prefersDarkTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return prefersDarkTheme() ? "dark" : "light";
  return theme;
}

export function getCurrentResolvedTheme(): ResolvedTheme {
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

export function applyThemeWithPolygonTransition(theme: Theme) {
  const nextResolvedTheme = getResolvedTheme(theme);
  const currentResolvedTheme = getCurrentResolvedTheme();
  const transitionDocument = document as ViewTransitionDocument;

  if (
    currentResolvedTheme === nextResolvedTheme ||
    prefersReducedMotion() ||
    !transitionDocument.startViewTransition
  ) {
    applyTheme(theme);
    return;
  }

  const html = document.documentElement;
  html.dataset.themeTransition = nextResolvedTheme;
  html.style.setProperty("--theme-toggle-duration", THEME_TRANSITION_DURATION);
  html.style.setProperty("--theme-toggle-easing", THEME_TRANSITION_EASING);

  const transition = transitionDocument.startViewTransition(() => {
    applyTheme(theme);
  });

  const cleanup = () => {
    delete html.dataset.themeTransition;
    html.style.removeProperty("--theme-toggle-duration");
    html.style.removeProperty("--theme-toggle-easing");
  };

  void transition.finished.then(cleanup, cleanup);
}
