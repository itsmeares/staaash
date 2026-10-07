import { expect, test, type Page } from "@playwright/test";

import { getOwnerCredentials, signIn } from "./helpers";

const readSettings = (page: Page) =>
  page
    .locator("form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement)),
    );

async function chooseTimeZone(page: Page, zone: string) {
  await page
    .getByRole("button", { name: "Instance time zone", exact: true })
    .click();
  await page.getByRole("searchbox", { name: "Search time zones" }).fill(zone);
  await page.getByRole("option", { name: new RegExp(zone) }).click();
}

test("settings keep rejected drafts, reveal errors and reset to the latest save", async ({
  page,
}) => {
  await signIn(page, { ...getOwnerCredentials(), next: "/admin/settings" });
  const original = await readSettings(page);
  const nextZone =
    original.timeZone === "Asia/Tokyo" ? "Europe/London" : "Asia/Tokyo";
  const heartbeat = page.getByRole("textbox", {
    name: "Heartbeat max age (seconds)",
    exact: true,
  });
  const timeout = page.getByRole("textbox", {
    name: "Upload timeout (minutes)",
    exact: true,
  });
  const maintenance = page.getByRole("textbox", {
    name: "Daily maintenance time",
    exact: true,
  });
  const media = page.getByRole("switch", {
    name: "Enable media previews",
    exact: true,
  });
  const workerPanel = page.locator("#settings-panel-worker");
  const schedulingPanel = page.locator("#settings-panel-scheduling");

  await page
    .getByRole("button", {
      name: "Uploads Upload limits, temporary upload cleanup, and file preview limits",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Worker Background worker heartbeat tolerance",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Scheduling Instance time zone and maintenance window",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: "Media previews Video preview generation, cleanup, and quality",
      exact: true,
    })
    .click();

  try {
    await heartbeat.fill("2147483648");
    await timeout.fill("90");
    await chooseTimeZone(page, nextZone);
    await maintenance.fill("23:59");
    await media.click();
    const draft = await readSettings(page);

    await workerPanel
      .getByRole("button", {
        name: "Worker Background worker heartbeat tolerance",
        exact: true,
      })
      .click();
    await page
      .getByRole("searchbox", { name: "Search settings" })
      .fill("scheduling");
    await schedulingPanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(heartbeat).toHaveAttribute("aria-invalid", "true");
    await expect(heartbeat).toBeFocused();
    await expect(
      workerPanel.locator('[data-slot="collapsible-panel"]'),
    ).toHaveJSProperty("scrollTop", 0);
    await expect(
      page.getByRole("searchbox", { name: "Search settings" }),
    ).toHaveValue("");
    await expect(workerPanel.getByRole("alert")).toHaveText(
      "Use 2,147,483,647 or less.",
    );
    expect(await readSettings(page)).toEqual(draft);

    await heartbeat.fill("180");
    await workerPanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      workerPanel.getByText("Saved.", { exact: true }),
    ).toBeVisible();
    await expect(heartbeat).toHaveAttribute("aria-invalid", "false");
    const saved = await readSettings(page);

    // Save again without changing the timezone to catch stale Reset baselines.
    await heartbeat.fill("200");
    await workerPanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      workerPanel.getByText("Saved.", { exact: true }),
    ).toBeVisible();
    await chooseTimeZone(page, String(original.timeZone));
    await maintenance.fill("04:00");
    await timeout.fill("100");
    await media.click();
    await schedulingPanel
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    expect(await readSettings(page)).toEqual({
      ...saved,
      workerHeartbeatMaxAgeSeconds: "200",
    });
    await expect(
      page.getByRole("button", { name: "Instance time zone", exact: true }),
    ).toContainText(nextZone);

    await schedulingPanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      schedulingPanel.getByText("Saved.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    expect(await readSettings(page)).toEqual({
      ...saved,
      workerHeartbeatMaxAgeSeconds: "200",
    });
  } finally {
    await page.reload();
    for (const title of [
      "Uploads Upload limits, temporary upload cleanup, and file preview limits",
      "Worker Background worker heartbeat tolerance",
      "Scheduling Instance time zone and maintenance window",
      "Media previews Video preview generation, cleanup, and quality",
    ]) {
      await page.getByRole("button", { name: title, exact: true }).click();
    }
    await heartbeat.fill(String(original.workerHeartbeatMaxAgeSeconds));
    await timeout.fill(String(original.uploadTimeoutMinutes));
    await chooseTimeZone(page, String(original.timeZone));
    await maintenance.fill(String(original.maintenanceRunTime));
    await media.setChecked(original.mediaPreviewEnabled === "on");
    await workerPanel
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      workerPanel.getByText("Saved.", { exact: true }),
    ).toBeVisible();
  }
});
