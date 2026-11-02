import { expect, test } from "@playwright/test";
import type {
  BrowserDownload,
  DesktopDownloads,
} from "@staaash/config/desktop-downloads";

const active: BrowserDownload = {
  id: "active",
  name: "Autumn trip.zip",
  mimeType: "application/zip",
  receivedBytes: 96 * 1024 ** 2,
  totalBytes: 240 * 1024 ** 2,
  state: "downloading",
  canResume: false,
};

test("starts a ready archive once when the current folder changes", async ({
  page,
}) => {
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.route("**/api/files/archives", (route) =>
    route.fulfill({
      json: { archiveId: "ready-archive", status: "ready" },
    }),
  );
  await page.route("**/api/files/archives/ready-archive/download", (route) =>
    route.fulfill({
      contentType: "application/zip",
      headers: {
        "content-disposition": 'attachment; filename="Documents.zip"',
      },
      body: Buffer.from("Sample archive bytes"),
    }),
  );
  await page.goto("/files");
  await page
    .getByRole("button", { name: "Actions for Documents", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Download as zip", exact: true })
    .click();
  await expect.poll(() => downloads).toBe(1);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("button", {
        name: "Actions for Documents",
        exact: true,
      }),
    })
    .dblclick();
  await expect(page).toHaveURL(/\/files\/f\/owner-documents$/);
  await expect(page.getByRole("button", { name: /^Transfers/ })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  expect(downloads).toBe(1);
});

for (const route of ["/files", "/s/owner-photo"])
  for (const width of [400, 1280])
    test(`shows desktop downloads in ${route} at ${width}px`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        let rows: BrowserDownload[] = [];
        const listeners = new Set<(next: BrowserDownload[]) => void>();
        const publish = () => listeners.forEach((listener) => listener(rows));
        const api: DesktopDownloads = {
          getState: async () => rows,
          onState: (listener) => {
            listeners.add(listener);
            document.documentElement.dataset.downloadsReady = "true";
            return () => listeners.delete(listener);
          },
          cancel: async (id) => {
            rows = rows.map((row) =>
              row.id === id ? { ...row, state: "cancelled" } : row,
            );
            publish();
            return { error: null };
          },
          resume: async () => ({ error: null }),
          reveal: async (id) => {
            document.documentElement.dataset.revealed = id;
            return { error: null };
          },
          clearFinished: async () => {
            rows = rows.filter((row) =>
              ["downloading", "interrupted", "selecting"].includes(row.state),
            );
            publish();
            return { error: null };
          },
        };
        window.staaashDownloads = api;
        window.addEventListener("test:downloads", (event) => {
          rows = (event as CustomEvent<BrowserDownload[]>).detail;
          publish();
        });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);
      await page.waitForFunction(
        () => document.documentElement.dataset.downloadsReady === "true",
      );
      await expect(
        page.getByRole("button", { name: /^Transfers/ }),
      ).toHaveCount(0);
      await page.evaluate(
        (download) =>
          window.dispatchEvent(
            new CustomEvent("test:downloads", { detail: [download] }),
          ),
        active,
      );
      await expect(
        page.getByText("96.0 MB of 240 MB", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("progressbar", { name: "Autumn trip.zip download" }),
      ).toHaveAttribute("aria-valuenow", "40");
      await page.getByRole("button", { name: "Close transfers" }).click();
      await page.getByRole("button", { name: /^Transfers 40%/ }).click();
      await expect(
        page.getByText("96.0 MB of 240 MB", { exact: true }),
      ).toBeVisible();
      const completed = {
        ...active,
        id: "completed",
        name: "House plans.pdf",
        state: "completed" as const,
        receivedBytes: 0,
      };
      await page.evaluate(
        (downloads) =>
          window.dispatchEvent(
            new CustomEvent("test:downloads", { detail: downloads }),
          ),
        [active, completed],
      );
      await page
        .getByRole("button", { name: "Open folder", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-revealed",
        "completed",
      );
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Open folder", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Cancel Autumn trip.zip" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Cancel Autumn trip.zip" })
        .click();
      await expect(
        page.getByText("Cancelled", { exact: true }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });

test("does not add desktop controls to the ordinary web drive", async ({
  page,
}) => {
  await page.goto("/files");
  await expect(
    page.getByRole("button", { name: "Close transfers" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open folder", exact: true }),
  ).toHaveCount(0);
  const hold = () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { release, promise };
  };
  let upload = hold();
  await page.route("**/api/uploads/sessions", async (route) => {
    await upload.promise;
    await route.continue();
  });
  const choose = async (name: string) => {
    await page.getByRole("button", { name: "New", exact: true }).click();
    const picker = page.waitForEvent("filechooser");
    await page
      .getByRole("menuitem", { name: "Upload files", exact: true })
      .click();
    await (
      await picker
    ).setFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("Sample upload"),
    });
  };
  await choose("First upload.txt");
  await page.getByRole("button", { name: /^Transfers/ }).click();
  await expect(page.locator('[data-slot="popover-popup"]')).toBeVisible();
  upload.release();
  await expect(
    page.getByRole("button", { name: "Actions for First upload.txt" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Transfers/ })).toHaveCount(
    0,
    { timeout: 10000 },
  );
  upload = hold();
  await choose("Second upload.txt");
  await expect(page.getByRole("button", { name: /^Transfers/ })).toBeVisible();
  await expect(page.locator('[data-slot="popover-popup"]')).toHaveCount(0);
  upload.release();
});
