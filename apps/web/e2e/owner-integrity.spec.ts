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
  await expect(
    page.getByRole("link", { name: "Staaash E2E", exact: true }),
  ).toBeVisible();

  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/admin/integrity", {
    headers: {
      Origin: origin,
    },
  });
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as { message?: string; jobId: string };
  expect(body.message).toMatch(/queued|already queued or running/i);
  await expect
    .poll(
      async () => {
        const result = await page.request.get("/api/admin/integrity");
        expect(result.status()).toBe(200);
        const summary = await result.json();
        return summary.recentRuns.find(
          (run: { backgroundJobId: string }) =>
            run.backgroundJobId === body.jobId,
        )?.status;
      },
      { timeout: 45_000 },
    )
    .toBe("succeeded");
});
