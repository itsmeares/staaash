import { expect, test } from "@playwright/test";

import type { BatchMoveOperationResponse } from "../server/files/types";

test.setTimeout(60_000);

const failedMove: BatchMoveOperationResponse = {
  operationId: "failed-move-1",
  status: "succeeded",
  items: [{ id: "owner-coast", kind: "file" }],
  destinationFolderId: "owner-photos",
  response: {
    movedCount: 0,
    failedCount: 1,
    results: [
      {
        id: "owner-coast",
        kind: "file",
        status: "failed",
        code: "FILE_NAME_CONFLICT",
        error: "A file with this name already exists.",
        retryable: true,
      },
    ],
  },
};

test(
  "keeps a dismissed move warning closed after reload and reopening",
  { tag: "@smoke" },
  async ({ page, context }, info) => {
    await context.route("**/api/files/move", (route) =>
      route.fulfill({ json: [failedMove] }),
    );
    await page.goto("/files");
    await expect(
      page.getByRole("heading", { name: "Files", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    const warning = page.locator('[data-slot="toast-title"]');
    await expect(warning).toHaveText("Some items could not be moved.");
    await page
      .locator('[data-slot="toast-viewport"] [aria-label="Close"]')
      .click();
    await expect(warning).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Files", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("after-reload.png") });
    await expect(warning).toHaveCount(0);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto("/files");
    await expect(
      reopened.getByRole("heading", { name: "Files", exact: true }),
    ).toBeVisible();
    await expect(reopened.locator('[data-slot="toast-title"]')).toHaveCount(0);
    await reopened.close();
  },
);

test("keeps unread failures visible and shows a different failed move", async ({
  page,
}) => {
  let operation = failedMove;
  await page.route("**/api/files/move", (route) =>
    route.fulfill({ json: [operation] }),
  );
  await page.goto("/files");
  await expect(
    page.getByRole("heading", { name: "Files", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  const warnings = page.locator('[data-slot="toast-title"]');
  await expect(warnings).toHaveCount(1);
  await page.locator('a[href="/home"]:visible').first().click();
  await page.locator('a[href="/files"]:visible').first().click();
  await expect(warnings).toHaveCount(1);
  await page.reload();
  await expect(warnings).toHaveCount(1);
  await page
    .locator('[data-slot="toast-viewport"] [aria-label="Close"]')
    .click();
  await expect(warnings).toHaveCount(0);
  operation = { ...failedMove, operationId: "different-move" };
  await page.reload();
  await expect(warnings).toHaveCount(1);
});

test("reports a failed Retry and remembers its separate dismissal", async ({
  page,
}) => {
  let operation = failedMove;
  await page.route("**/api/files/move", (route) => {
    if (route.request().method() === "POST") {
      operation = { ...failedMove, operationId: "retry-move" };
      return route.fulfill({ json: operation });
    }
    return route.fulfill({ json: [operation] });
  });
  await page.goto("/files");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('[data-slot="toast-title"]')).toContainText(
    "1 failed",
  );
  await page
    .locator('[data-slot="toast-viewport"] [aria-label="Close"]')
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Files", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="toast-title"]')).toHaveCount(0);
});

test("keeps recovery information and blocked actions after dismissal", async ({
  page,
}) => {
  await page.route("**/api/files/move", (route) =>
    route.fulfill({
      json: [
        {
          ...failedMove,
          status: "recovery_required",
          response: undefined,
          error: "Please check the file state.",
        },
      ],
    }),
  );
  await page.route("**/api/views/files", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.listing.files.find(
      (file: { id: string }) => file.id === "owner-coast",
    ).storageMutation = {
      id: failedMove.operationId,
      kind: "batch_move",
      status: "recovery_required",
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/files");
  await expect(page.locator('[data-slot="toast-title"]')).toHaveText(
    "Please check the file state.",
  );
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toHaveCount(0);
  await page
    .locator('[data-slot="toast-viewport"] [aria-label="Close"]')
    .click();
  await page.reload();
  await expect(
    page.getByText("Recovery required", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="toast-title"]')).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Coast.jpg" }),
  ).toHaveAttribute("aria-disabled", "true");
});

for (const recovery of [false, true]) {
  test(`remembers a ${recovery ? "recovery" : "partial failure"} warning closed in Recent`, async ({
    page,
  }) => {
    let operation: BatchMoveOperationResponse | undefined;
    await page.route("**/api/files/move", (route) => {
      if (route.request().method() === "POST") {
        operation = recovery
          ? {
              ...failedMove,
              status: "recovery_required",
              response: undefined,
              error: "Please check the file state.",
            }
          : failedMove;
        return route.fulfill({ json: operation });
      }
      return route.fulfill({ json: operation ? [operation] : [] });
    });
    await page.goto("/recent");
    await page
      .getByRole("row")
      .filter({ hasText: "Coast.jpg" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move…", exact: true }).click();
    await page.getByRole("treeitem", { name: /Photo archive/ }).click();
    await page
      .getByRole("button", { name: "Move to Photo archive", exact: true })
      .click();
    await expect(page.locator('[data-slot="toast-title"]')).toHaveCount(1);
    await page
      .locator('[data-slot="toast-viewport"] [aria-label="Close"]')
      .click();
    await page.goto("/files");
    await expect(
      page.getByRole("heading", { name: "Files", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="toast-title"]')).toHaveCount(0);
  });
}
