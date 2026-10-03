// Dump computed styles for every element on a set of routes, so two CSS
// states can be compared exactly. Usage:
//   node e2e/visual/computed-styles.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.STAAASH_E2E_BASE_URL ?? "http://127.0.0.1:3100";
const out = process.argv[2];
const stateDir = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  ".data",
  "visual",
);

const routes = [
  ["owner", "/home"],
  ["owner", "/files"],
  ["owner", "/recent"],
  ["owner", "/favorites"],
  ["owner", "/shared"],
  ["owner", "/search?q=shared"],
  ["owner", "/trash"],
  ["owner", "/settings"],
  ["owner", "/account"],
  ["owner", "/admin"],
  ["owner", "/admin/jobs"],
  ["owner", "/admin/storage"],
  ["owner", "/admin/users"],
  ["owner", "/admin/users/e2e-member"],
  ["owner", "/admin/settings"],
  [
    "public",
    JSON.parse(
      readFileSync(path.join(stateDir, "..", "e2e", "state.json"), "utf8"),
    ).shareUrl,
  ],
  ["public", "/"],
];
const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const browser = await chromium.launch();
const result = {};
for (const theme of ["light", "dark"]) {
  for (const [vpName, viewport] of Object.entries(viewports)) {
    for (const [who, route] of routes) {
      const context = await browser.newContext({
        viewport,
        colorScheme: theme,
        storageState:
          who === "owner" ? path.join(stateDir, "owner.json") : undefined,
      });
      await context.addCookies([
        { name: "staaash_theme", value: theme, url: baseURL },
      ]);
      const page = await context.newPage();
      await page.goto(baseURL + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const styles = await page.evaluate(() => {
        const props = [
          "display",
          "position",
          "width",
          "height",
          "margin",
          "padding",
          "gap",
          "grid-template-columns",
          "flex-direction",
          "align-items",
          "justify-content",
          "font-size",
          "font-weight",
          "font-family",
          "line-height",
          "letter-spacing",
          "color",
          "background-color",
          "background-image",
          "border",
          "border-radius",
          "box-shadow",
          "opacity",
          "text-transform",
          "max-width",
          "min-height",
          "top",
          "left",
          "overflow",
          "outline",
          "transform",
          "visibility",
        ];
        const items = [];
        const all = document.querySelectorAll("body *");
        all.forEach((el, index) => {
          if (el.closest("nextjs-portal, script, style")) return;
          const cs = getComputedStyle(el);
          const entry = {};
          for (const p of props) entry[p] = cs.getPropertyValue(p);
          const id = `${index}:${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
          items.push([id, entry]);
        });
        return items;
      });
      result[`${theme}|${vpName}|${route}`] = Object.fromEntries(styles);
      await context.close();
    }
  }
}
await browser.close();
writeFileSync(out, JSON.stringify(result));
console.log("wrote", out);
