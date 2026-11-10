import { expect, test } from "@playwright/test";

test("keeps list spacing when details opens and the window resizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/files/f/owner-archive");
  await page.getByRole("tab", { name: "List view" }).click();
  const list = page.locator("[data-file-list]");
  const rows = list.locator("[data-index]");
  await expect(rows.first()).toBeVisible();
  const totalHeight = () =>
    rows
      .first()
      .evaluate((row) => row.parentElement!.getBoundingClientRect().height);
  const count = Number(await list.getAttribute("aria-rowcount")) - 1;
  expect(count).toBeGreaterThan(20);
  await expect.poll(totalHeight).toBe(count * 45);
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await expect.poll(totalHeight).toBe(count * 45);
  const main = page.locator("main[data-workspace-content]");
  await main.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(list.locator(`[data-index="${count - 1}"]`)).toBeVisible();
  await expect.poll(totalHeight).toBe(count * 45);
  await main.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Close details" }).click();
  await expect.poll(totalHeight).toBe(count * 45);
  await page.setViewportSize({ width: 700, height: 800 });
  await expect.poll(totalHeight).toBe(count * 57);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(totalHeight).toBe(count * 45);
});
