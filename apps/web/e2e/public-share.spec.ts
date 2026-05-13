import { expect, test } from "@playwright/test";

import { getShareUrl } from "./helpers";

test("public sharing preserves current view versus download behavior", async ({
  page,
}) => {
  const shareUrl = getShareUrl();

  await page.goto(shareUrl);
  await expect(page.getByRole("heading")).toContainText("shared-preview.png");

  const downloadDisabledCopy = page.getByText(/Downloads off/i);
  const downloadButton = page.getByRole("link", { name: "Download file" });
  const inlinePreview = page.locator("img, video").first();

  if (await downloadDisabledCopy.isVisible().catch(() => false)) {
    await expect(inlinePreview).toBeVisible();
    await expect(downloadButton).toHaveCount(0);
    return;
  }

  await expect(downloadButton.or(inlinePreview)).toBeVisible();
});
