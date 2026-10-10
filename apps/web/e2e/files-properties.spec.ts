import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

const pane = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });
const row = (page: Page) => page.locator("[data-list-item]").first();
const focusedLabel = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label"));

const openFiles = async (page: Page) => {
  await signIn(page, getOwnerCredentials());
  await expect(row(page)).toBeVisible();
};

const openProperties = async (page: Page) => {
  await row(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Details" }).click();
  await expect(pane(page)).toBeVisible();
};

test("closed pane has no tab stop and is absent from the accessibility tree", async ({
  page,
}) => {
  await openFiles(page);
  await expect(pane(page)).toHaveCount(0);

  await openProperties(page);
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(pane(page)).toHaveCount(0);

  await page.locator("[data-file-list]").focus();
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusedLabel(page)).not.toBe("Close details");
  }
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusedLabel(page)).not.toBe("Close details");
  }
});

test("open pane sits beside the list, leaves the top bar usable and follows the selection", async ({
  page,
}) => {
  await openFiles(page);
  const list = page.locator("[data-file-list]");
  const widthBefore = (await list.boundingBox())!.width;

  await openProperties(page);
  await expect(pane(page).getByText("shared-preview.png")).toBeVisible();

  // Docked, not overlaid: the list shrank and the pane stays inside the viewport.
  const widthAfter = (await list.boundingBox())!.width;
  expect(widthAfter).toBeLessThan(widthBefore);
  const paneBox = (await pane(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(viewport.width);

  // The top bar is not covered by the pane.
  const profile = page.getByRole("button", { name: "Profile menu" });
  const box = (await profile.boundingBox())!;
  const topElementIsProfile = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return (
        el?.closest("button")?.getAttribute("aria-label") === "Profile menu"
      );
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(topElementIsProfile).toBe(true);

  // Keyboard selection drives the pane and focus stays in the list.
  await list.focus();
  await page.keyboard.press("Escape");
  await expect(pane(page).getByText("Select a file or folder")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(pane(page).getByText("shared-preview.png")).toBeVisible();
  await expect(row(page)).toBeFocused();
});

test("keyboard users reach the pane with Tab and Escape returns to the row", async ({
  page,
}) => {
  await openFiles(page);
  await openProperties(page);

  await page.locator("[data-file-list]").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page)).toBeFocused();

  for (let i = 0; i < 12; i += 1) {
    if (await pane(page).evaluate((el) => el.contains(document.activeElement)))
      break;
    await page.keyboard.press("Tab");
  }
  await expect
    .poll(() =>
      pane(page).evaluate((el) => el.contains(document.activeElement)),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(pane(page)).toHaveCount(0);
  await expect(row(page)).toBeFocused();

  await openProperties(page);
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(pane(page)).toHaveCount(0);
  await expect(row(page)).toBeFocused();
});

test("below the docking width the pane opens as a side sheet and Escape closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openFiles(page);

  await row(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Details" }).click();

  const sheet = page.getByRole("dialog", { name: "Details" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("shared-preview.png")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});
