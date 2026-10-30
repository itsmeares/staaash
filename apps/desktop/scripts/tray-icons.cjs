// Draws the tray icons and the app icon from the Staaash drive shape. Run with
// `xvfb-run -a electron --no-sandbox scripts/tray-icons.cjs` after changing
// the shape; the PNGs in resources are committed.
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

// The same drive as the app's AppGlyph, on the 32-unit grid. The thicker edge
// keeps its outline visible at tray size, where 1 unit is under half a pixel.
const DRIVE = `<g transform="translate(0 3.5) scale(.889)"><path d="M7 2h22l6 14H1z" fill="#3e424a"/><rect x="1" y="13" width="34" height="14" rx="3.5" fill="#12161e" stroke="#2c3039" stroke-width="1.6"/><rect x="23" y="19" width="7" height="1.8" rx=".9" fill="#4a90ff"/></g>`;
// macOS tints template images, so those stay one colour.
const TEMPLATE_DRIVE = `<path d="M7.4 7.5h17.2l2.4 9.1H5z"/><rect x="5" y="15" width="22" height="9" rx="2"/>`;
// What each state cuts out of its badge, drawn black inside a mask.
const GLYPHS = {
  idle: null,
  syncing: `<g stroke="black" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20.5 24a3.5 3.5 0 0 1 6-2.5M27.5 24a3.5 3.5 0 0 1-6 2.5M26.8 19.6v2.4h-2.4M21.2 28.4V26h2.4"/></g>`,
  paused: `<rect x="21.2" y="20.5" width="2" height="7" rx=".6"/><rect x="24.8" y="20.5" width="2" height="7" rx=".6"/>`,
  attention: `<rect x="23" y="19.6" width="2" height="5.6" rx="1"/><circle cx="24" cy="27.6" r="1.2"/>`,
  offline: `<path d="M21 21l6 6M27 21l-6 6" stroke="black" stroke-width="1.8" stroke-linecap="round"/>`,
};

const svg = (state, { fill, shape }, size) => {
  const glyph = GLYPHS[state];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs>
    <mask id="drive"><rect width="32" height="32" fill="white"/>${glyph ? '<circle cx="24" cy="24" r="9.5" fill="black"/>' : ""}</mask>
    <mask id="badge"><rect width="32" height="32" fill="white"/><g fill="black">${glyph ?? ""}</g></mask>
  </defs>
  <g fill="${fill}" mask="url(#drive)">${shape}</g>
  ${glyph ? `<circle cx="24" cy="24" r="7.5" fill="${fill}" mask="url(#badge)"/>` : ""}
</svg>`;
};

// "-dark" is for light panels and "-light" for dark ones, on Windows and Linux.
const VARIANTS = {
  "-dark": { fill: "#1c1917", shape: DRIVE },
  "-light": { fill: "#f5f5f4", shape: DRIVE },
  Template: { fill: "#000", shape: TEMPLATE_DRIVE },
};

const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-3 -7 42 42">
  <path d="M7 2h22l6 14H1z" fill="#3e424a"/>
  <rect x="1" y="13" width="34" height="14" rx="3.5" fill="#12161e" stroke="#2c3039"/>
  <rect x="23" y="19" width="7" height="1.8" rx=".9" fill="#4a90ff"/>
</svg>`;

void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    frame: false,
    transparent: true,
  });
  const out = path.join(__dirname, "../resources/tray");
  for (const state of Object.keys(GLYPHS)) {
    for (const [variant, look] of Object.entries(VARIANTS)) {
      for (const scale of [1, 2]) {
        const size = 16 * scale;
        const html = `<html><body style="margin:0;background:transparent">${svg(state, look, size)}</body></html>`;
        // Offscreen windows hand over each frame through "paint".
        await win.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        const image = await win.webContents.capturePage({
          x: 0,
          y: 0,
          width: size,
          height: size,
        });
        const file = `${state}${variant}${scale === 2 ? "@2x" : ""}.png`;
        writeFileSync(path.join(out, file), image.toPNG());
      }
    }
  }
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${APP_ICON}</body></html>`)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const icon = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
  });
  writeFileSync(path.join(__dirname, "../resources/icon.png"), icon.toPNG());
  app.quit();
});
