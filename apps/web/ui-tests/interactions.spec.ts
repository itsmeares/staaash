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

test("shows saved admin settings after leaving and returning", async ({
  page,
}) => {
  await page.goto("/admin/settings");
  const maxUpload = page.getByRole("textbox", { name: "Max upload size" });
  await expect(maxUpload).toHaveValue("10");
  await maxUpload.fill("15");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Users", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(maxUpload).toHaveValue("15");
});

for (const width of [390, 1280])
  test(`keeps long locations inside details at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/files");

    let parentId = "owner-root";
    for (const name of [
      "Long folder name with spaces",
      "Another folder with a long name",
      "AnExtremelyLongFolderNameWithoutAnySpaces0123456789",
      "Report",
    ]) {
      const response = await page.request.post("/api/files/folders", {
        data: { name, parentId },
      });
      expect(response.ok()).toBe(true);
      const { folder } = await response.json();
      if (name !== "Report") parentId = folder.id;
    }

    await page.goto(`/files/f/${parentId}`);
    await page.getByRole("button", { name: "Actions for Report" }).click();
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();
    const panel =
      width < 1024
        ? page.getByRole("dialog", { name: "Details" })
        : page.getByRole("complementary", { name: "Details" });
    const location = panel.locator("dd", { hasText: "Files /" });
    await expect(location).toContainText(
      "AnExtremelyLongFolderNameWithoutAnySpaces",
    );
    const scrollable = width < 1024 ? panel.locator(".overflow-y-auto") : panel;
    await expect
      .poll(() => scrollable.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBe(0);
    await expect(
      panel.getByRole("button", { name: "Close details" }),
    ).toBeVisible();
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

test("lists a failed health check under Needs attention", async ({ page }) => {
  await page.request.post("/__ui/scenario", { form: { scenario: "error" } });
  await page.goto("/admin");
  await expect(page.getByText("Files volume has a problem")).toBeVisible();
  await expect(page.getByText("Not writable")).toHaveCount(2);
});

test("opens a job's runs and fixes its failed run in Details", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.request.post("/__ui/scenario", { form: { scenario: "error" } });
  await page.goto("/admin/jobs");
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const runs = dialog.getByRole("list", { name: "Runs" });
  await runs.getByRole("button").first().click();
  await expect(runs.getByText("Started.")).toBeVisible();
  await expect(runs.getByText("Job handler started.")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "1 failed", exact: true }).click();
  const failed = dialog.getByRole("list", {
    name: "Failed Clean temporary uploads runs",
  });
  await failed.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText("1 run dismissed.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "1 failed", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "2 failed", exact: true }).click();
  const previews = dialog.getByRole("list", {
    name: "Failed Create preview files runs",
  });
  await expect(previews.getByText("Gave up after 5 tries")).toBeVisible();
  await expect(previews.getByText("Failed again after a retry")).toBeVisible();
  await expect(previews.getByText(/took/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("keeps the newest runs when an older refresh's body lands late", async ({
  page,
}) => {
  await page.request.post("/__ui/scenario", { form: { scenario: "error" } });
  // No live pushes, so only the two list reads below can change the card.
  await page.route("**/api/admin/live**", (route) => route.abort());
  // The first run-list reply arrives at once, but its body comes later.
  await page.addInitScript(() => {
    const flags = window as unknown as Record<string, boolean>;
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (flags.lateStarted || !url.includes("jobs?kind=staging.cleanup"))
        return original(input, init);
      flags.lateStarted = true;
      const body = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('{"items":[]}'));
            controller.close();
            flags.lateDone = true;
          }, 1500);
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    };
  });
  await page.goto("/admin/jobs");
  const card = page
    .getByRole("article")
    .filter({ hasText: "Clean temporary uploads" });
  await card.getByRole("button", { name: "Run now" }).click();
  await page.waitForFunction(() => "lateStarted" in window);
  await card.getByRole("button", { name: "Details", exact: true }).click();
  const runs = page.getByRole("dialog").getByRole("list", { name: "Runs" });
  await expect(runs.getByRole("listitem")).toHaveCount(1);
  await page.waitForFunction(() => "lateDone" in window);
  await page.waitForTimeout(300);
  await expect(runs.getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(card.getByText("Hasn't run yet.")).toHaveCount(0);
});

test("keeps a person's changes until Save, and Discard puts them back", async ({
  page,
}) => {
  await page.goto("/admin/users/member");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const original = await name.inputValue();
  await name.fill("Someone Else");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(name).toHaveValue(original);
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  await page
    .getByRole("textbox", { name: "Storage limit", exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Storage limit", exact: true }),
  ).toHaveValue("2");
  await expect(name).toHaveValue(original);
});

test("invites a sample user through the real admin form", async ({ page }) => {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser-invite@staaash.test");
  await form.getByText("Admin", { exact: true }).click();
  await form
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("sample-pass-1234");
  await form.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(
    form.getByText("browser-invite@staaash.test", { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByText("sample-pass-1234", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const row = page.getByRole("link").filter({
    hasText: "browser-invite@staaash.test",
  });
  await expect(row.getByText("Admin", { exact: true })).toBeVisible();
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

test("resolves a stopped storage change from Maintenance", async ({ page }) => {
  await page.goto("/__ui");
  await expect(
    page.getByRole("button", { name: "Reset samples" }),
  ).toBeVisible();
  await page.request.post("/__ui/scenario", { form: { scenario: "busy" } });
  await page.goto("/admin/maintenance");
  await page.getByRole("link", { name: "Review 1", exact: true }).click();
  await page.getByRole("link", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/maintenance\/changes$/);
  await page.goto("/admin/maintenance");
  await expect(
    page.getByText("Every move, rename and trash finished."),
  ).toBeVisible();
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

for (const [name, lines, truncated] of [
  ["Huge log.txt", 50_000, true],
  ["Short log.txt", 3, false],
  ["Empty log.txt", 0, false],
] as const)
  test(`opens ${name} ${truncated ? "cut to its first 256 KB" : "in full"}`, async ({
    page,
  }) => {
    const text = Array.from({ length: lines }, (_, i) => `line ${i + 1}\n`);
    await page.goto("/files");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(text.join("")),
      });
    await page.getByRole("row").filter({ hasText: name }).dblclick();
    const viewer = page.getByRole("dialog", { name });
    await expect(
      viewer.getByRole("button", { name: "Copy", exact: true }),
    ).toBeVisible();
    await expect(
      viewer.locator("p", { hasText: "Only the first 256 KB is shown." }),
    ).toHaveCount(truncated ? 1 : 0);
    if (!truncated && lines)
      await expect(
        viewer.getByText(`line ${lines}`, { exact: true }),
      ).toBeVisible();
  });

test("search narrows both Settings pages to the matching rows", async ({
  page,
}) => {
  await page.goto("/__ui");
  await page.request.post("/__ui/scenario", { form: { scenario: "owner" } });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Appearance" }).click();
  const search = page.getByLabel("Search settings");
  await search.fill("pins");
  await expect(page.getByText("Show pins in the sidebar")).toBeVisible();
  await expect(page.getByText("Start page", { exact: true })).toBeHidden();
  await search.fill("theme");
  await expect(page.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
  await expect(page.getByText("Show pins in the sidebar")).toBeHidden();
  await search.fill("");
  await expect(page.getByText("Start page", { exact: true })).toBeVisible();

  // A phone shows one category at a time, so the filter must stay in view.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Back to Settings" }).click();
  await page.getByLabel("Search settings").fill("pins");
  await page.getByRole("button", { name: /Appearance/ }).click();
  await expect(page.getByLabel("Search settings")).toHaveValue("pins");
  await expect(page.getByText("Start page", { exact: true })).toBeHidden();
  await page.getByLabel("Search settings").fill("");
  await expect(page.getByText("Start page", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/admin/settings");
  await page.getByLabel("Search settings").fill("upload timeout");
  await expect(page.getByText("Upload timeout", { exact: true })).toBeVisible();
  await expect(page.getByText("Max upload size", { exact: true })).toBeHidden();
  await page.getByLabel("Search settings").fill("no such setting");
  await expect(
    page.getByText('No setting matches "no such setting".'),
  ).toBeVisible();
});
