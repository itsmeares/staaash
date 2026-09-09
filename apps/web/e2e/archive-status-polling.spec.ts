import { expect, test } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

test("ignores an older successful archive poll after a newer error", async ({
  page,
}) => {
  const archiveId = "archive-poll-race";
  const accessDeniedMessage = "You do not have access to that folder.";
  let statusPollRequests = 0;
  let downloadRequests = 0;
  let releaseFirstResponse = () => {};
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });

  await page.route(`**/api/files/archives/${archiveId}`, async (route) => {
    statusPollRequests += 1;

    if (statusPollRequests === 1) {
      await firstResponse;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          fileCount: 1,
          sizeBytes: "1",
          error: null,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: accessDeniedMessage,
        code: "ACCESS_DENIED",
      }),
    });
  });

  await page.route(
    `**/api/files/archives/${archiveId}/download`,
    async (route) => {
      downloadRequests += 1;
      await route.fulfill({ status: 200, body: "" });
    },
  );

  await signIn(page, { ...getMemberCredentials(), next: "/files" });
  await page.evaluate((id) => {
    localStorage.setItem(
      "staaash:active-download",
      JSON.stringify({ archiveId: id }),
    );
  }, archiveId);
  await page.reload();

  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toBeVisible();
  await expect
    .poll(() => statusPollRequests, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByText(accessDeniedMessage)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("staaash:active-download")),
    )
    .toBeNull();

  releaseFirstResponse();
  await page.waitForTimeout(250);

  expect(downloadRequests).toBe(0);
  await expect(page.getByText(accessDeniedMessage)).toBeVisible();
});
