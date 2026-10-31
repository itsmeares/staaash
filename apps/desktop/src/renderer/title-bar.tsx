import { cn } from "@staaash/ui/utils";

import { AppGlyph } from "./app-glyph";

// Not in TypeScript's own browser types yet.
const { windowControlsOverlay: overlay } = navigator as Navigator & {
  windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect };
};
const buttonsOnRight =
  overlay?.visible && overlay.getTitlebarAreaRect().x === 0;

/** Windows, macOS, GNOME and KDE windows leave a row for their buttons. */
export const hasTopRow =
  navigator.platform.startsWith("Mac") || overlay?.visible;

/** The logo moves off the top row when window buttons sit at its left end. */
export const logoInRail = hasTopRow && !buttonsOnRight;

/** The row's drag area and logo. With no row the logo keeps the same spot. */
export function TopRow() {
  return (
    <div
      className={cn(
        "fixed start-0 top-0 flex h-11 items-center ps-3.25",
        hasTopRow ? "end-0 [-webkit-app-region:drag]" : "w-14",
      )}
    >
      {logoInRail ? null : <AppGlyph className="w-7.5" />}
    </div>
  );
}
