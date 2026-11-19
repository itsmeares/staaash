import { test, type Page } from "@playwright/test";
import { demoShareToken, openDemo, saveWebp, settle } from "./demo";
import { desktopURL, showDesktop } from "./desktop";
import { phone } from "./phone";

const fonts = "../../packages/ui/fonts";

const themes = {
  dark: {
    text: "#e6edf3",
    muted: "#9198a1",
    edge: "#2a2724",
    shadow: 0.5,
    code: "#262c36",
    accent: "#d5ac76",
  },
  light: {
    text: "#1f2328",
    muted: "#59636e",
    edge: "#dcd8d3",
    shadow: 0.16,
    code: "#eff1f3",
    accent: "#8d5d24",
  },
};
type Theme = keyof typeof themes;

type Feature = {
  key: string;
  label: string;
  title: string;
  text: string;
  /** The picture's natural size in CSS pixels before scaling. */
  width: number;
  height: number;
  visual: (t: Theme) => string;
  after?: (page: Page) => Promise<void>;
};

const windowFrame = (t: Theme, inner: string, w: number, h: number) =>
  `<div style="width:${w}px;height:${h}px;border-radius:20px;overflow:hidden;position:relative;box-shadow:0 0 0 2px ${themes[t].edge},0 20px 50px rgb(0 0 0 / ${themes[t].shadow})">${inner}</div>`;
const live = (src: string, w: number, h: number) =>
  `<iframe src="${src}" style="border:0;display:block;width:${w}px;height:${h}px"></iframe>`;

const features: Feature[] = [
  {
    key: "open",
    label: "Photos and files",
    title: "Open everything in the browser",
    text: "Photos (HEIC too), videos, music, PDFs and text open right away, on a laptop or a phone. No app to install for the people you share with.",
    width: 1280,
    height: 800,
    visual: (t) =>
      windowFrame(
        t,
        live("/files/view/owner-kitchen-idea", 1280, 800),
        1280,
        800,
      ),
  },
  {
    key: "share",
    label: "Sharing",
    title: "Share a folder in two clicks",
    text: "Send a link with an end date, a password, or downloads turned off. Visitors need no account, and a photo folder opens as a gallery.",
    width: 418,
    height: 872,
    visual: (t) => phone(`/s/${demoShareToken}`, t),
  },
  {
    key: "people",
    label: "Multiple users",
    title: "One drive, room for everyone",
    text: "Invite family, friends or your whole group. Each person gets a private space and a storage limit. Even the owner can't browse someone else's files in the app.",
    // A small window, so the invite form is big enough to read on the card.
    width: 880,
    height: 580,
    visual: (t) => windowFrame(t, live("/admin/users", 880, 580), 880, 580),
    after: async (page) => {
      const app = page.frameLocator("iframe");
      await app.getByRole("button", { name: "Invite" }).click();
      await app.getByPlaceholder("name@example.com").fill("lotte@devries.home");
      await app.getByPlaceholder("No limit").fill("50");
      await app
        .locator("body")
        .evaluate(() => (document.activeElement as HTMLElement).blur());
    },
  },
  {
    key: "sync",
    label: "Desktop sync",
    title: "Keep folders in sync",
    text: "The desktop app for Windows, macOS and Linux keeps a folder on your computer and your drive the same. Two-way, download-only or upload-only. It lives in the tray.",
    width: 860,
    height: 640,
    visual: (t) => windowFrame(t, live(desktopURL, 860, 640), 860, 640),
  },
];

const head = (
  t: Theme,
  body: string,
  css: string,
) => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Cabinet Grotesk"; font-weight: 800; src: url(/__brand/fonts/cabinet-grotesk-800.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 400; src: url(/__brand/fonts/switzer-400.woff2); }
  @font-face { font-family: "Switzer"; font-weight: 600; src: url(/__brand/fonts/switzer-600.woff2); }
  * { margin: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  body { position: relative; overflow: hidden; color: ${themes[t].text}; font-family: Switzer; }
  ${css}
</style>${body}`;

/** A README card: the text on one side, the live screen on the other. */
const card = (f: Feature, t: Theme, flip: boolean) => {
  const box = { w: 620, h: 400 };
  const scale = Math.min(box.w / f.width, box.h / f.height);
  const vw = f.width * scale;
  const vh = f.height * scale;
  const w = 1120;
  const h = 450;
  const copyWidth = 380;
  const gap = 48;
  // Center the copy and the screen as one group, so a narrow phone sits next to its text.
  const start = (w - vw - gap - copyWidth) / 2;
  const visualLeft = flip ? start : start + copyWidth + gap;
  const copyLeft = flip ? start + vw + gap : start;
  return {
    w,
    h,
    html: head(
      t,
      `<div class="copy"><span class="label">${f.label}</span><h3>${f.title}</h3><p>${f.text}</p></div><div class="v">${f.visual(t)}</div>`,
      `body { width: ${w}px; height: ${h}px; }
       .copy { position: absolute; top: 50%; transform: translateY(-50%); width: ${copyWidth}px; left: ${copyLeft}px; }
       .label { display: block; color: ${themes[t].accent}; font-weight: 600; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px; }
       h3 { font-family: "Cabinet Grotesk"; font-weight: 800; font-size: 40px; line-height: 1.08; letter-spacing: -0.02em; text-wrap: balance; }
       p { color: ${themes[t].muted}; font-size: 20px; line-height: 1.5; margin-top: 16px; text-wrap: pretty; }
       code { font-family: ui-monospace, monospace; font-size: 17px; background: ${themes[t].code}; color: ${themes[t].text}; padding: 2px 6px; border-radius: 6px; }
       .v { position: absolute; left: ${visualLeft}px; top: ${(h - vh) / 2}px; transform: scale(${scale}); transform-origin: 0 0; }`,
    ),
  };
};

/**
 * The phone version: GitHub shrinks a README picture to the screen width, so
 * the side-by-side card's text is too small to read there. Text on top, bigger.
 */
const phoneCard = (f: Feature, t: Theme) => {
  const w = 640;
  const scale = Math.min((w - 40) / f.width, 720 / f.height);
  return {
    w,
    // Measured after load; the text decides the height.
    h: 0,
    html: head(
      t,
      `<div class="copy"><span class="label">${f.label}</span><h3>${f.title}</h3><p>${f.text}</p></div><div class="box" style="width:${f.width * scale}px;height:${f.height * scale}px"><div class="v">${f.visual(t)}</div></div>`,
      `body { width: ${w}px; padding: 8px 0 56px; }
       .label { display: block; color: ${themes[t].accent}; font-weight: 600; font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 14px; }
       h3 { font-family: "Cabinet Grotesk"; font-weight: 800; font-size: 54px; line-height: 1.05; letter-spacing: -0.02em; text-wrap: balance; }
       p { color: ${themes[t].muted}; font-size: 30px; line-height: 1.45; margin-top: 18px; text-wrap: pretty; }
       .box { margin: 40px auto 0; }
       .v { transform: scale(${scale}); transform-origin: 0 0; width: ${f.width}px; }`,
    ),
  };
};

async function shoot(
  tab: Page,
  t: Theme,
  f: Feature,
  built: { w: number; h: number; html: string },
  name: string,
) {
  await tab.setViewportSize({ width: built.w, height: built.h || 1600 });
  await tab.emulateMedia({ colorScheme: t });
  await openDemo(tab, true);
  await showDesktop(tab);
  await tab.route("**/__brand/fonts/*", (route) =>
    route.fulfill({
      path: `${fonts}/${new URL(route.request().url()).pathname.split("/").pop()}`,
    }),
  );
  await tab.route("**/__brand", (route) =>
    route.fulfill({ contentType: "text/html", body: built.html }),
  );
  await tab.goto("/__brand");
  await settle(tab);
  for (const frame of tab.frames().slice(1)) await settle(frame);
  await f.after?.(tab);
  await tab.mouse.move(0, 0);
  await tab.waitForTimeout(800);
  const height =
    built.h ||
    (await tab.evaluate(() => document.body.getBoundingClientRect().height));
  saveWebp(
    await tab.screenshot({
      clip: { x: 0, y: 0, width: built.w, height },
      omitBackground: true,
    }),
    `../../design/Features/${name}-${t}.webp`,
  );
}

test.use({ deviceScaleFactor: 2 });

features.forEach((f, index) => {
  for (const t of ["dark", "light"] as const) {
    test(`${f.key} card ${t}`, async ({ page }) =>
      shoot(page, t, f, card(f, t, index % 2 === 1), f.key));
    test(`${f.key} phone card ${t}`, async ({ page }) =>
      shoot(page, t, f, phoneCard(f, t), `${f.key}-phone`));
  }
});
