import { expect, test } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

test("member can upload, rename, cut, paste, trash, restore and download unchanged bytes", async ({
  page,
}) => {
  const credentials = getMemberCredentials();
  const folderName = `Smoke Folder ${Date.now()}`;

  await signIn(page, credentials);

  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByText("Files"),
  ).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const field = page.getByLabel("New folder name");
  await field.fill(folderName);
  await field.press("Enter");

  const folder = page.getByRole("row").filter({ hasText: folderName });
  await expect(folder).toBeVisible();
  await folder.dblclick();
  await expect(
    page.getByRole("heading", { name: folderName, exact: true }),
  ).toBeVisible();
  const bytes = Buffer.from("Browser upload with accents: café.");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "Original.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  const original = page.getByRole("row").filter({ hasText: "Original.txt" });
  await expect(original).toBeVisible();
  await original.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByLabel("Rename Original.txt", { exact: true });
  await rename.fill("Renamed.txt");
  await rename.press("Enter");
  const renamed = page.getByRole("row").filter({ hasText: "Renamed.txt" });
  await expect(renamed).toBeVisible();
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
  await page.goto("/files");
  await page.getByRole("button", { name: "Paste here", exact: true }).click();
  await expect(renamed).toBeVisible();
  await renamed.click({ button: "right" });
  const trashed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/trash") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("menuitem", { name: "Move to trash", exact: true })
    .click();
  expect((await trashed).ok()).toBe(true);
  await expect(renamed).toHaveCount(0);
  await page.goto("/trash");
  await renamed.click({ button: "right" });
  const restored = page.waitForResponse(
    (response) =>
      response.url().endsWith("/restore") &&
      response.request().method() === "POST",
  );
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  expect((await restored).ok()).toBe(true);
  await expect(renamed).toHaveCount(0);
  await page.goto("/files");
  await expect(renamed).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Download", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("Renamed.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
});
