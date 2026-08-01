import { expect, test } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

test("owner can trigger and observe reconciliation", async ({ page }) => {
  const credentials = getOwnerCredentials();

  await signIn(page, {
    ...credentials,
    next: "/admin",
  });

  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Restore check", { exact: true })).toBeVisible();

  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/admin/integrity", {
    headers: {
      Origin: origin,
    },
  });
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as { message?: string };
  expect(body.message).toMatch(/queued|already queued or running/i);
});
