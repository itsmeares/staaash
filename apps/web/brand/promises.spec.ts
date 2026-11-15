import { test } from "@playwright/test";
import { Box, FolderOpen, Unplug } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { saveWebp } from "./demo";

const fonts = "../../packages/ui/fonts";

const themes = {
  dark: {
    text: "#e6edf3",
    muted: "#9198a1",
    accent: "#d5ac76",
    tile: "rgb(213 172 118 / 0.12)",
    ring: "rgb(213 172 118 / 0.28)",
  },
  light: {
    text: "#1f2328",
    muted: "#59636e",
    accent: "#8d5d24",
    tile: "rgb(141 93 36 / 0.08)",
    ring: "rgb(141 93 36 / 0.22)",
  },
};

const promises = [
  {
    icon: Unplug,
    title: "Pull the plug",
    text: "A move or upload never ends half done.",
  },
  {
    icon: FolderOpen,
    title: "Plain folders",
    text: "Your files are normal files. Copy them and go.",
  },
  {
    icon: Box,
    title: "One box",
    text: "The app, a worker and PostgreSQL. That's all.",
  },
];

const page = (t: keyof typeof themes, phone: boolean) => {
  const c = themes[t];
  const items = promises
    .map(
      (p) =>
        `<div><i>${renderToStaticMarkup(createElement(p.icon, { size: phone ? 36 : 26, strokeWidth: 1.75 }))}</i><span><h3>${p.title}</h3><p>${p.text}</p></span></div>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Cabinet Grotesk"; font-weight: 800; src: url(/__brand/fonts/cabinet-grotesk-800.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 400; src: url(/__brand/fonts/switzer-400.woff2); }
  * { margin: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  body { color: ${c.text}; font-family: Switzer; }
  i { display: grid; place-items: center; flex: none; border-radius: 16px; background: ${c.tile}; box-shadow: inset 0 0 0 1.5px ${c.ring}; color: ${c.accent}; }
  h3 { font-family: "Cabinet Grotesk"; font-weight: 800; letter-spacing: -0.015em; }
  p { color: ${c.muted}; line-height: 1.5; text-wrap: pretty; }
  ${
    phone
      ? // On a phone the three stack, each with its icon on the left.
        `body { width: 640px; padding: 16px 0; display: grid; gap: 40px; }
         body > div { display: flex; gap: 28px; align-items: flex-start; }
         i { width: 80px; height: 80px; border-radius: 22px; }
         h3 { font-size: 40px; } p { font-size: 28px; margin-top: 6px; }`
      : `body { width: 1120px; height: 220px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; padding: 24px 0; }
         i { width: 56px; height: 56px; }
         h3 { font-size: 28px; margin-top: 22px; } p { font-size: 19px; margin-top: 8px; }`
  }
</style>${items}`;
};

test.use({ deviceScaleFactor: 2 });

for (const t of ["dark", "light"] as const) {
  for (const phone of [false, true]) {
    test(`promises${phone ? " phone" : ""} ${t}`, async ({ page: tab }) => {
      await tab.setViewportSize({
        width: phone ? 640 : 1120,
        height: phone ? 900 : 220,
      });
      await tab.route("**/__brand/fonts/*", (route) =>
        route.fulfill({
          path: `${fonts}/${new URL(route.request().url()).pathname.split("/").pop()}`,
        }),
      );
      await tab.route("**/__brand", (route) =>
        route.fulfill({ contentType: "text/html", body: page(t, phone) }),
      );
      await tab.goto("/__brand");
      await tab.evaluate(() => document.fonts.ready);
      const box = await tab.evaluate(() =>
        document.body.getBoundingClientRect(),
      );
      saveWebp(
        await tab.screenshot({
          clip: { x: 0, y: 0, width: box.width, height: box.height },
          omitBackground: true,
        }),
        `../../design/Features/promises${phone ? "-phone" : ""}-${t}.webp`,
      );
    });
  }
}
