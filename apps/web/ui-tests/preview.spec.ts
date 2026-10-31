import { expect, test } from "@playwright/test";

const routes = [
  "/home",
  "/files",
  "/files/f/owner-photos",
  "/files/f/owner-documents",
  "/files/f/owner-empty",
  "/files/f/owner-archive",
  "/account",
  "/setup",
  "/auth/device?redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcallback&code_challenge=" +
    "a".repeat(43) +
    "&code_challenge_method=S256&device_name=Sample%20desktop",
  "/favorites",
  "/recent",
  "/search?q=coast",
  "/shared",
  "/trash",
  "/settings",
  "/admin",
  "/admin/storage",
  "/admin/users",
  "/admin/users/member",
  "/admin/jobs",
  "/admin/settings",
  "/files/view/owner-coast",
  "/files/view/owner-film",
  "/files/view/owner-audio",
  "/files/view/owner-guide",
  "/files/view/owner-notes",
  "/s/owner-photo",
  "/s/owner-folder",
  "/s/owner-folder/f/owner-holiday",
  "/s/owner-folder/files/owner-photo-1",
  "/s/owner-locked-folder/files/owner-photo-1",
  "/s/missing-link",
  "/missing-sample-page",
  "/s/owner-locked",
  "/s/owner-expired",
  "/s/owner-revoked",
];
for (const route of routes)
  test(`opens ${route} with sample data`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.url().includes("/api/") &&
        response.status() >= 400 &&
        !new URL(response.url()).pathname.endsWith("/thumbnail")
      )
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.goto(route);
    await expect.poll(() => page.locator("#root").innerText()).not.toBe("");
    await expect(
      page.getByRole("status", { name: "Loading", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.getByText("Something went wrong", { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No sample reply", { exact: false }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
test("creates a folder through the real controls and keeps it after refresh", async ({
  page,
}) => {
  await page.goto("/files");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "Folder name" });
  await name.fill("Sample browser folder");
  await name.press("Enter");
  await expect(
    page.getByText("Sample browser folder", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Sample browser folder", { exact: true }),
  ).toBeVisible();
});
test("renders the controls in both themes at wide and narrow widths", async ({
  page,
}, info) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/__ui");
      await expect(
        page.getByRole("heading", { name: "Frontend preview", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reset samples" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator("html")).toHaveClass(new RegExp(colorScheme));
      await page.screenshot({
        path: info.outputPath(`controls-${colorScheme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

test("changes the sample role through the preview controls", async ({
  page,
}) => {
  await page.goto("/__ui");
  await page.getByRole("combobox", { name: "Sample state" }).click();
  await page
    .getByRole("option", { name: "Member with a private drive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset samples", exact: true })
    .click();
  await expect(
    page.getByText("Current state: Member with a private drive.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open drive", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Profile menu" }).click();
  await expect(page.getByText("Mia Chen", { exact: true })).toBeVisible();
});

for (const [scenario, path] of [
  ["setup", "/"],
  ["onboarding", "/"],
  ["password", "/"],
  ["invited", "/"],
  ["signed-out", "/"],
  ["empty", "/files"],
  ["admin-unavailable", "/admin"],
  ["error", "/admin/jobs"],
  ["busy", "/files/storage-unavailable?folderId=owner-root"],
  ["update", "/admin/settings"],
])
  test(`opens the ${scenario} scenario`, async ({ page }) => {
    await page.goto("/__ui");
    await expect(
      page.getByRole("button", { name: "Reset samples" }),
    ).toBeVisible();
    const response = await page.request.post("/__ui/scenario", {
      form: { scenario },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path);
    await expect.poll(() => page.locator("#root").innerText()).not.toBe("");
    await expect(
      page.getByRole("status", { name: "Loading", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(
      page.getByText("Something went wrong", { exact: false }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
