import path from "node:path";
import { expect, test } from "@playwright/test";

test("replaces a broken profile photo and falls back after removal", async ({
  page,
}) => {
  await page.goto("/settings");
  const response = await page.request.post("/api/user/preferences", {
    data: { avatarUrl: "data:image/jpeg;base64,broken" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  const edit = page.getByRole("button", { name: "Edit", exact: true }).first();
  const account = edit.locator("..");
  await expect(account.locator("img")).toHaveCount(0);
  await expect(account).toContainText("AM");
  await edit.click();
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles(path.resolve("dev/ui/assets/cat.jpg"));
  await expect(
    page.getByRole("button", { name: "Remove photo", exact: true }),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(account.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      account
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.reload();
  await expect(account.locator("img")).toBeVisible();
  await edit.click();
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(account.locator("img")).toHaveCount(0);
  await expect(account).toContainText("AM");
});
