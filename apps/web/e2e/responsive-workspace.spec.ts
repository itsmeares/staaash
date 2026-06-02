import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

const expectNoHorizontalOverflow = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = document.documentElement;
        return (
          Math.ceil(Math.max(doc.scrollWidth, document.body.scrollWidth)) <=
          window.innerWidth + 1
        );
      }),
    )
    .toBe(true);
};

test("phone workspace shell exposes bottom nav, upload, and touch file actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, getOwnerCredentials());

  await expect(page.locator(".workspace-mobile-nav")).toBeVisible();
  await expect(page.locator(".workspace-sidebar")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  const fileChooser = page.waitForEvent("filechooser");
  await page
    .locator(".workspace-mobile-nav")
    .getByRole("button", { name: "Upload" })
    .click();
  await fileChooser;

  const row = page.locator("[data-file-row]", {
    hasText: "shared-preview.png",
  });
  await expect(row).toBeVisible();

  await row.dispatchEvent("pointerdown", {
    clientX: 24,
    clientY: 24,
    pointerType: "touch",
  });
  await page.waitForTimeout(460);
  await row.dispatchEvent("pointerup", {
    clientX: 24,
    clientY: 24,
    pointerType: "touch",
  });
  await expect(page.getByText("1 item")).toBeVisible();

  await row
    .getByRole("button", { name: /Actions for shared-preview\.png/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Actions" })).toBeVisible();
});

test("phone workspace routes do not overflow horizontally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page, getOwnerCredentials());

  for (const route of [
    "/files",
    "/recent",
    "/favorites",
    "/search?q=shared",
    "/shared",
    "/trash",
    "/settings",
    "/home",
  ]) {
    await page.goto(route);
    await expect(page.locator(".workspace-mobile-nav")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  const results = await new AxeBuilder({ page })
    .include("#main-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("tablet portrait uses mobile nav and landscape uses compact sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signIn(page, getOwnerCredentials());
  await expect(page.locator(".workspace-mobile-nav")).toBeVisible();
  await expect(page.locator(".workspace-sidebar")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 900, height: 600 });
  await expect(page.locator(".workspace-mobile-nav")).toBeHidden();
  await expect(page.locator(".workspace-sidebar")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".workspace-sidebar")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeLessThan(100);
  await expectNoHorizontalOverflow(page);
});
