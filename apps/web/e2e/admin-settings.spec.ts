import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

const readSettings = (page: Page) =>
  page
    .getByRole("form", { name: "Drive settings" })
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement)),
    );

const openCategory = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name, exact: true })
    .click();

// The field opens in whichever unit the stored value divides into.
async function useSeconds(page: Page) {
  await page
    .getByRole("region", { name: "Worker" })
    .getByRole("combobox", { name: "Unit" })
    .click();
  await page.getByRole("option", { name: "sec", exact: true }).click();
}

test("settings save on change, show errors where they happen and survive a reload", async ({
  page,
}) => {
  await signIn(page, { ...getOwnerCredentials(), next: "/admin/settings" });
  const original = await readSettings(page);
  const heartbeat = page.getByLabel("Worker counts as down after", {
    exact: true,
  });
  const media = page.getByRole("switch", { name: "Media previews" });

  try {
    await openCategory(page, "Worker");
    await useSeconds(page);
    await heartbeat.fill("2147483648");
    await heartbeat.press("Enter");
    await expect(heartbeat).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert").first()).toHaveText(
      "Use 2,147,483,647 or less.",
    );

    await heartbeat.fill("180");
    await heartbeat.press("Enter");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(heartbeat).not.toHaveAttribute("aria-invalid", "true");

    await openCategory(page, "Media previews");
    await media.click();
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();

    await page.reload();
    const saved = await readSettings(page);
    expect(saved.workerHeartbeatMaxAgeSeconds).toBe("180");
    expect(saved.mediaPreviewEnabled).toBe(
      original.mediaPreviewEnabled === "on" ? "" : "on",
    );
  } finally {
    await page.reload();
    await openCategory(page, "Worker");
    await useSeconds(page);
    await heartbeat.fill(String(original.workerHeartbeatMaxAgeSeconds));
    await heartbeat.press("Enter");
    await openCategory(page, "Media previews");
    await media.setChecked(original.mediaPreviewEnabled === "on");
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();
  }
});
