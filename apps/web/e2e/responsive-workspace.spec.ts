import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

test.use({ hasTouch: true });

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

  await expect(page.locator("[data-workspace-mobile-nav]")).toBeVisible();
  await expect(page.locator("[data-workspace-sidebar]")).toBeHidden();
  await expectNoHorizontalOverflow(page);

  const fileChooser = page.waitForEvent("filechooser");
  await page
    .locator("[data-workspace-mobile-nav]")
    .getByRole("button", { name: "New", exact: true })
    .click();
  await page.getByRole("button", { name: "Upload files" }).click();
  await fileChooser;

  const row = page.getByRole("grid").locator("[data-list-item]", {
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
  await expect(
    page
      .locator("[data-slot=phone-selection]")
      .getByText("1 selected", { exact: true }),
  ).toBeVisible();

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
    await expect(page.locator("[data-workspace-mobile-nav]")).toBeVisible();
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

test("tablets and short screens use the rail, desktops the sidebar", async ({
  page,
}) => {
  const rail = page.locator("[data-workspace-rail]");
  const sidebar = page.locator("[data-workspace-sidebar]");
  const tabs = page.locator("[data-workspace-mobile-nav]");

  await page.setViewportSize({ width: 768, height: 1024 });
  await signIn(page, getOwnerCredentials());
  await expect(rail).toBeVisible();
  await expect(tabs).toBeHidden();
  await expect(sidebar).toBeHidden();
  await expectNoHorizontalOverflow(page);

  // A phone held sideways.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(rail).toBeVisible();
  await expect(tabs).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sidebar).toBeVisible();
  await expect(rail).toBeHidden();
  await expect(tabs).toBeHidden();
  await expectNoHorizontalOverflow(page);
});
