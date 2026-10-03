import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom tokens from styles/theme.css so they are
// grouped correctly (for example `text-label` is a size, not a color).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["label", "meta", "body", "headline", "greeting", "display"],
      radius: ["xs"],
      shadow: ["panel", "dialog", "floating", "selection-bar", "rail"],
      spacing: [
        "control",
        "row",
        "row-sm",
        "row-home",
        "sidebar",
        "admin-sidebar",
      ],
      container: ["settings"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
