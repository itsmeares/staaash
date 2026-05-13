import { expect, test } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

test("member can complete a core files flow", async ({ page }) => {
  const credentials = getMemberCredentials();
  const folderName = `Smoke Folder ${Date.now()}`;

  await signIn(page, credentials);

  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Files"),
  ).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByPlaceholder("Folder name").fill(folderName);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText(folderName)).toBeVisible();
});
