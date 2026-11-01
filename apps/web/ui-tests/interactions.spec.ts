import { expect, test } from "@playwright/test";

for (const signedIn of [false, true])
  test(`returns to desktop downloads when ${signedIn ? "already signed in" : "signing in"}`, async ({
    page,
    context,
  }) => {
    await context.route(
      "https://github.com/itsmeares/staaash/releases",
      (route) =>
        route.fulfill({ contentType: "text/html", body: "Desktop releases" }),
    );
    if (!signedIn)
      await page.request.post("/__ui/scenario", {
        form: { scenario: "signed-out" },
        maxRedirects: 0,
      });
    await page.goto("/?next=%2Fapi%2Fdesktop-app");
    if (!signedIn) {
      await page
        .getByRole("button", { name: "Click anywhere or press any key" })
        .click();
      await page
        .getByLabel("Email", { exact: true })
        .fill("owner@staaash.test");
      await page
        .getByLabel("Password", { exact: true })
        .fill("preview-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    await expect(page).toHaveURL(
      "https://github.com/itsmeares/staaash/releases",
    );
  });

test("opens desktop downloads through the instance in a new tab", async ({
  page,
  context,
}) => {
  await context.route(
    "https://github.com/itsmeares/staaash/releases",
    (route) =>
      route.fulfill({ contentType: "text/html", body: "Desktop releases" }),
  );
  await page.goto("/files");
  await page.getByRole("button", { name: "Profile menu" }).click();
  const download = page.getByRole("menuitem", { name: "Get the desktop app" });
  await expect(download).toHaveAttribute("href", "/api/desktop-app");
  const opened = context.waitForEvent("page");
  await download.click();
  const tab = await opened;
  await expect(tab).toHaveURL("https://github.com/itsmeares/staaash/releases");
  await expect(page).toHaveURL(/\/files$/);
  await tab.close();
});

for (const [path, sections] of [
  [
    "/settings",
    [
      "Profile",
      "Appearance",
      "Date and time",
      "Storage",
      "Signed in",
      "Updates",
    ],
  ],
  [
    "/admin/settings",
    [
      "Uploads",
      "Previews",
      "Media previews",
      "Sessions",
      "Downloads",
      "Updates",
      "Scheduling",
      "Worker",
    ],
  ],
] as const)
  test(`opens every settings panel in ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(path);
    const navigation = page.getByRole("navigation", {
      name: "Settings",
      exact: true,
    });
    for (const section of sections) {
      const button = navigation.getByRole("button", {
        name: section,
        exact: true,
      });
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByText("Something went wrong", { exact: false }),
      ).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

test("opens file details, rename, move, and sharing controls", async ({
  page,
}) => {
  await page.goto("/files");
  const menu = page.getByRole("button", {
    name: "Actions for Coast.jpg",
    exact: true,
  });
  await menu.click();
  await page.getByRole("menuitem", { name: "Details", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Details" }),
  ).toBeVisible();
  await menu.click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "Rename Coast.jpg",
    exact: true,
  });
  await input.fill("Harbour holiday.jpg");
  await input.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Actions for Harbour holiday.jpg",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Actions for Harbour holiday.jpg",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Move…", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: "Actions for Harbour holiday.jpg",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Manage link", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("opens job details, history, and preview-file panels", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin/jobs");
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Events", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Preview files", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Preview files", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("invites a sample user through the real admin form", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser-invite@staaash.test");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Invite", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("browser-invite@staaash.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByText("browser-invite@staaash.test", { exact: true }),
  ).toBeVisible();
});

test("unlocks a nested public file and renders the actual image", async ({
  page,
}) => {
  await page.goto("/s/owner-locked-folder/files/owner-photo-1");
  await page.getByLabel("Password", { exact: true }).fill("preview-password");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Back to folder", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("main img")
        .evaluateAll((images) =>
          images.some(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
});

for (const route of [
  "/files/f/missing-folder",
  "/files/view/missing-file",
  "/files/view/owner-unknown",
])
  test(`shows the missing-item screen for ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(
      page.getByRole("heading", {
        name: "This page doesn't exist",
        exact: true,
      }),
    ).toBeVisible();
  });

test("retries a sample storage mutation from its admin panel", async ({
  page,
}) => {
  await page.goto("/__ui");
  await expect(
    page.getByRole("button", { name: "Reset samples" }),
  ).toBeVisible();
  await page.request.post("/__ui/scenario", { form: { scenario: "busy" } });
  await page.goto("/admin/storage");
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry now", exact: true }),
  ).toHaveCount(0);
  await page.goto("/files/f/owner-photos");
  await expect(
    page.getByRole("button", {
      name: "Actions for Coast - 01.jpg",
      exact: true,
    }),
  ).toBeVisible();
});

test("accepts an upload through the real file picker", async ({ page }) => {
  await page.goto("/files");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Browser upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Uploaded from the frontend preview."),
    });
  await expect(
    page.getByRole("button", {
      name: "Actions for Browser upload.txt",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Actions for Browser upload.txt",
      exact: true,
    }),
  ).toBeVisible();
});

for (const [id, element] of [
  ["film", "video"],
  ["audio", "audio"],
] as const)
  test(`loads the sample ${element} in its real viewer`, async ({ page }) => {
    await page.goto(`/files/view/owner-${id}`);
    await expect
      .poll(() =>
        page
          .locator(element)
          .evaluate(
            (media: HTMLMediaElement) =>
              media.readyState > 0 && media.duration > 0,
          ),
      )
      .toBe(true);
  });

test("renders varied drive samples in both themes at wide and narrow widths", async ({
  page,
}, info) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/files");
      await expect(
        page.getByRole("button", {
          name: "Actions for Coast.jpg",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(colorScheme));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`drive-${colorScheme}-${width}.png`),
        fullPage: true,
      });
    }
  }
});

test("selects a sample file without selecting the photo archive folder", async ({
  page,
}) => {
  await page.goto("/files");
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Actions for Trip documents.zip",
        exact: true,
      }),
    })
    .click();
  await expect(page.getByRole("row", { selected: true })).toHaveCount(1);
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("button", {
        name: "Actions for Photo archive",
        exact: true,
      }),
    }),
  ).toHaveAttribute("aria-selected", "false");
});
