type Theme = "dark" | "light";

// The app's --background, so the status bar runs into the page under it.
const screen = {
  dark: "oklch(0.135 0.003 70)",
  light: "oklch(0.968 0.0035 75)",
};
const ink = { dark: "#fff", light: "#000" };

const statusIcons = (color: string) => `
<svg width="19" height="12" viewBox="0 0 19 12" fill="${color}"><rect x="0" y="7.5" width="3.2" height="4.5" rx="1"/><rect x="5" y="5" width="3.2" height="7" rx="1"/><rect x="10" y="2.5" width="3.2" height="9.5" rx="1"/><rect x="15" y="0" width="3.2" height="12" rx="1"/></svg>
<svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M1.5 4.3a10.2 10.2 0 0 1 14 0"/><path d="M4.4 7.2a6 6 0 0 1 8.2 0"/><circle cx="8.5" cy="10.3" r="1.2" fill="${color}" stroke="none"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="${color}" opacity="0.4"/><rect x="2.5" y="2.5" width="17" height="8" rx="2.2" fill="${color}"/><path d="M25 4.5v4a2 2 0 0 0 0-4Z" fill="${color}" opacity="0.45"/></svg>`;

/** A phone at 390 x 844 CSS pixels showing a live page, with a metal edge, the island and a status bar. */
export const phone = (src: string, theme: Theme) => `
<div style="position:relative;width:418px;height:872px;padding:3px;border-radius:69px;background:linear-gradient(150deg,#9a9a9f,#48484c 28%,#76767b 55%,#3a3a3e 80%,#8a8a8f);box-shadow:0 30px 70px rgb(0 0 0 / ${theme === "dark" ? 0.55 : 0.22})">
  ${[
    ["left", 118, 32],
    ["left", 178, 62],
    ["left", 252, 62],
    ["right", 206, 98],
  ]
    .map(
      ([side, top, height]) =>
        `<span style="position:absolute;${side}:-3px;top:${top}px;width:4px;height:${height}px;border-radius:2px;background:linear-gradient(90deg,#55555a,#9a9a9f)"></span>`,
    )
    .join("")}
  <div style="position:relative;height:100%;padding:11px;border-radius:66px;background:#050505">
    <div style="position:relative;height:100%;border-radius:55px;overflow:hidden;background:${screen[theme]}">
      <div style="height:54px;display:flex;align-items:center;justify-content:space-between;padding:4px 30px 0 52px;color:${ink[theme]};font:600 17px/1 Switzer">
        <span>9:41</span><span style="display:flex;gap:6px;align-items:center">${statusIcons(ink[theme])}</span>
      </div>
      <div style="position:absolute;top:11px;left:50%;width:125px;height:37px;margin-left:-62.5px;border-radius:20px;background:#000"></div>
      <iframe src="${src}" style="border:0;display:block;width:390px;height:790px"></iframe>
    </div>
  </div>
</div>`;
