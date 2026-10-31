const OVERLAY_DESKTOPS = new Set(["gnome", "ubuntu", "kde"]);

/**
 * Whether the app draws its own top row. On Linux only desktops known to show
 * the window buttons qualify: tiling desktops manage windows themselves, and an
 * unknown desktop keeps its own bar so a window can always be closed.
 */
export const hasCustomTitleBar = (
  platform: NodeJS.Platform,
  currentDesktop = "",
) =>
  platform !== "linux" ||
  currentDesktop
    .split(":")
    .some((desktop) => OVERLAY_DESKTOPS.has(desktop.toLowerCase()));
