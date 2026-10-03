import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom tokens from styles/theme.css so they are
// grouped correctly (for example `text-label` is a size, not a color).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["label", "meta", "body", "headline", "display"],
      radius: ["xs"],
      shadow: ["panel", "dialog", "floating", "selection-bar", "rail"],
      spacing: [
        "control",
        "control-sm",
        "row",
        "row-sm",
        "row-home",
        "sidebar",
        "admin-sidebar",
      ],
      container: ["settings", "admin-settings", "page"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
