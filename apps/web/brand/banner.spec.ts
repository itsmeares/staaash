import { readFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { demoShareToken, openDemo, saveWebp, settle } from "./demo";
import { phone } from "./phone";

const fonts = "../../packages/ui/fonts";
const mark = readFileSync("../../design/Favicon/Staaash Favicon.svg", "utf8");

// The brand kit colors, from design/README.md.
const themes = {
  dark: {
    background: "#090807",
    text: "#efeeec",
    muted: "#a4a19d",
    edge: "#2a2724",
  },
  light: {
    background: "#f6f4f2",
    text: "#1d1a17",
    muted: "#64605b",
    edge: "#dcd8d3",
  },
};
type Theme = keyof typeof themes;
const titleCase = (theme: Theme) => (theme === "dark" ? "Dark" : "Light");

// Live app screens in iframes, so their text is drawn at its final size and
// angle instead of being shrunk from a screenshot.
const style = (theme: Theme, css: string) => `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Cabinet Grotesk"; font-weight: 800; src: url(/__brand/fonts/cabinet-grotesk-800.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 400; src: url(/__brand/fonts/switzer-400.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 500; src: url(/__brand/fonts/switzer-500.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 600; src: url(/__brand/fonts/switzer-600.woff2); }
  * { margin: 0; box-sizing: border-box; }
  iframe { border: 0; display: block; }
  ${css}
</style>`;

/** The social preview: the name on the left, the Lisbon folder tilted on the right. */
const banner = (theme: Theme) => {
  const c = themes[theme];
  return `${style(
    theme,
    `
  body { width: 1280px; height: 640px; overflow: hidden; position: relative; background: ${c.background}; color: ${c.text}; font-family: Switzer; }
  .copy { position: absolute; left: 84px; top: 124px; width: 470px; }
  .copy svg { width: 92px; display: block; margin-left: -6px; }
  h1 { font-family: "Cabinet Grotesk"; font-weight: 800; font-size: 118px; line-height: 1; letter-spacing: -0.035em; margin-top: 14px; }
  h2 { font-weight: 500; font-size: 33px; letter-spacing: -0.01em; margin-top: 30px; }
  p { color: ${c.muted}; font-size: 22px; line-height: 1.42; margin-top: 16px; width: 400px; }
  .stage { position: absolute; left: 610px; top: 70px; perspective: 1800px; }
  /* No soft shadow on dark: a gradient that close to black breaks into stripes. */
  .win { width: 1280px; height: 800px; border-radius: 18px; transform-origin: 0 0; transform: rotateY(-16deg) rotateX(6deg) scale(0.66);
    box-shadow: 0 0 0 2px ${c.edge}${theme === "light" ? ", 0 24px 60px rgb(40 30 20 / 0.14)" : ""}; }
  `,
  )}
<div class="copy">
  ${mark}
  <h1>Staaash</h1>
  <h2>The drive for your homelab.</h2>
  <p>Photos, documents and music on your own hardware, with desktop sync and share links.</p>
</div>
<div class="stage"><iframe class="win" src="/files/f/owner-lisbon"></iframe></div>`;
};

/** The README picture: the desktop folder and its share link on a phone, on a transparent background. */
const hero = (theme: Theme) => {
  const c = themes[theme];
  const shadow = theme === "dark" ? 0.5 : 0.16;
  return `${style(
    theme,
    `
  html, body { background: transparent; }
  body { width: 1160px; height: 740px; overflow: hidden; position: relative; }
  .win { position: absolute; left: 20px; top: 20px; width: 1440px; height: 900px; border-radius: 22px; transform: scale(0.68); transform-origin: 0 0;
    box-shadow: 0 0 0 2px ${c.edge}, 0 20px 50px rgb(0 0 0 / ${shadow}); }
  .phone { position: absolute; left: 862px; top: 168px; transform: scale(0.62); transform-origin: 0 0; }
  `,
  )}
<iframe class="win" src="/files/f/owner-lisbon"></iframe>
<div class="phone">${phone(`/s/${demoShareToken}`, theme)}</div>`;
};

async function render(tab: Page, theme: Theme, html: string) {
  await tab.emulateMedia({ colorScheme: theme });
  await openDemo(tab, true);
  await tab.route("**/__brand/fonts/*", (route) =>
    route.fulfill({
      path: `${fonts}/${new URL(route.request().url()).pathname.split("/").pop()}`,
    }),
  );
  await tab.route("**/__brand", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await tab.goto("/__brand");
  await settle(tab);
  for (const frame of tab.frames().slice(1)) await settle(frame);
}

test.use({ deviceScaleFactor: 2 });

for (const theme of ["dark", "light"] as const) {
  test(`${theme} banner`, async ({ page: tab }) => {
    await tab.setViewportSize({ width: 1280, height: 640 });
    await render(tab, theme, banner(theme));
    await tab.screenshot({
      path: `../../design/Banner/Staaash Banner-${titleCase(theme)}.jpg`,
      quality: 95,
    });
  });

  test(`${theme} README picture`, async ({ page: tab }) => {
    await tab.setViewportSize({ width: 1160, height: 740 });
    await render(tab, theme, hero(theme));
    saveWebp(
      await tab.screenshot({ omitBackground: true }),
      `../../design/Banner/Staaash README-${titleCase(theme)}.webp`,
    );
  });
}
