import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Text colors must reach WCAG AA (4.5:1) on every surface they can sit on,
// in both themes. scripts/check-styles.mjs keeps components to the text
// colors checked here: foreground, foreground at 80% or more, and
// muted-foreground.

type Rgb = [number, number, number];

const css = readFileSync(
  path.resolve(__dirname, "..", "styles", "tokens.css"),
  "utf8",
);

const readBlock = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`tokens.css has no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.replace(/\s+/g, " ").trim(),
    ]),
  );
};

const lightTokens = readBlock(":root");
const themes = {
  light: lightTokens,
  dark: { ...lightTokens, ...readBlock(".dark") },
};

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) => {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

type Oklab = [number, number, number];

const oklabToRgb = ([L, a, b]: Oklab): Rgb => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};

// Resolves `oklch(L C H)` and `color-mix(in oklab, var(--a) N%, var(--b) M%)`.
const resolve = (tokens: Record<string, string>, name: string): Oklab => {
  const value = tokens[name];
  const lch = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (lch) {
    const [L, C, h] = lch.slice(1).map(Number);
    const rad = (h * Math.PI) / 180;
    return [L, C * Math.cos(rad), C * Math.sin(rad)];
  }
  const mix = value.match(
    /^color-mix\( ?in oklab, var\(--([\w-]+)\) ([\d.]+)%, var\(--([\w-]+)\)(?: [\d.]+%)? ?\)$/,
  );
  if (!mix) throw new Error(`Unsupported value for --${name}: ${value}`);
  const p = Number(mix[2]) / 100;
  const a = resolve(tokens, mix[1]);
  const b = resolve(tokens, mix[3]);
  return a.map((v, i) => p * v + (1 - p) * b[i]) as Oklab;
};

const over = (top: Rgb, bottom: Rgb, alpha: number): Rgb =>
  top.map((v, i) => alpha * v + (1 - alpha) * bottom[i]) as Rgb;

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const checkTheme = (tokens: Record<string, string>) => {
  const rgb = (name: string) => oklabToRgb(resolve(tokens, name));
  const foreground = rgb("foreground");
  const primary = rgb("primary");
  const background = rgb("background");
  const sidebar = rgb("sidebar");

  // Fills from styles/theme.css are foreground or primary tints on a base.
  const surfaces: Record<string, Rgb> = {
    background,
    card: rgb("card"),
    popover: rgb("popover"),
    muted: rgb("muted"),
    secondary: rgb("secondary"),
    accent: rgb("accent"),
    sidebar,
    "sidebar + hover": over(foreground, sidebar, 0.05),
    "background + pressed": over(foreground, background, 0.08),
    "background + primary/10": over(primary, background, 0.1),
    "admin sidebar (primary/9)": over(primary, background, 0.09),
  };
  const texts: Record<string, (surface: Rgb) => Rgb> = {
    foreground: () => foreground,
    "foreground/80": (surface) => over(foreground, surface, 0.8),
    "muted-foreground": () => rgb("muted-foreground"),
  };

  return Object.entries(texts).flatMap(([text, color]) =>
    Object.entries(surfaces).map(([surface, fill]) => ({
      pair: `${text} on ${surface}`,
      ratio: contrast(color(fill), fill),
    })),
  );
};

describe("text contrast tokens", () => {
  it.each(Object.entries(themes))(
    "%s theme text reaches 4.5:1 on every surface",
    (_, tokens) => {
      const failing = checkTheme(tokens)
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(3)}`);
      expect(failing).toEqual([]);
    },
  );

  it("matches the contrast axe measured for the old light nav", () => {
    // #338: foreground at 60% on the light sidebar measured 4.28:1 in axe.
    const tokens = themes.light;
    const rgb = (name: string) => oklabToRgb(resolve(tokens, name));
    const sidebar = rgb("sidebar");
    const ratio = contrast(over(rgb("foreground"), sidebar, 0.6), sidebar);
    expect(ratio).toBeCloseTo(4.28, 1);
  });
});
