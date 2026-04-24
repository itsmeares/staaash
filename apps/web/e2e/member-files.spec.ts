import { expect, test } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

test("member can complete a core files flow", async ({ page }) => {
  const credentials = getMemberCredentials();
  const folderName = `Smoke Folder ${Date.now()}`;

  await signIn(page, credentials);

  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await page.getByLabel("New folder").fill(folderName);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText(folderName)).toBeVisible();
});
