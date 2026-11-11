import { expect as baseExpect, test } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 20_000 });
test.setTimeout(90_000);
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

for (const role of ["owner", "admin", "member"] as const) {
  test(`explains recovery to the ${role} without enabling file actions`, async ({
    page,
  }) => {
    await page.request.post("/__ui/scenario", {
      form: { scenario: "busy" },
      maxRedirects: 0,
    });
    if (role !== "owner") {
      await page.request.post("/api/auth/sign-in", {
        data: { email: `${role}@staaash.test`, password: "preview-password" },
      });
    }
    await page.goto("/files");
    const row = page.locator(`[data-list-item="${role}-photos"]`);
    await expect(row).toHaveAttribute("aria-disabled", "true");
    const help = row.getByRole("button", { name: "Needs a storage check" });
    await help.focus();
    await page.keyboard.press("Enter");
    const popup = page.getByRole("dialog");
    await expect(popup).toContainText("Staaash stopped this change");
    await expect(popup).toContainText("sample-move");
    if (role === "member") {
      await expect(popup).toContainText("Contact the instance owner");
      await expect(popup.getByRole("link")).toHaveCount(0);
      expect(
        (
          await page.request.get(
            "/api/views/admin/storage?mutationId=sample-move",
          )
        ).status(),
      ).toBe(403);
    } else {
      await popup.getByRole("link", { name: "View recovery details" }).click();
      await expect(page).toHaveURL(/\/admin\/storage\?mutationId=sample-move$/);
      await expect(
        page.getByText("Both rename source and target exist.", {
          exact: false,
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry now" })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: "Copy recovery details" }).click();
      await expect(
        page.getByRole("button", { name: "Copy recovery details" }),
      ).toContainText("Copied");
      expect(
        await page.evaluate(() => navigator.clipboard.readText()),
      ).toContain("Both rename source and target exist.");
    }
    await page.goto(`/files/storage-unavailable?folderId=${role}-photos`);
    await expect(
      page.getByRole("heading", { name: "Storage needs a check" }),
    ).toBeVisible();
    if (role === "member")
      await expect(
        page.getByText("Contact the instance owner", { exact: false }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("link", { name: "View recovery details" }),
      ).toBeVisible();
  });
}

test("shows the same recovery help across workspace lists and search", async ({
  page,
}) => {
  await page.request.post("/__ui/scenario", {
    form: { scenario: "busy" },
    maxRedirects: 0,
  });
  for (const path of [
    "/files",
    "/favorites",
    "/recent?show=added",
    "/trash",
    "/search?q=coast",
    "/search?q=Photos",
  ]) {
    await page.goto(path);
    const help = page
      .getByRole("button", { name: "Needs a storage check" })
      .first();
    await expect(help).toBeVisible();
    await help.click();
    await expect(page.getByRole("dialog")).toContainText("sample-move");
    await page.keyboard.press("Escape");
    const listTab = page.getByRole("tab", { name: "List view" });
    if (await listTab.count()) {
      await listTab.click();
      await expect(
        page.getByRole("button", { name: "Needs a storage check" }).first(),
      ).toBeVisible();
    }
  }
  await page.goto("/admin/storage?mutationId=missing");
  await expect(
    page.getByText("This change is no longer unfinished", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Show all unfinished changes" }).click();
  await expect(
    page.getByText("Both rename source and target exist.", { exact: false }),
  ).toBeVisible();
});

test.describe("on touch screens", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("keeps recovery help usable on a narrow touch screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.request.post("/__ui/scenario", {
      form: { scenario: "busy" },
      maxRedirects: 0,
    });
    await page.goto("/files");
    await page
      .getByRole("button", { name: "Needs a storage check" })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "An administrator needs to review it",
    );
    await page.getByRole("link", { name: "View recovery details" }).click();
    await expect(
      page.getByText("Both rename source and target exist.", { exact: false }),
    ).toBeVisible();
    expect(
      await page
        .locator("body")
        .evaluate((body) => body.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
