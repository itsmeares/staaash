import { expect, test } from "@playwright/test";

import {
  expectQueuedOrRunningState,
  getOwnerCredentials,
  signIn,
} from "./helpers";

test("owner can trigger and observe reconciliation", async ({ page }) => {
  const credentials = getOwnerCredentials();

  await signIn(page, {
    ...credentials,
    next: "/admin/integrity",
  });

  await expect(
    page.getByRole("heading", { name: "Restore integrity" }),
  ).toBeVisible();

  const statusPanel = page.getByText(/Restore reconciliation/i).first();
  const runButton = page.getByRole("button", { name: "Run reconciliation" });

  if (await runButton.isDisabled()) {
    await expectQueuedOrRunningState(statusPanel);
    return;
  }

  await runButton.click();
  await expect(
    page.getByText(/Restore reconciliation queued|already queued or running/i),
  ).toBeVisible();
});
