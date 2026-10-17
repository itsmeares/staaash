/** The nine folder swatches; each has a shade for light and for dark pages. */
export const FOLDER_SWATCHES = [
  { name: "stone", label: "Stone", light: "#78716c", dark: "#a8a29e" },
  { name: "red", label: "Red", light: "#dc2626", dark: "#f87171" },
  { name: "orange", label: "Orange", light: "#ea580c", dark: "#fb923c" },
  { name: "amber", label: "Amber", light: "#d97706", dark: "#fbbf24" },
  { name: "green", label: "Green", light: "#16a34a", dark: "#4ade80" },
  { name: "teal", label: "Teal", light: "#0d9488", dark: "#2dd4bf" },
  { name: "blue", label: "Blue", light: "#2563eb", dark: "#60a5fa" },
  { name: "violet", label: "Violet", light: "#7c3aed", dark: "#a78bfa" },
  { name: "pink", label: "Pink", light: "#db2777", dark: "#f472b6" },
] as const;

const luminance = (hex: string) => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
};

// Roughly the page colors the icon sits on.
const LIGHT_PAGE = "#f6f3ee";
const DARK_PAGE = "#191715";

/**
 * Inline styles for a colored folder icon. A custom color keeps its exact
 * value; when it would vanish into the page (black on dark, white on light)
 * the icon gets a soft tile in the opposite tone behind it.
 */
export function folderColorStyle(color: string | null | undefined) {
  if (!color) return null;
  const swatch = FOLDER_SWATCHES.find((entry) => entry.name === color);
  if (swatch) {
    return {
      color: `light-dark(${swatch.light}, ${swatch.dark})`,
      tile: "transparent",
    };
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  const onLight = contrast(color, LIGHT_PAGE) < 1.9 ? "#2a2623" : "transparent";
  const onDark = contrast(color, DARK_PAGE) < 1.9 ? "#e9e4dc" : "transparent";
  return { color, tile: `light-dark(${onLight}, ${onDark})` };
}
