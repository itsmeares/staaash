import { expect, test, type Page } from "@playwright/test";

import { getMemberCredentials, signIn } from "./helpers";

const POINTER_KEY = "staaash:active-download";

const seedPendingArchive = async (page: Page, archiveId: string) => {
  await signIn(page, { ...getMemberCredentials(), next: "/files" });
  await page.evaluate(
    ([key, id]) => localStorage.setItem(key, JSON.stringify({ archiveId: id })),
    [POINTER_KEY, archiveId],
  );
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toBeVisible();
};

const readPointer = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), POINTER_KEY);

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
  let markFirstHandled = () => {};
  const firstHandled = new Promise<void>((resolve) => {
    markFirstHandled = resolve;
  });

  await page.route(`**/api/files/archives/${archiveId}`, async (route) => {
    statusPollRequests += 1;

    if (statusPollRequests === 1) {
      await firstResponse;
      // The client may already have aborted this request after the error.
      await route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ready",
            fileCount: 1,
            sizeBytes: "1",
            error: null,
          }),
        })
        .catch(() => {});
      markFirstHandled();
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

  await seedPendingArchive(page, archiveId);

  await expect
    .poll(() => statusPollRequests, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByText(accessDeniedMessage)).toBeVisible();
  await expect(page.getByText(/Compressing/)).toHaveCount(0);
  await expect.poll(() => readPointer(page)).toBeNull();

  releaseFirstResponse();
  await firstHandled;
  // Let the client drain any work the late response could have queued.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  expect(downloadRequests).toBe(0);
  await expect(page.getByText(accessDeniedMessage)).toBeVisible();
});

test("ends progress and clears the pointer when the archive is gone", async ({
  page,
}) => {
  const archiveId = "archive-poll-missing";
  const notFoundMessage = "That file does not exist.";
  let statusPollRequests = 0;

  await page.route(`**/api/files/archives/${archiveId}`, async (route) => {
    statusPollRequests += 1;
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: notFoundMessage, code: "FILE_NOT_FOUND" }),
    });
  });

  await seedPendingArchive(page, archiveId);

  await expect(page.getByText(notFoundMessage)).toBeVisible();
  await expect(page.getByText(/Compressing/)).toHaveCount(0);
  await expect.poll(() => readPointer(page)).toBeNull();

  // A terminal response stops the polling.
  const settledAt = statusPollRequests;
  await page.waitForTimeout(2500);
  expect(statusPollRequests).toBe(settledAt);
});
