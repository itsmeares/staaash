import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  getMemberCredentials,
  getOnboardingCredentials,
  getOwnerCredentials,
  getShareUrl,
  signIn,
} from "../helpers";

type Theme = "light" | "dark";
type Viewport = "desktop" | "mobile";

const THEMES: Theme[] = ["light", "dark"];
const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const authDirectory = path.resolve(import.meta.dirname, "..", "..", ".data", "visual");
const ownerStatePath = path.join(authDirectory, "owner.json");
const memberStatePath = path.join(authDirectory, "member.json");

const WORKSPACE_ROUTES = [
  "/home",
  "/files",
  "/recent",
  "/favorites",
  "/shared",
  "/search?q=shared",
  "/trash",
  "/settings",
  "/account",
];

const ADMIN_ROUTES = [
  "/admin",
  "/admin/jobs",
  "/admin/storage",
  "/admin/users",
  "/admin/users/e2e-member",
  "/admin/settings",
];

const slug = (route: string) =>
  route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "root";

const applyTheme = async (context: BrowserContext, theme: Theme) => {
  await context.addCookies([
    {
      name: "staaash_theme",
      value: theme,
      url: process.env.STAAASH_E2E_BASE_URL,
    },
  ]);
};

const settle = async (page: Page) => {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
};

const shoot = async (page: Page, name: string) => {
  await settle(page);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect.soft(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    timeout: 15_000,
    mask: [
      page.getByText(/ of [\d.]+ (GB|TB|MB)/),
      page.getByText(/\b(ago|just now|yesterday)\b/i),
      page.getByText(/^Good (morning|afternoon|evening)/),
      page.locator("time"),
      page.getByText(/\d{1,2} [A-Z][a-z]{2} \d{4},? \d{1,2}:\d{2}/),
      page.locator("canvas"),
    ],
  });
};

// Interaction states are best effort: a missing control should not hide the
// rest of the suite.
const attempt = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    console.warn(`[visual] skipped ${name}: ${String(error).split("\n")[0]}`);
  }
};

test.beforeAll(async ({ browser }) => {
  mkdirSync(authDirectory, { recursive: true });

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, getOwnerCredentials());

  for (const name of ["Projects", "Photos", "Documents"]) {
    await ownerPage.request.post("/api/files/folders", {
      headers: { accept: "application/json" },
      data: { name },
      failOnStatusCode: false,
    });
  }

  await ownerContext.storageState({ path: ownerStatePath });
  await ownerContext.close();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, getMemberCredentials());
  await memberContext.storageState({ path: memberStatePath });
  await memberContext.close();
});

for (const theme of THEMES) {
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    const label = `${theme}-${viewportName}`;

    test.describe(label, () => {
      test.use({ viewport, colorScheme: theme });

      test(`workspace ${label}`, async ({ browser }) => {
        const context = await browser.newContext({
          storageState: ownerStatePath,
          viewport,
          colorScheme: theme,
        });
        await applyTheme(context, theme);
        const page = await context.newPage();

        for (const route of WORKSPACE_ROUTES) {
          await page.goto(route);
          await shoot(page, `${label}/workspace-${slug(route)}`);
        }

        await context.close();
      });

      test(`files interactions ${label}`, async ({ browser }) => {
        const context = await browser.newContext({
          storageState: ownerStatePath,
          viewport,
          colorScheme: theme,
          hasTouch: viewportName === "mobile",
        });
        await applyTheme(context, theme);
        const page = await context.newPage();
        await page.goto("/files");
        await settle(page);

        const row = page.locator("[data-list-item]", {
          hasText: "shared-preview.png",
        });
        await expect(row).toBeVisible();

        if (viewportName === "mobile") {
          await attempt("row actions sheet", async () => {
            await row
              .getByRole("button", { name: /Actions for shared-preview\.png/ })
              .click({ timeout: 5_000 });
            await expect(page.getByRole("dialog").first()).toBeVisible();
            await shoot(page, `${label}/files-row-actions`);
            await page.keyboard.press("Escape");
          });
        } else {
          await attempt("context menu", async () => {
            await row.click({ button: "right", timeout: 5_000 });
            await expect(page.getByRole("menu").first()).toBeVisible({
              timeout: 5_000,
            });
            await shoot(page, `${label}/files-context-menu`);
            await page.keyboard.press("Escape");
          });

          await attempt("shortcut legend", async () => {
            await page.locator("body").click({ position: { x: 900, y: 800 } });
            await page.keyboard.press("Shift+Slash");
            await expect(page.getByRole("dialog").first()).toBeVisible({
              timeout: 5_000,
            });
            await shoot(page, `${label}/files-shortcut-legend`);
            await page.keyboard.press("Escape");
          });

          await attempt("share dialog", async () => {
            await page.goto("/files");
            await settle(page);
            await row.click({ button: "right", timeout: 5_000 });
            await page
              .getByRole("menuitem", { name: /Share/i })
              .first()
              .click({ timeout: 5_000 });
            await expect(page.getByRole("dialog").first()).toBeVisible({
              timeout: 5_000,
            });
            await shoot(page, `${label}/files-share-dialog`);
            await page.keyboard.press("Escape");
          });

          await attempt("new folder", async () => {
            await page.goto("/files");
            await settle(page);
            await page
              .getByRole("button", { name: "New", exact: true })
              .click({ timeout: 5_000 });
            await page
              .getByRole("menuitem", { name: "New folder" })
              .click({ timeout: 5_000 });
            await expect(page.getByLabel("New folder name")).toBeVisible({
              timeout: 5_000,
            });
            await shoot(page, `${label}/files-new-folder`);
            await page.keyboard.press("Escape");
          });
        }

        await attempt("file viewer", async () => {
          await page.goto("/files");
          await settle(page);
          await row.dblclick({ timeout: 5_000 });
          await page.waitForURL(/\/files\/view\//, { timeout: 10_000 });
          await shoot(page, `${label}/files-viewer`);
        });

        await context.close();
      });

      test(`admin ${label}`, async ({ browser }) => {
        const context = await browser.newContext({
          storageState: ownerStatePath,
          viewport,
          colorScheme: theme,
        });
        await applyTheme(context, theme);
        const page = await context.newPage();

        for (const route of ADMIN_ROUTES) {
          await page.goto(route);
          await shoot(page, `${label}/admin-${slug(route)}`);
        }

        await context.close();
      });

      test(`member and public ${label}`, async ({ browser }) => {
        const memberContext = await browser.newContext({
          storageState: memberStatePath,
          viewport,
          colorScheme: theme,
        });
        await applyTheme(memberContext, theme);
        const memberPage = await memberContext.newPage();
        await memberPage.goto("/files");
        await shoot(memberPage, `${label}/member-files`);
        await memberContext.close();

        const publicContext = await browser.newContext({
          viewport,
          colorScheme: theme,
        });
        await applyTheme(publicContext, theme);
        const page = await publicContext.newPage();

        await page.goto(getShareUrl());
        await shoot(page, `${label}/public-share`);

        await page.goto("/s/not-a-real-share-token");
        await shoot(page, `${label}/public-share-missing`);

        await page.goto("/");
        await shoot(page, `${label}/entry-intro`);
        await page
          .getByRole("button", { name: "Click anywhere or press any key" })
          .click();
        await expect(page.locator("form").first()).toBeVisible();
        await page.waitForTimeout(1200);
        await shoot(page, `${label}/entry-form`);

        await publicContext.close();
      });

      test(`onboarding ${label}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport,
          colorScheme: theme,
        });
        await applyTheme(context, theme);
        const page = await context.newPage();
        const { identifier, password } = getOnboardingCredentials();

        await page.goto("/");
        await page
          .getByRole("button", { name: "Click anywhere or press any key" })
          .click();
        await page.getByLabel("Email", { exact: true }).fill(identifier);
        await page.getByLabel("Password").fill(password);
        await page.getByRole("button", { name: "Sign in" }).press("Enter");

        const steps = [
          "Choose a look",
          "Check your time",
          "Your name",
          "A few choices",
        ];
        for (const [index, heading] of steps.entries()) {
          await expect(
            page.getByRole("heading", { name: heading }),
          ).toBeAttached({ timeout: 20_000 });
          await page.waitForTimeout(900);
          await shoot(page, `${label}/onboarding-step-${index + 1}`);
          if (heading === "Choose a look") {
            await page.getByRole("radio", { name: "Dark" }).click();
          } else if (index < steps.length - 1) {
            await page
              .getByRole("button", { name: /Continue|That's my time/ })
              .click();
          }
        }

        await context.close();
      });
    });
  }
}
