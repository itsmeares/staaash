import { test } from "@playwright/test";
import { demoShareToken, openDemo, playFrom, settle } from "./demo";
import { desktopURL, showDesktop } from "./desktop";

const out = (name: string) => `../../design/Screenshots/${name}.jpg`;

for (const theme of ["dark", "light"] as const) {
  test.describe(theme, () => {
    test.use({
      colorScheme: theme,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });

    test("signed in screens", async ({ page }) => {
      await openDemo(page, true);
      const shoot = async (name: string) => {
        await page.mouse.move(0, 0);
        await page.screenshot({ path: out(`${name}-${theme}`), quality: 92 });
      };

      await page.goto("/home");
      await settle(page);
      await shoot("home");

      await page.goto("/files/f/owner-renovation");
      await settle(page);
      await shoot("renovation");

      await page.goto("/files/view/owner-kitchen-idea");
      await settle(page);
      await shoot("photo");

      await page.goto("/files/view/owner-beach-sunset");
      await settle(page);
      await playFrom(page, 1);
      await shoot("video");

      await page.goto("/files/view/owner-taxes");
      await settle(page);
      await page.waitForTimeout(1500);
      await shoot("pdf");

      await page.goto("/files/view/owner-piano");
      await settle(page);
      await playFrom(page, 0);
      await shoot("audio");

      await page.goto("/files");
      await settle(page);
      await page.getByRole("combobox", { name: /search/i }).fill("tax");
      await settle(page);
      await shoot("search");

      await page.goto("/admin/users");
      await settle(page);
      await shoot("members");

      // Last, because the upload is still running when the picture is taken.
      // A slow upload line shows it part way, as a real one over Wi-Fi would.
      await page.goto("/files/f/owner-renovation");
      await settle(page);
      const network = await page.context().newCDPSession(page);
      await network.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 20,
        downloadThroughput: -1,
        uploadThroughput: 3 * 1024 * 1024,
      });
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Kitchen walkthrough.mp4",
          mimeType: "video/mp4",
          buffer: Buffer.alloc(48 * 1024 * 1024),
        });
      await page.waitForTimeout(5000);
      await page.getByRole("button", { name: /^Transfers/ }).click();
      await page.waitForTimeout(800);
      await shoot("upload");
    });

    test("share link", async ({ page }) => {
      await openDemo(page, false);
      await page.goto(`/s/${demoShareToken}`);
      await settle(page);
      await page.screenshot({ path: out(`share-${theme}`), quality: 92 });
    });

    test.describe("desktop app", () => {
      test.use({ viewport: { width: 860, height: 640 } });

      test("syncing", async ({ page }) => {
        await showDesktop(page);
        await page.goto(desktopURL);
        await settle(page);
        await page.screenshot({ path: out(`desktop-${theme}`), quality: 92 });
      });
    });

    test.describe("phone", () => {
      test.use({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });

      test("share link", async ({ page }) => {
        await openDemo(page, false);
        await page.goto(`/s/${demoShareToken}`);
        await settle(page);
        await page.screenshot({
          path: out(`share-phone-${theme}`),
          quality: 92,
        });
      });
    });
  });
}
